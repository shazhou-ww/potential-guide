import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Shared Linux/macOS/Windows verification; no repository or Kubo dependency. */
export async function verifyConsumer(serviceUrl, fixture) {
  const endpoint = new URL(serviceUrl);
  assert.ok(["http:", "https:"].includes(endpoint.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname));
  assert.equal(endpoint.pathname, "/");
  assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash);
  assert.equal(typeof fixture.bundle, "string", "A pre-delivered root CID is required.");
  assert.ok(fixture.input && typeof fixture.input === "object" && !Array.isArray(fixture.input));
  assert.ok(Object.hasOwn(fixture, "expectedResult"), "Delivery must specify the expected result.");
  const signal = AbortSignal.timeout(30_000);
  const request = async (path, init = {}) => {
    const response = await fetch(new URL(path, endpoint), { ...init, signal, redirect: "error" });
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify(value));
    return value;
  };
  await request("/tasks");
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let identity = (BigInt(Date.now()) << 80n) | BigInt(`0x${randomBytes(10).toString("hex")}`);
  const requestId = Array.from({ length: 26 }, () => {
    const character = alphabet[Number(identity & 31n)];
    identity >>= 5n;
    return character;
  })
    .reverse()
    .join("");
  await request("/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": requestId },
    body: JSON.stringify({ ...fixture.input, bundle: fixture.bundle, timeoutMs: 15_000 }),
  });
  let accepted;
  for (;;) {
    accepted = await request(`/requests/${requestId}/status?waitMs=1000`);
    if (accepted.status !== "preparing" && accepted.status !== "unknown") break;
    await new Promise((done) => setTimeout(done, 50));
    signal.throwIfAborted();
  }
  assert.equal(accepted.status, "accepted", JSON.stringify(accepted));
  for (;;) {
    const task = await request(`/tasks/${accepted.taskId}`);
    if (task.stage === "completed") {
      assert.equal(task.requestId, requestId);
      assert.equal(task.taskId, accepted.taskId);
      assert.equal(task.bundle, fixture.bundle);
      assert.ok(task.run?.runId, "Completed Task must identify its Run.");
      assert.deepEqual(task.result, fixture.expectedResult);
      return {
        requestId,
        taskId: task.taskId,
        runId: task.run.runId,
        bundle: task.bundle,
        result: task.result,
      };
    }
    assert.ok(!["failed", "canceled", "timed_out"].includes(task.stage), JSON.stringify(task));
    await new Promise((done) => setTimeout(done, 50));
    signal.throwIfAborted();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , url, filename] = process.argv;
  assert.ok(url && filename, "Usage: node verify-consumer.mjs <service-url> <delivery.json>");
  console.log(
    JSON.stringify(await verifyConsumer(url, JSON.parse(await readFile(filename, "utf8")))),
  );
}
