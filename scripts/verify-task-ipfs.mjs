import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { checkTaskArtifact } from "../packages/pguide-task-bundle/dist/artifact.js";
import { createIpfsGatewayClient, newId } from "../packages/task-engine/dist/index.js";
import { TaskClient } from "../packages/task-engine-http/dist/index.js";
import { startTaskServer } from "../packages/task-engine-server/dist/index.js";

// Independently import the CAR first. This verifier never uploads, pins or starts an IPFS service.
assert.ok(process.env.TASK_BUNDLE_CAR, "Set TASK_BUNDLE_CAR to an independently imported CAR.");
assert.ok(process.env.IPFS_GATEWAY, "Set IPFS_GATEWAY to its loopback Trustless Gateway.");
assert.ok(
  process.env.TASK_EXPECTED_RESULT,
  "Set TASK_EXPECTED_RESULT to the expected JSON result.",
);
const gateway = new URL(process.env.IPFS_GATEWAY);
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(gateway.hostname),
  "Verification is loopback-only.",
);
const { cid } = await checkTaskArtifact(resolve(process.env.TASK_BUNDLE_CAR));
const expected = JSON.parse(process.env.TASK_EXPECTED_RESULT);
const directory = resolve(".cache", `official-ipfs-proof-${randomUUID()}`);
await mkdir(directory, { recursive: true });
let server;
try {
  server = await startTaskServer({
    database: resolve(directory, "facts.sqlite"),
    ipfsClient: createIpfsGatewayClient(gateway.href),
    port: 0,
    authorize: () => true,
    resolveCaller: () => ({ scope: "proof", subject: "local" }),
  });
  const client = new TaskClient({ url: server.url });
  const request = { requestId: newId(), bundle: cid, timeoutMs: 30_000 };
  await client.submit(request);
  let decision;
  do {
    decision = await client.getRequestStatus(request.requestId, { waitMs: 10_000 });
  } while (decision.status === "preparing");
  assert.equal(decision.status, "accepted", JSON.stringify(decision));
  const deadline = Date.now() + 30_000;
  for (;;) {
    const task = await client.getTask(decision.taskId);
    if (task.termination && (await client.getRun(task.run.runId)).reclaimedAt) {
      assert.equal(task.stage, "completed", JSON.stringify(task));
      assert.deepEqual(task.result, expected);
      console.log(
        JSON.stringify({
          cid,
          gateway: gateway.origin,
          result: task.result,
          reclaimed: true,
          uploadOrPin: false,
        }),
      );
      break;
    }
    assert.ok(Date.now() < deadline, JSON.stringify(task));
    await new Promise((done) => setTimeout(done, 10));
  }
} finally {
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
