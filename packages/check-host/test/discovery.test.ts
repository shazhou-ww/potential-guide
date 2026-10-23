import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { CheckKernel, connectHost, serve } from "../dist/index.js";

test("discovery tolerates an in-progress startup record without deleting unknown ownership", async () => {
  const parent = resolve(".cache", "check-host-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "discovery-"));
  const kernel = await CheckKernel.create(join(root, "snapshots"));
  const token = crypto.randomUUID();
  const host = await serve(kernel, token);
  try {
    const startup = join(root, "startup.json");
    await writeFile(startup, "", { flag: "wx" });
    const connection = connectHost(root).then(
      (client) => ({ client }),
      (error: unknown) => ({ error }),
    );
    await new Promise((done) => setTimeout(done, 30));
    await writeFile(
      join(root, "host.json"),
      JSON.stringify({
        endpoint: host.endpoint,
        token,
        pid: process.pid,
        instance: crypto.randomUUID(),
      }),
      { flag: "wx" },
    );
    const outcome = await connection;
    assert.ok("client" in outcome);
    assert.equal(outcome.client.address.pid, process.pid);
    assert.equal(await readFile(startup, "utf8"), "");
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});
