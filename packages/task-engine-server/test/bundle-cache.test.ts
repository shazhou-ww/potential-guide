import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { newId } from "@potential-guide/task-engine";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import { TaskClient } from "@potential-guide/task-engine-http";
import { taskSchemaUri, TaskError } from "@potential-guide/task-protocol";
import { buildTaskBundle, packTaskBundle } from "@potential-guide/task-sdk/build";
import { startTaskServer } from "../src/index.js";

test("authenticated endpoint-wide cache management is independent of task grants and preserves active content and history", {
  timeout: 30_000,
}, async () => {
  const root = resolve(".cache", `cache-api-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  let server: Awaited<ReturnType<typeof startTaskServer>> | undefined;
  try {
    const declaration = join(root, "task.yaml"),
      callback = join(root, "callback.ts");
    await writeFile(
      declaration,
      JSON.stringify({
        $schema: taskSchemaUri,
        name: "Cache test",
        runtime: { type: "node", minVersion: "22.13.0" },
        entry: "worker.cjs",
        inputSchema: { type: "object" },
        resultSchema: true,
        messageSchema: false,
      }),
    );
    const gate = join(root, "release");
    await writeFile(
      callback,
      `import {existsSync} from "node:fs";
export default async (input, context) => {
while(input.hold && !existsSync(${JSON.stringify(gate)})) {
context.signal.throwIfAborted(); await new Promise(resolve=>setTimeout(resolve,5));
} return input;
};`,
    );
    const built = await buildTaskBundle({
      declaration,
      entry: callback,
      outDirectory: join(root, "bundle"),
    });
    const packed = await packTaskBundle(built.directory, join(root, "bundle.tar.gz"));
    server = await startTaskServer({
      port: 0,
      store: new MemoryStore(),
      bundleDirectory: join(root, "cache"),
      authorize: (caller, operation) =>
        caller.subject === "admin" ||
        (caller.subject === "reader"
          ? operation === "cache-read"
          : !operation.startsWith("cache-")),
      resolveCaller(request) {
        const subject = request.headers.get("authorization");
        if (!subject) throw new TaskError("unauthenticated", "Authentication required.");
        return { subject, scope: "scope" };
      },
    });
    const fetchBounded: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(5000) });
    const client = (subject: string) =>
      new TaskClient({
        url: server!.url,
        headers: { Authorization: subject },
        fetch: fetchBounded,
      });
    const admin = client("admin"),
      reader = client("reader"),
      business = client("business");
    assert.equal((await fetchBounded(`${server.url}/bundle-cache`)).status, 401);
    await assert.rejects(business.listCachedBundles(), { code: "forbidden" });
    await assert.rejects(business.getCachedBundle(built.digest), { code: "forbidden" });
    await assert.rejects(business.removeCachedBundle(built.digest), { code: "forbidden" });
    await assert.rejects(reader.removeCachedBundle(built.digest), { code: "forbidden" });
    assert.deepEqual((await reader.listCachedBundles()).items, []);
    const requestId = newId();
    const request = {
      requestId,
      bundle: { url: pathToFileURL(packed.archive).href, digest: built.digest },
      timeoutMs: 5000,
      value: 42,
      eligibleAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await admin.submit(request);
    const decision = await admin.getRequestStatus(requestId, { waitMs: 5000 });
    assert.equal(decision.status, "accepted");
    if (decision.status !== "accepted") throw new Error("Expected accepted Task.");
    const page = await reader.listCachedBundles({ limit: 1 });
    assert.equal(page.items[0]!.digest, built.digest);
    assert.equal(page.items[0]!.name, "Cache test");
    const detail = await reader.getCachedBundle(built.digest);
    assert.equal(detail.declaration!.name, "Cache test");
    assert.ok(detail.bytes! > 0);
    assert.equal(JSON.stringify(detail).includes(root), false, "local paths are not exported");
    await assert.rejects(admin.listCachedBundles({ limit: 101 }), { code: "invalid_request" });
    const badQuery = await fetchBounded(`${server.url}/bundle-cache?limit=1&limit=2`, {
      headers: { Authorization: "admin" },
    });
    assert.equal(badQuery.status, 400);
    const withBody = await fetchBounded(`${server.url}/bundle-cache/${built.digest}`, {
      method: "DELETE",
      headers: { Authorization: "admin" },
      body: "not allowed",
    });
    assert.equal(withBody.status, 400);
    const activeId = newId();
    await admin.submit({
      requestId: activeId,
      bundle: request.bundle,
      timeoutMs: 10000,
      hold: true,
    });
    const active = await admin.getRequestStatus(activeId, { waitMs: 5000 });
    if (active.status !== "accepted") throw new Error("Active Task was not accepted.");
    const deadline = Date.now() + 10000;
    while ((await admin.getCachedBundle(built.digest)).leases === 0) {
      if (Date.now() > deadline) throw new Error("Run did not lease Bundle.");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const busy = await fetchBounded(`${server.url}/bundle-cache/${built.digest}`, {
      method: "DELETE",
      headers: { Authorization: "admin" },
    });
    assert.equal(busy.status, 409);
    const busyError = (await busy.json()) as { error: { code: string } };
    assert.equal(busyError.error.code, "bundle_in_use");
    await writeFile(gate, "release");
    while ((await admin.getCachedBundle(built.digest)).leases !== 0) {
      if (Date.now() > deadline) throw new Error("Run did not release Bundle.");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal((await admin.getTask(active.taskId)).stage, "completed");
    await admin.removeCachedBundle(built.digest);
    assert.deepEqual((await admin.listCachedBundles()).items, []);
    assert.equal((await admin.getTask(decision.taskId)).stage, "initial");
    assert.deepEqual(await admin.getRequest(requestId), request);
    assert.equal((await admin.getTask(active.taskId)).stage, "completed");
    assert.ok((await readFile(packed.archive)).length);
    await assert.rejects(admin.getCachedBundle(built.digest), { code: "not_found" });
    await admin.removeCachedBundle(built.digest);
    await admin.cancelTask(decision.taskId);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
