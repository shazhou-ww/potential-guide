import assert from "node:assert/strict";
import test from "node:test";
import type { PublicEvent, RunPage, TaskSnapshot } from "@potential-guide/task-protocol";
import { ObservationEnd, taskStatus, taskStatusExplanation } from "../src/lifecycle.js";
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
  updatedAt: "2026-10-31T00:00:00.000Z",
  dataDomain: "domain",
  revision: "domain:1",
  canceled: false,
  run: { runId: "execution", startedAt: "2026-10-31T00:00:00.000Z" },
};
const event = (type: PublicEvent["type"], data: PublicEvent["data"] = {}): PublicEvent => ({
  type,
  sequence: 1,
  revision: "domain:1",
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
    scope: "scope",
    stage: "completed",
    startedSequence: 1,
    updatedAt: task.timestamp,
    stopRequested: true,
    state: {
      running: false,
      completed: true,
      failed: false,
      stopping: false,
      stopped: false,
      reclaimed: true,
      sealed: true,
    },
  });
  assert.equal(end.ended, true);
  const directory = new Directory<RunPage>("runs");
  await assert.rejects(
    () =>
      directory.load(
        async () =>
          ({
            runs: [{}],
            items: [{}],
            revision: "domain:1",
            observedAt: "now",
            expiresAt: "later",
          }) as RunPage,
        "",
      ),
    /摘要协议无效/,
  );
  assert.equal(directory.page, undefined);
  assert.match(directory.error, /协议无效/);
});
test("time stays independent; a terminal matched Task remains observable for later cancellation", () => {
  const end = new ObservationEnd("taskId", "task");
  end.feed([], task);
  assert.equal(end.ended, false);
  assert.equal(taskStatus(task, Date.parse(task.timestamp)), "已超时");
  assert.equal(taskStatusExplanation(task, Date.parse(task.timestamp)), "关联运行尚未结束");
  const completed: TaskSnapshot = {
    ...task,
    stage: "completed",
    termination: { terminatedAt: task.timestamp },
    run: { ...task.run!, completedAt: task.timestamp },
    result: { ok: false },
  };
  end.feed([event("run.exited", { basis: "worker" })], completed);
  assert.equal(taskStatus(completed, Date.parse(task.timestamp)), "已完成");
  assert.equal(taskStatusExplanation(completed, Date.parse(task.timestamp)), "");
  assert.equal(end.ended, false);
  end.feed([event("run.reclaimed")], completed);
  assert.equal(end.ended, false);
});
test("cancellation does not invent execution shutdown; ended Execution needs logical and physical facts", () => {
  const end = new ObservationEnd("taskId", "task");
  const canceled = { ...task, canceled: true, canceledAt: task.timestamp };
  assert.equal(taskStatus(canceled, Date.parse(task.timestamp)), "已取消");
  assert.equal(taskStatusExplanation(canceled, Date.parse(task.timestamp)), "关联运行尚未结束");
  assert.equal(
    taskStatusExplanation({ ...canceled, stage: "completed" }, Date.parse(task.timestamp)),
    "需求已撤回",
  );
  end.feed([{ ...event("task.canceled", { runIds: ["execution"] }), taskId: "task" }], canceled);
  assert.equal(end.ended, false);
  end.feed([event("run.reclaimed")], canceled);
  assert.equal(end.ended, false);
  end.feed([event("run.exited", { basis: "worker" })], canceled);
  assert.equal(end.ended, false);
  const execution = new ObservationEnd("runId", "execution");
  execution.feed([event("run.exited", { basis: "worker" })]);
  assert.equal(execution.ended, false);
  execution.feed([event("run.reclaimed")]);
  assert.equal(execution.ended, true);
});
test("an unbound canceled snapshot proves there can be no future Run matching", () => {
  const { run: _run, ...unbound } = task;
  const canceled: TaskSnapshot = {
    ...unbound,
    stage: "initial",
    canceled: true,
    canceledAt: task.timestamp,
  };
  const end = new ObservationEnd("taskId", "task");
  end.feed([], canceled);
  assert.equal(end.ended, true);
  end.feed(
    [
      {
        sequence: 1,
        revision: "domain:1",
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
