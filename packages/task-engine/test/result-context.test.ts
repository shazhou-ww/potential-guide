import assert from "node:assert/strict";
import test from "node:test";
import { json, type Json, type TaskType } from "@potential-guide/task-protocol";
import { createTaskEngine, newId } from "../src/index.js";
import { MemoryStore, VirtualClock } from "../src/testing.js";

test("optional execution result validator receives original frozen Prepared at report and history without changing legacy validators", async () => {
  const store = new MemoryStore();
  const clock = new VirtualClock();
  let validations = 0;
  const type: TaskType<Json> = {
    type: "bound",
    version: "1",
    environment: "test",
    inputSchema: { type: "object" },
    prepare: async (value) => ({ original: value }),
    validatePrepared: json,
    validateResult: json,
    validateProgress: json,
    validateExecutionResult(value, prepared) {
      assert.deepEqual(prepared, { original: { text: "bound" } });
      assert.ok(Object.isFrozen(prepared));
      validations++;
      return json(value);
    },
    async execute(_prepared, options) {
      const permit = options.start();
      permit.complete({ ok: true });
      return { ...permit, finished: Promise.resolve(), async reclaim() {} };
    },
  };
  const engine = createTaskEngine({
    store,
    clock,
    types: [type],
    currentVersions: { bound: "1" },
    authorize: () => true,
  });
  engine.start();
  try {
    const caller = { scope: "a", subject: "test" };
    const task = engine.submit(
      { requestId: newId(), type: "bound", text: "bound", timeoutMs: 100 },
      caller,
    );
    clock.advance(1);
    for (let turn = 0; turn < 3; turn++) {
      engine.tick();
      for (let index = 0; index < 30; index++) await Promise.resolve();
    }
    assert.equal(engine.getTask(task.taskId, caller).stage, "completed");
    const before = validations;
    engine.readHistory({ taskId: task.taskId }, {}, caller);
    engine.readHistory(
      { executionId: engine.getTask(task.taskId, caller).execution!.executionId },
      {},
      caller,
    );
    assert.ok(validations > before);
  } finally {
    await engine.close();
    store.close();
  }
});
