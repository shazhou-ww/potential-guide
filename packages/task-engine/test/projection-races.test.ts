import assert from "node:assert/strict";
import test from "node:test";
import { at, isTimedOut, project } from "@potential-guide/task-protocol";
import { caller, flush, harness } from "./fixtures.js";

for (const outcome of ["completed", "failed"] as const) {
  for (const offset of [-1, 0, 1]) {
    for (const tickFirst of [false, true]) {
      test(`shared ${outcome} at eligible${offset >= 0 ? "+" : ""}${offset}, tickFirst=${tickFirst}, agrees with cancellation`, async () => {
        const h = harness();
        try {
          const original = h.submit({ timeoutMs: 1000 });
          await h.turn();
          await h.turn(10);
          const task = h.submit({ executionMatch: "completed-after-eligible" });
          await h.turn();
          assert.equal(h.work.length, 1);
          assert.equal(
            h.engine.getTask(task.taskId, caller).execution?.executionId,
            h.engine.getTask(original.taskId, caller).execution?.executionId,
          );
          h.clock.setTime(Date.parse(task.eligibleAt) + offset);
          if (outcome === "completed") await h.finish();
          else {
            h.work[0]?.done.reject(new Error("shared execution failed after clock adjustment"));
            h.work[0]?.exit.resolve();
            await flush();
          }
          h.clock.setTime(Date.parse(task.deadlineAt) + 1);
          const inapplicable = outcome === "completed" && offset <= 0;
          assert.equal(isTimedOut(h.engine.getTask(task.taskId, caller)), inapplicable);
          if (tickFirst) {
            h.engine.tick();
            assert.equal(isTimedOut(h.engine.getTask(task.taskId, caller)), inapplicable);
          }
          if (inapplicable) {
            const canceled = h.engine.cancelTask(task.taskId, caller);
            assert.ok(canceled.canceledAt);
            assert.equal(canceled.stage, "running");
            assert.equal(canceled.termination, undefined);
            assert.equal(canceled.result, undefined);
            assert.equal(canceled.execution?.completedAt, undefined);
            assert.ok(isTimedOut(canceled));
          } else {
            assert.throws(() => h.engine.cancelTask(task.taskId, caller), {
              code: "task_finished",
            });
            assert.equal(
              h.engine.getTask(task.taskId, caller).stage,
              outcome === "completed" ? "completed" : "execution_failed",
            );
            assert.equal(isTimedOut(h.engine.getTask(task.taskId, caller)), false);
          }
        } finally {
          await h.close();
        }
      });
    }
  }
}

test("sealing blocks new owners but retains an applicable late completion for its existing owner", async () => {
  const h = harness({ resources: ["js"] });
  try {
    const original = h.submit({ timeoutMs: 5 });
    await h.turn();
    await h.turn(10);
    const execute = h.type.execute;
    h.type.execute = (input, options) =>
      execute(input, {
        ...options,
        authorizeReplacement(id, generation) {
          const authorized = options.authorizeReplacement(id, generation);
          if (authorized) h.work[0]?.permit.complete({ text: "late but applicable" });
          return authorized;
        },
      });
    h.submit({ text: "replacement" });
    await h.turn();
    await flush();
    h.engine.tick();
    const task = h.engine.getTask(original.taskId, caller);
    assert.equal(task.stage, "completed");
    assert.ok(isTimedOut(task));
    assert.deepEqual(task.result, { text: "late but applicable" });
    assert.ok(h.store.read().facts.executions[task.execution?.executionId ?? ""]?.sealed);
  } finally {
    await h.close();
  }
});

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
