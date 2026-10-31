import assert from "node:assert/strict";
import test from "node:test";
import type { RunPage, PublicEvent, TaskSnapshot } from "@potential-guide/task-protocol";
import { ObservationEnd, taskStatus } from "../src/lifecycle.js";
import { Directory } from "../src/model.js";

const task: TaskSnapshot = {
  taskId: "task",
  requestId: "request",
  seriesId: "series",
  stage: "running",
  receivedAt: "2026-10-31T00:00:00.000Z",
  eligibleAt: "2026-10-31T00:00:00.000Z",
  deadlineAt: "2026-10-31T00:00:01.000Z",
  timestamp: "2026-10-31T00:00:02.000Z",
  run: { runId: "execution", startedAt: "2026-10-31T00:00:00.000Z" },
};
const event = (type: PublicEvent["type"], data: PublicEvent["data"] = {}): PublicEvent => ({
  type,
  sequence: 1,
  occurredAt: "2026-10-31T00:00:02.000Z",
  scope: "scope",
  runId: "execution",
  data,
});
test("frozen Execution summaries can prove completed reclamation without a history grant", async () => {
  const end = new ObservationEnd("runId", "execution");
  end.summary({
    runId: "execution",
    type: "echo",
    version: "1",
    startedAt: task.receivedAt,
    completedAt: task.timestamp,
    reclaimedAt: task.timestamp,
    state: { running: false, completed: true, failed: false, reclaimed: true, sealed: true },
  });
  assert.equal(end.ended, true);
  const directory = new Directory<RunPage>("runs");
  await assert.rejects(
    () =>
      directory.load(
        async () => ({ runs: [{}], observedAt: "now", expiresAt: "later" }) as RunPage,
        "",
      ),
    /摘要协议无效/,
  );
  assert.equal(directory.page, undefined);
  assert.match(directory.error, /协议无效/);
});
test("timeout stays independent; completed Task waits for actual execution reclamation", () => {
  const end = new ObservationEnd("taskId", "task");
  end.feed([], task);
  assert.equal(end.ended, false);
  assert.equal(taskStatus(task), "Run 尝试中 · 已超时");
  const completed: TaskSnapshot = {
    ...task,
    stage: "completed",
    termination: { terminatedAt: task.timestamp },
    run: { ...task.run!, completedAt: task.timestamp },
    result: { ok: false },
  };
  end.feed([event("run.completed", { result: { ok: false } })], completed);
  assert.equal(taskStatus(completed), "已完成 · 已超时");
  assert.equal(end.ended, false);
  end.feed([event("run.reclaimed")], completed);
  assert.equal(end.ended, true);
});
test("cancellation does not invent execution shutdown; ended Execution needs logical and physical facts", () => {
  const end = new ObservationEnd("taskId", "task");
  const canceled = { ...task, canceledAt: task.timestamp };
  end.feed([{ ...event("task.canceled", { runIds: ["execution"] }), taskId: "task" }], canceled);
  assert.equal(end.ended, false);
  end.feed([event("run.reclaimed")], canceled);
  assert.equal(end.ended, false);
  end.feed([event("run.failed", { error: { code: "stopped", message: "stopped" } })], canceled);
  assert.equal(end.ended, true);
  const execution = new ObservationEnd("runId", "execution");
  execution.feed([event("run.completed", { result: false })]);
  assert.equal(execution.ended, false);
  execution.feed([event("run.reclaimed")]);
  assert.equal(execution.ended, true);
});
test("unbound cancellation needs explicit absence of releases; history can establish the end", () => {
  const { run: _run, ...unbound } = task;
  const canceled: TaskSnapshot = { ...unbound, stage: "initial", canceledAt: task.timestamp };
  const end = new ObservationEnd("taskId", "task");
  end.feed([], canceled);
  assert.equal(end.ended, false);
  end.feed(
    [
      {
        sequence: 1,
        type: "task.canceled",
        taskId: "task",
        occurredAt: task.timestamp,
        scope: "scope",
        data: { runIds: [] },
      },
    ],
    canceled,
  );
  assert.equal(end.ended, true);
});
