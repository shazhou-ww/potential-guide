import assert from "node:assert/strict";
import test from "node:test";
import { type JsonObject, json, type TaskType } from "@potential-guide/task-protocol";
import { createTaskEngine, newId } from "../src/index.js";
import { createExecutorPool } from "../src/pool.js";
import { MemoryStore } from "../src/testing.js";
import { caller, flush, harness, validateEcho } from "./fixtures.js";

test("startup captures one trusted timestamp even if time advances on every clock read", async () => {
  const store = new MemoryStore();
  let now = 1_800_000_000_000;
  let starts = 0;
  const pool = createExecutorPool<JsonObject>({
    resources: ["js"],
    resourceKey: () => "js",
    run(input, permit) {
      starts++;
      const event = store.read().events.find((event) => event.type === "execution.started");
      assert.equal(event?.occurredAt, permit.startedAt);
      return {
        result: Promise.resolve(input),
        exited: Promise.resolve(),
        cooperate() {},
        async force() {},
        async cleanup() {},
      };
    },
  });
  const type: TaskType<JsonObject> = {
    type: "echo",
    version: "1",
    environment: "js",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    prepare: async (input) => input,
    validatePrepared: validateEcho,
    validateResult: json,
    validateProgress: json,
    execute: (input, options) => pool.execute(input, options),
  };
  const engine = createTaskEngine({
    store,
    clock: { now: () => ++now, schedule: () => () => {} },
    types: [type],
    currentVersions: { echo: "1" },
    authorize: () => true,
  });
  engine.start();
  try {
    const task = engine.submit(
      { requestId: newId(), type: "echo", text: "time", timeoutMs: 10000 },
      caller,
    );
    engine.tick();
    await flush();
    engine.tick();
    await flush();
    engine.tick();
    assert.equal(starts, 1);
    assert.equal(engine.getTask(task.taskId, caller).stage, "completed");
    assert.ok(Object.values(store.read().facts.executions)[0]?.reclaimedAt);
  } finally {
    await engine.close();
    await pool.close();
    store.close();
  }
});

test("failed durable startup prevents business invocation and releases reserved Pool resource", async () => {
  const h = harness();
  try {
    const task = h.submit();
    h.clock.advance(1);
    h.engine.tick();
    await flush();
    let armed = true;
    h.store.beforeCommit = () => {
      if (armed) {
        armed = false;
        throw new Error("startup commit rejected");
      }
    };
    h.engine.tick();
    await flush();
    assert.equal(h.work.length, 0);
    assert.equal(h.pool.stats.idle, 2);
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "allocation_failed");
    assert.equal(h.engine.getTask(task.taskId, caller).error?.code, "storage_failure");
    assert.equal(Object.keys(h.store.read().facts.executions).length, 0);
  } finally {
    await h.close();
  }
});

test("registered environment is detached from subsequent author object mutation", async () => {
  const h = harness();
  try {
    const task = h.submit();
    h.clock.advance(1);
    h.engine.tick();
    await flush();
    h.type.environment = "different-runtime";
    h.engine.tick();
    await flush();
    assert.equal(h.work.length, 1);
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "running");
    assert.equal(h.store.read().facts.tasks[task.taskId]?.binding.environment, "js-v1");
  } finally {
    await h.close();
  }
});

test("Task and event backpressure preserve final facts and expose payload failures", async () => {
  const h = harness({ limits: { maxEvents: 64 } });
  try {
    const task = h.submit();
    await h.turn();
    for (let index = 0; index < 100; index++) h.work[0]?.permit.progress({ index });
    await flush();
    h.engine.tick();
    await flush();
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "execution_failed");
    assert.equal(h.engine.getTask(task.taskId, caller).error?.code, "capacity_exceeded");
    assert.ok(h.store.read().events.length <= 64);
    assert.equal(h.pool.stats.idle, 2);
  } finally {
    await h.close();
  }
});

test("execution wall timer survives business-clock rollback independently of Task deadline", async () => {
  const h = harness({ limits: { executionWallMs: 5 } });
  try {
    const task = h.submit({ timeoutMs: 1000 });
    await h.turn();
    h.clock.setTime(h.clock.now() - 10000);
    await h.turn(5);
    await flush();
    h.engine.tick();
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "execution_failed");
    assert.equal(h.work[0]?.stops.length, 1);
    assert.equal(h.pool.stats.idle, 2);
  } finally {
    await h.close();
  }
});
