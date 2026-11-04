import assert from "node:assert/strict";
import { once } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MemoryIpfsClient } from "@potential-guide/task-engine/testing";
import { buildTaskBundle } from "@potential-guide/pguide-task-bundle/build";
import { readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { taskSchemaUri } from "@potential-guide/task-protocol";
import { parseArguments, resolveConfig } from "../src/config.js";
import { localPolicy, startService } from "../src/service.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function currentRequestId() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let timestamp = Date.now();
  let prefix = "";
  for (let index = 0; index < 10; index++) {
    prefix = alphabet[timestamp % 32] + prefix;
    timestamp = Math.floor(timestamp / 32);
  }
  return `${prefix}0000000000000000`;
}

test("Gateway-only Engine and UI execute a Bundle without any RPC and retain source ownership", async (t) => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const directory = await mkdtemp(join(root, ".cache", "service-gateway-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "task.yaml"),
    JSON.stringify({
      $schema: taskSchemaUri,
      name: "Gateway-only",
      runtime: { type: "node", minVersion: "22.13.0" },
      entry: "worker.cjs",
      inputSchema: { type: "object" },
      resultSchema: true,
      messageSchema: false,
    }),
  );
  await writeFile(join(directory, "callback.ts"), "export default async input => input;");
  const built = await buildTaskBundle({
    declaration: join(directory, "task.yaml"),
    entry: join(directory, "callback.ts"),
    outDirectory: join(directory, "bundle"),
  });
  const memory = new MemoryIpfsClient();
  await memory.import((await readTaskArtifact(built.car)).files);
  let gatewayReads = 0;
  let rpcReads = 0;
  let unavailable = false;
  const source = createServer((request, response) => {
    if (!request.url!.startsWith("/ipfs/")) {
      if (request.url!.startsWith("/rpc")) rpcReads++;
      response.writeHead(500).end();
      return;
    }
    gatewayReads++;
    const url = new URL(request.url!, "http://localhost");
    const bytes = unavailable ? undefined : memory.blocks.get(url.pathname.split("/").at(-1)!);
    response.writeHead(bytes ? 200 : 404, { "content-type": "application/vnd.ipld.raw" });
    response.end(bytes);
  });
  source.listen(0, "127.0.0.1");
  await once(source, "listening");
  t.after(() => new Promise<void>((done) => source.close(() => done())));
  const address = source.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  const config = await resolveConfig(
    parseArguments([
      "--no-global-config",
      "--cwd",
      directory,
      "--port",
      "0",
      "--ipfs-gateway-url",
      url,
      "--ui-options",
      '{"host":"127.0.0.1","port":0,"favoritesFile":"favorites.json"}',
    ]),
  );
  for (const ui of [false, true]) {
    const service = await startService({
      ...config,
      database: join(directory, `${ui}.sqlite`),
      ui,
    });
    try {
      let endpoint = service.url;
      let headers: Record<string, string> = { "content-type": "application/json" };
      if (ui) {
        const bootstrap = (await (await fetch(`${service.uiUrl}/api/bootstrap`)).json()) as {
          csrf: string;
          endpoints: { binding: string }[];
        };
        endpoint = `${service.uiUrl}/api/endpoints/local`;
        headers = {
          ...headers,
          "x-ui-token": bootstrap.csrf,
          "x-endpoint-binding": bootstrap.endpoints[0]!.binding,
          origin: service.uiUrl!,
        };
      }
      const requestId = currentRequestId();
      const submitted = await fetch(`${endpoint}/tasks`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": requestId },
        body: JSON.stringify({ bundle: built.cid, text: "gateway", timeoutMs: 10_000 }),
      });
      assert.equal(submitted.status, 202, await submitted.text());
      const status = (await (
        await fetch(`${endpoint}/requests/${requestId}/status?waitMs=10000`, { headers })
      ).json()) as { status: string; taskId: string };
      assert.equal(status.status, "accepted", JSON.stringify(status));
      const deadline = Date.now() + 15_000;
      for (;;) {
        const task = (await (
          await fetch(`${endpoint}/tasks/${status.taskId}`, { headers })
        ).json()) as {
          stage: string;
          result: unknown;
        };
        if (task.stage === "completed") {
          assert.deepEqual(task.result, { text: "gateway" });
          break;
        }
        assert.ok(Date.now() < deadline, JSON.stringify(task));
        await new Promise((done) => setTimeout(done, 10));
      }
    } finally {
      await service.close();
    }
    await assert.rejects(fetch(`${service.url}/tasks`));
    if (service.uiUrl) await assert.rejects(fetch(service.uiUrl));
    assert.equal((await fetch(`${url}/ipfs/${built.cid}?format=raw`)).status, 200);
  }
  assert.ok(gatewayReads > 4);
  assert.equal(rpcReads, 0);
  await assert.rejects(
    startService({
      ...config,
      database: join(directory, "prefix.sqlite"),
      ipfsGatewayUrl: `${url}/gateway`,
    }),
    /Gateway base URL/,
  );
  unavailable = true;
  const failed = await startService({
    ...config,
    database: join(directory, "failed.sqlite"),
    ipfsGatewayUrl: url,
  });
  try {
    const requestId = currentRequestId();
    await fetch(`${failed.url}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": requestId },
      body: JSON.stringify({ bundle: built.cid, text: "fail", timeoutMs: 1000 }),
    });
    const status = (await (
      await fetch(`${failed.url}/requests/${requestId}/status?waitMs=10000`)
    ).json()) as { status: string };
    assert.equal(status.status, "rejected");
    assert.equal(rpcReads, 0, "A failed Gateway read never falls back to RPC.");
  } finally {
    await failed.close();
  }
});
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

test("Gateway service keeps UI HTTP and owned rollback/close without reading content at startup", async (t) => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const directory = await mkdtemp(join(root, ".cache", "service-runtime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let gatewayRequests = 0;
  const gateway = createServer((request, response) => {
    gatewayRequests++;
    assert.match(request.url!, /^\/ipfs\//);
    response.writeHead(404).end();
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  t.after(() => new Promise<void>((done) => gateway.close(() => done())));
  const address = gateway.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const config = await resolveConfig(
    parseArguments([
      "--no-global-config",
      "--cwd",
      directory,
      "--port",
      "0",
      "--ipfs-gateway-url",
      endpoint,
      "--ui-options",
      '{"host":"127.0.0.1","port":0,"favoritesFile":"favorites.json"}',
    ]),
  );
  const engine = await startService(config);
  assert.equal(gatewayRequests, 0);
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
  // Occupied UI port belongs to the test's Gateway fixture, never to the composition.
  const rollbackConfig = { ...config, port: Number(new URL(engine.url).port) };
  await assert.rejects(
    startService({
      ...rollbackConfig,
      ui: true,
      uiOptions: { ...config.uiOptions, port: address.port },
    }),
  );
  await assert.rejects(fetch(`${engine.url}/tasks`));
  assert.equal((await fetch(`${endpoint}/ipfs/fixture?format=raw`)).status, 404);
  assert.equal(gatewayRequests, 1, "Composition close never closes the caller's Gateway.");
  const restarted = await startService(rollbackConfig);
  await Promise.all([restarted.close(), restarted.close()]);
  const invalidDatabase = join(directory, "must-not-open.sqlite");
  const { ipfsGatewayUrl: _url, ...missingGateway } = config;
  await assert.rejects(
    startService({
      ...missingGateway,
      port: Number(new URL(engine.url).port),
      database: invalidDatabase,
    } as typeof config),
    /requires an explicit ipfsGatewayUrl/,
  );
  await assert.rejects(access(invalidDatabase));
  await assert.rejects(fetch(`${engine.url}/tasks`));
  for (const key of ["ipfsRpcUrl", "ipfsTransport"]) {
    await assert.rejects(
      startService({ ...config, database: invalidDatabase, [key]: "rpc" }),
      /retired/,
    );
    await assert.rejects(access(invalidDatabase));
  }
  await assert.rejects(
    startService({
      ...config,
      database: invalidDatabase,
      uiOptions: { ...config.uiOptions, host: "0.0.0.0" },
    }),
  );
  await assert.rejects(access(invalidDatabase));
});
