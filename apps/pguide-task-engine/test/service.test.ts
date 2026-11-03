import assert from "node:assert/strict";
import { once } from "node:events";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, get } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createIpfsClient } from "@potential-guide/ipfs-content";
import { parseArguments, resolveConfig } from "../src/config.js";
import { localPolicy, startService } from "../src/service.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
test("explicit local Caller scope and browser request policy", () => {
  const policy = localPolicy("test", () => "http://127.0.0.1:1234");
  const headers = { host: "127.0.0.1:1234" };
  const caller = policy.resolveCaller(new Request("http://localhost/tasks", { headers }));
  assert.deepEqual(caller, { scope: "test", subject: "local-cli" });
  assert.equal(policy.authorize(caller, "submit", "test"), true);
  assert.equal(policy.authorize(caller, "submit", "other"), false);
  assert.equal(policy.authorize({ ...caller, subject: "other" }, "submit", "test"), false);
  for (const change of [
    { host: "evil.test" },
    { origin: "https://evil.test" },
    { origin: "null" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ])
    assert.throws(() =>
      policy.resolveCaller(
        new Request("http://localhost/tasks", { headers: { ...headers, ...change } }),
      ),
    );
  assert.throws(() =>
    policy.resolveCaller(new Request("http://localhost/tasks", { method: "DELETE", headers })),
  );
  assert.throws(() =>
    policy.resolveCaller(
      new Request("http://localhost/tasks", { method: "POST", headers, body: "{}" }),
    ),
  );
  assert.deepEqual(
    policy.resolveCaller(
      new Request("http://localhost/tasks", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: "{}",
      }),
    ),
    caller,
  );
});

test("RPC adapter uses configured Kubo, UI HTTP boundary and owned rollback/close", async (t) => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const directory = await mkdtemp(join(root, ".cache", "service-runtime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let rpcRequests = 0;
  const kubo = createServer((request, response) => {
    rpcRequests++;
    assert.match(request.url!, /^\/api\/v0\/block\/get\?arg=/);
    response.end(Buffer.from("fixture"));
  });
  kubo.listen(0, "127.0.0.1");
  await once(kubo, "listening");
  t.after(() => new Promise<void>((done) => kubo.close(() => done())));
  const address = kubo.address();
  assert.ok(address && typeof address === "object");
  const rpc = `http://127.0.0.1:${address.port}`;
  const client = await createIpfsClient(rpc);
  assert.equal(
    Buffer.from(
      await client.block.get("bafkreigh2akiscaildcx3muflssxfgcpk2wf75l7vx7iw4umq36aywgyki"),
    ).toString(),
    "fixture",
  );
  assert.equal(rpcRequests, 1);
  const config = await resolveConfig(
    parseArguments([
      "--no-global-config",
      "--cwd",
      directory,
      "--port",
      "0",
      "--ipfs-rpc-url",
      rpc,
      "--ui-options",
      '{"host":"127.0.0.1","port":0,"favoritesFile":"favorites.json"}',
    ]),
  );
  const engine = await startService(config);
  try {
    assert.equal(engine.uiUrl, undefined);
    assert.equal((await fetch(`${engine.url}/tasks`)).status, 200);
    assert.equal(
      (await fetch(`${engine.url}/tasks`, { headers: { origin: "https://evil.test" } })).status,
      403,
    );
    const hostileHost = await new Promise<number | undefined>((done, reject) => {
      get(`${engine.url}/tasks`, { headers: { host: "evil.test" } }, (response) => {
        response.resume();
        done(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(hostileHost, 403);
    assert.equal((await fetch(`${engine.url}/tasks`, { method: "POST", body: "{}" })).status, 403);
  } finally {
    await engine.close();
  }
  await assert.rejects(fetch(`${engine.url}/tasks`));
  const combined = await startService({ ...config, ui: true });
  try {
    assert.ok(combined.uiUrl);
    assert.match(await (await fetch(combined.uiUrl)).text(), /<html/);
    assert.equal((await fetch(`${combined.uiUrl}/app.js`)).status, 200);
    assert.equal((await fetch(`${combined.uiUrl}/style.css`)).status, 200);
    assert.equal(
      (await fetch(combined.uiUrl, { headers: { origin: "https://evil.test" } })).status,
      403,
    );
    const bootstrap = (await (await fetch(`${combined.uiUrl}/api/bootstrap`)).json()) as {
      csrf: string;
      endpoints: { id: string; binding: string }[];
    };
    const headers = {
      "x-ui-token": bootstrap.csrf,
      "x-endpoint-binding": bootstrap.endpoints[0]!.binding,
      origin: combined.uiUrl,
    };
    assert.equal(
      (await fetch(`${combined.uiUrl}/api/endpoints/local/tasks`, { headers })).status,
      200,
    );
    assert.equal(
      (
        await fetch(
          `${combined.uiUrl}/api/endpoints/local/tasks/01M6GRRES5EBHYDP1G9DZEGE8E/cancel`,
          {
            method: "POST",
            headers,
          },
        )
      ).status,
      404,
    );
  } finally {
    await combined.close();
  }
  await assert.rejects(fetch(combined.uiUrl!));
  await assert.rejects(fetch(`${combined.url}/tasks`));
  // Occupied UI port belongs to the test's Kubo fixture, never to the composition.
  const rollbackConfig = { ...config, port: Number(new URL(engine.url).port) };
  await assert.rejects(
    startService({
      ...rollbackConfig,
      ui: true,
      uiOptions: { ...config.uiOptions, port: address.port },
    }),
  );
  await assert.rejects(fetch(`${engine.url}/tasks`));
  assert.equal(
    Buffer.from(
      await client.block.get("bafkreigh2akiscaildcx3muflssxfgcpk2wf75l7vx7iw4umq36aywgyki"),
    ).toString(),
    "fixture",
  );
  const restarted = await startService(rollbackConfig);
  await Promise.all([restarted.close(), restarted.close()]);
  const invalidDatabase = join(directory, "must-not-open.sqlite");
  await assert.rejects(
    startService({
      ...config,
      database: invalidDatabase,
      uiOptions: { ...config.uiOptions, host: "0.0.0.0" },
    }),
  );
  await assert.rejects(access(invalidDatabase));
});
