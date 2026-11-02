import assert from "node:assert/strict";
import test from "node:test";
import type { SubmissionResult, TaskSnapshot } from "@potential-guide/task-protocol";
import { bundleDigest, newIdentity, SubmissionBar } from "../src/model.js";
import type { Endpoint } from "../src/server.js";

const endpoint: Endpoint = { id: "local", label: "Local", binding: "bound" };
const parameters = {
  bundle: { url: "https://example.test/task", digest: `sha256:${"a".repeat(64)}` },
  timeoutMs: 1000,
  value: 1,
};
test("V10: preparing is a Request receipt, never a fake Task snapshot; accepted is loaded by its actual Task ID", async () => {
  let seeds = 0;
  const taskId = newIdentity();
  const timestamp = new Date().toISOString();
  const bar = new SubmissionBar(
    async (entry) => ({ status: "preparing", requestId: entry.id, trackingToken: entry.id }),
    () => {},
    () => {
      seeds++;
    },
    async (entry) => ({ status: "accepted", requestId: entry.id, taskId }),
    async (entry, id): Promise<TaskSnapshot> => ({
      requestId: entry.id,
      taskId: id,
      seriesId: id,
      stage: "initial",
      dataDomain: "domain",
      revision: "domain:1",
      timestamp,
      receivedAt: timestamp,
      eligibleAt: timestamp,
      deadlineAt: timestamp,
      updatedAt: timestamp,
      canceled: false,
      bundle: parameters.bundle,
      name: "same name",
    }),
  );
  const entry = await bar.quick(endpoint, parameters, bundleDigest(parameters));
  assert.equal(entry.state, "preparing");
  assert.equal(entry.taskId, undefined);
  const snapshot = () => entry.snapshot;
  assert.equal(snapshot(), undefined);
  assert.equal(seeds, 0);
  const identity = entry.id;
  await bar.refresh(entry);
  assert.equal(entry.state, "accepted");
  assert.equal(entry.id, identity);
  assert.equal(entry.taskId, taskId);
  assert.equal(snapshot()?.taskId, taskId);
  assert.equal(seeds, 1);
});
test("V10: authoritative rejection and observation failure remain distinct; neither creates a Task card", async () => {
  let reject = false;
  let offline = false;
  const bar = new SubmissionBar(
    async (entry) => ({ status: "preparing", requestId: entry.id, trackingToken: entry.id }),
    undefined,
    undefined,
    async (entry): Promise<SubmissionResult> => {
      if (offline) throw new Error("connection stopped");
      return reject
        ? {
            status: "rejected",
            requestId: entry.id,
            error: { code: "invalid_input", message: "Invalid." },
          }
        : { status: "preparing", requestId: entry.id, trackingToken: entry.id };
    },
  );
  const entry = await bar.quick(endpoint, parameters, bundleDigest(parameters));
  offline = true;
  await bar.refresh(entry);
  assert.equal(entry.state, "preparing");
  assert.equal(entry.snapshot, undefined);
  offline = false;
  reject = true;
  await bar.refresh(entry);
  assert.equal(entry.state, "failed");
  assert.equal(entry.snapshot, undefined);
  assert.match(entry.message, /invalid_input/);
  assert.throws(() => bundleDigest({ type: "legacy" } as never), /旧类型模板/);
});
