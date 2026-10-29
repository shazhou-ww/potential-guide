import assert from "node:assert/strict";
import test from "node:test";
import { at, isTimedOut, project } from "@potential-guide/task-protocol";
import { caller, flush, harness } from "./fixtures.js";

for (const outcome of ["completed", "failed"] as const) {
  for (const late of [false, true]) {
    test(`durable ${outcome}, late=${late}, fixes timeout before coordinator settlement`, async () => {
      const h = harness();
      try {
        const task = h.submit();
        await h.turn();
        if (late) h.clock.setTime(Date.parse(task.deadlineAt) + 1);
        const endedAt = at(h.clock.now());
        if (outcome === "completed") await h.finish();
        else {
          h.work[0]?.done.reject(new Error("reliable execution failure"));
          h.work[0]?.exit.resolve();
          await flush();
        }
        const prefix = h.store.read().facts;
        assert.equal(prefix.tasks[task.taskId]?.snapshot.termination, undefined);
        h.clock.setTime(Date.parse(task.deadlineAt) + 2);
        const saved = JSON.stringify(prefix);
        const before = project(prefix, task.taskId, h.clock.now());
        assert.equal(JSON.stringify(prefix), saved, "projection must not write a Task judgment");
        assert.deepEqual(before, h.engine.getTask(task.taskId, caller));
        assert.equal(isTimedOut(before), late);
        assert.equal(
          outcome === "completed" ? before.execution?.completedAt : before.execution?.failedAt,
          endedAt,
        );
        assert.equal(before.stage, "running", "projection does not invent a Task judgment");
        assert.equal(before.termination, undefined);
        assert.equal(
          before.result,
          undefined,
          "result still requires the Task's successful judgment",
        );
        assert.throws(() => h.engine.cancelTask(task.taskId, caller), { code: "task_finished" });
        h.engine.tick();
        const after = h.engine.getTask(task.taskId, caller);
        assert.equal(after.stage, outcome === "completed" ? "completed" : "execution_failed");
        assert.equal(
          isTimedOut(after),
          isTimedOut(before),
          "settlement cannot revoke an observed timeout",
        );
      } finally {
        await h.close();
      }
    });
  }
}

test("projection does not borrow an unbound or time-ineligible completion", async () => {
  const h = harness();
  try {
    const task = h.submit();
    await h.turn();
    await h.finish();
    const prefix = h.store.read().facts;
    const record = prefix.tasks[task.taskId];
    assert.ok(record?.snapshot.execution);
    const execution = prefix.executions[record.snapshot.execution.executionId];
    assert.ok(execution?.completedAt);
    const time = Date.parse(task.deadlineAt) + 1;
    for (const match of ["started-after-eligible", "completed-after-eligible"] as const) {
      record.binding.executionMatch = match;
      record.snapshot.eligibleAt =
        match === "started-after-eligible" ? execution.startedAt : execution.completedAt;
      assert.equal(project(prefix, task.taskId, time).execution?.completedAt, undefined);
      assert.ok(isTimedOut(project(prefix, task.taskId, time)));
    }
    delete record.snapshot.execution;
    delete record.snapshot.allocation;
    record.snapshot.stage = "queued";
    assert.ok(isTimedOut(project(prefix, task.taskId, time)));
  } finally {
    await h.close();
  }
});

test("cancel-first snapshot stays frozen when a shared Execution later completes", async () => {
  const h = harness();
  try {
    const canceled = h.submit();
    h.submit();
    await h.turn();
    const frozen = h.engine.cancelTask(canceled.taskId, caller);
    await h.finish();
    h.clock.setTime(Date.parse(canceled.deadlineAt) + 1);
    const after = h.engine.getTask(canceled.taskId, caller);
    assert.deepEqual({ ...after, timestamp: frozen.timestamp }, frozen);
    assert.equal(after.execution?.completedAt, undefined);
    assert.equal(after.result, undefined);
    assert.equal(isTimedOut(after), false);
  } finally {
    await h.close();
  }
});
