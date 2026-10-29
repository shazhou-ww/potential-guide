import assert from "node:assert/strict";
import test from "node:test";
import {
  at,
  canonical,
  emptyFacts,
  isCanceled,
  isCompleted,
  isExecutionFailed,
  isPending,
  isTimedOut,
  type JsonObject,
  json,
  project,
  reduce,
  type TaskType,
} from "@potential-guide/task-protocol";
import { createTaskEngine, newId } from "../src/index.js";
import { MemoryStore, VirtualClock } from "../src/testing.js";
import { caller, deferred, echoEquals, flush, harness, validateEcho } from "./fixtures.js";

test("initial is fact-based; identity prepare, two generic types and independent time dimensions", async () => {
  const h = harness();
  try {
    const task = h.submit({ eligibleAt: at(h.clock.now() + 20) });
    assert.equal(task.stage, "initial");
    assert.ok(isPending(task));
    h.clock.setTime(h.clock.now() + 20);
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "initial");
    assert.equal(isPending(h.engine.getTask(task.taskId, caller)), false);
    await h.turn();
    assert.equal(h.prepares(), 1);
    assert.equal(h.work.length, 1);
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "running");
    await h.finish();
    h.engine.tick();
    h.clock.advance(1000);
    const finished = h.engine.getTask(task.taskId, caller);
    assert.ok(isCompleted(finished));
    assert.equal(isTimedOut(finished), false);
    assert.deepEqual(finished.result, { text: "hello" });
    for (const key of ["type", "request", "state", "revision", "progress", "executionMatch"])
      assert.equal(key in finished, false);
    assert.throws(() => h.submit({ type: "sum", text: undefined } as never), {
      code: "invalid_payload",
    });
    const sum = h.engine.submit(
      { requestId: newId(), type: "sum", values: [2, 3], timeoutMs: 100 },
      caller,
    );
    await h.turn();
    assert.equal(h.work.at(-1)?.input.text, "5");
    await h.finish(1, { sum: 5 });
    h.engine.tick();
    assert.deepEqual(h.engine.getTask(sum.taskId, caller).result, { sum: 5 });
  } finally {
    await h.close();
  }
});

test("admission validates full intent, strict JSON, original omissions, authorization and equals", async () => {
  const h = harness();
  try {
    const task = h.submit();
    const raw = h.engine.getRequest(task.requestId, caller);
    assert.equal("eligibleAt" in raw, false);
    assert.equal("executionMatch" in raw, false);
    assert.equal(h.engine.submit(raw, caller).taskId, task.taskId);
    for (const patch of [
      { type: "sum", values: [1] },
      { executionMatch: "completed-after-eligible" },
      { timeoutMs: 101 },
    ])
      assert.throws(() => h.engine.submit({ ...raw, ...patch }, caller), {
        code: "idempotency_conflict",
      });
    for (const patch of [
      { prerequisites: [] },
      { recurrence: { periodMs: 2 } },
      { timeoutMs: 0 },
      { timeoutMs: Infinity },
      { type: "unknown" },
    ])
      assert.throws(() => h.submit(patch));
    assert.throws(() => h.engine.getTask(task.taskId, { scope: "b", subject: "tester" }), {
      code: "forbidden",
    });
    assert.throws(
      () => h.engine.submit({ ...raw, requestId: newId() }, { scope: "a", subject: "attacker" }),
      { code: "forbidden" },
    );
    assert.equal(h.work.length, 0);
    const a = Object.freeze({ text: "a" });
    assert.equal(echoEquals(a, 2), false);
    assert.equal(echoEquals(a, a), true);
    assert.equal(echoEquals(a, { text: "a" }), echoEquals({ text: "a" }, a));
    assert.equal(echoEquals(a, { text: "b" }), false);
    assert.equal(canonical(validateEcho(a)), canonical(a));
  } finally {
    await h.close();
  }
});

test("sharing uses prepared content, scope and eligibility; Task cancellation freezes independently", async () => {
  const h = harness();
  try {
    const a = h.submit();
    const b = h.submit();
    await h.turn();
    assert.equal(h.work.length, 1);
    assert.equal(
      h.engine.getTask(a.taskId, caller).execution?.executionId,
      h.engine.getTask(b.taskId, caller).execution?.executionId,
    );
    const frozen = h.engine.cancelTask(a.taskId, caller);
    assert.equal(frozen.stage, "running");
    assert.equal(h.work[0]?.stops.length, 0);
    await h.finish();
    h.engine.tick();
    const after = h.engine.getTask(a.taskId, caller);
    assert.ok(isCanceled(after));
    assert.equal(after.stage, "running");
    assert.equal(after.result, undefined);
    assert.equal(after.execution?.completedAt, undefined);
    assert.ok(isCompleted(h.engine.getTask(b.taskId, caller)));
    assert.equal(h.engine.cancelTask(a.taskId, caller).canceledAt, frozen.canceledAt);
    assert.throws(() => h.engine.cancelTask(b.taskId, caller), { code: "task_finished" });
  } finally {
    await h.close();
  }
});

test("normal not-performed business results complete; business exceptions fail only execution", async () => {
  const h = harness();
  try {
    const a = h.submit();
    await h.turn();
    await h.finish(0, { performed: false, reason: "unavailable" });
    h.engine.tick();
    assert.equal(h.engine.getTask(a.taskId, caller).stage, "completed");
    await h.turn(5);
    assert.equal(h.work.length, 1, "no automatic readiness retry");
    const b = h.submit();
    await h.turn();
    h.work[1]?.done.reject(new Error("business preflight fault"));
    h.work[1]?.exit.resolve();
    await flush();
    h.engine.tick();
    assert.ok(isExecutionFailed(h.engine.getTask(b.taskId, caller)));
  } finally {
    await h.close();
  }
});

test("deadline equality, durable completion before cancellation and late result adoption", async () => {
  for (const lateness of [0, 1]) {
    const h = harness();
    try {
      const task = h.submit();
      await h.turn();
      h.clock.advance(Date.parse(task.deadlineAt) - h.clock.now() + lateness);
      await h.finish();
      // No Task coordinator turn has processed completion.
      assert.throws(() => h.engine.cancelTask(task.taskId, caller), { code: "task_finished" });
      h.clock.advance(10000);
      const result = h.engine.getTask(task.taskId, caller);
      assert.ok(isCompleted(result));
      assert.equal(isTimedOut(result), lateness > 0);
    } finally {
      await h.close();
    }
  }
});

test("expired preparation retracts; late prepare cannot launch and initial/preparing cancellation freezes", async () => {
  const preparation = deferred<JsonObject>();
  let aborted = false;
  const h = harness({
    prepare: async (_input, options) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
      });
      return preparation.promise;
    },
  });
  try {
    const a = h.submit({ eligibleAt: at(h.clock.now() + 20) });
    assert.equal(h.engine.cancelTask(a.taskId, caller).stage, "initial");
    const b = h.submit();
    await h.turn();
    assert.equal(h.engine.getTask(b.taskId, caller).stage, "preparing");
    await h.turn(101);
    assert.equal(aborted, true);
    preparation.resolve({ text: "hello" });
    await flush();
    await h.turn();
    assert.equal(h.work.length, 0);
    assert.ok(isTimedOut(h.engine.getTask(b.taskId, caller)));
    const c = h.submit();
    h.engine.tick();
    assert.equal(h.engine.cancelTask(c.taskId, caller).stage, "preparing");
    await flush();
    assert.equal(h.engine.getTask(c.taskId, caller).stage, "preparing");
  } finally {
    await h.close();
  }
});

test("allocation waits without running; expired queued owner retracts, not running owner", async () => {
  const h = harness({ resources: ["js"] });
  try {
    const a = h.submit({ text: "occupy", timeoutMs: 10 });
    await h.turn();
    const b = h.submit({ text: "queued", timeoutMs: 10 });
    await h.turn();
    assert.equal(h.engine.getTask(b.taskId, caller).stage, "queued");
    await h.turn(20);
    assert.equal(h.work[0]?.stops.length, 0);
    assert.equal(h.pool.stats.queued, 0);
    await h.finish();
    await h.turn();
    assert.equal(h.work.length, 1);
    assert.equal(h.engine.getTask(a.taskId, caller).stage, "completed");
    assert.ok(isTimedOut(h.engine.getTask(a.taskId, caller)));
    assert.equal(h.engine.getTask(b.taskId, caller).stage, "queued");
  } finally {
    await h.close();
  }
});

test("future matching completion adopted after deadline; completed-after may share older running work", async () => {
  const h = harness();
  try {
    const a = h.submit({ eligibleAt: at(h.clock.now() - 10) });
    await h.turn();
    const b = h.submit({ executionMatch: "completed-after-eligible" });
    await h.turn();
    assert.equal(h.work.length, 1);
    await h.finish();
    h.clock.advance(200);
    h.engine.tick();
    assert.ok(isCompleted(h.engine.getTask(b.taskId, caller)));
    assert.equal(isTimedOut(h.engine.getTask(b.taskId, caller)), false);
    assert.ok(isCompleted(h.engine.getTask(a.taskId, caller)));
  } finally {
    await h.close();
  }
});

test("mutable reference preparation versions and scope prevent sharing", async () => {
  let version = 0;
  const h = harness({ prepare: async (input) => ({ ...input, contentVersion: ++version }) });
  try {
    h.submit();
    h.submit();
    await h.turn();
    assert.equal(h.work.length, 2);
    assert.notEqual(h.work[0]?.permit.executionId, h.work[1]?.permit.executionId);
  } finally {
    await h.close();
  }
  const scoped = harness();
  try {
    scoped.submit();
    scoped.engine.submit(
      { requestId: newId(), type: "echo", text: "hello", timeoutMs: 100 },
      { ...caller, scope: "b" },
    );
    await scoped.turn();
    assert.equal(scoped.work.length, 2);
  } finally {
    await scoped.close();
  }
});

test("prepare validation fails before resource allocation; comparator defects are observable", async () => {
  const h = harness({ prepare: async () => ({ bad: Infinity }) });
  try {
    const task = h.submit();
    await h.turn();
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "preparation_failed");
    assert.equal(h.work.length, 0);
  } finally {
    await h.close();
  }
  const broken = harness();
  try {
    broken.submit();
    await broken.turn();
    broken.type.equals = () => {
      throw new Error("comparator defect");
    };
    broken.submit();
    await broken.turn();
    assert.ok(broken.engine.errors.some((error) => error.message === "comparator defect"));
    assert.equal(broken.work.length, 1);
  } finally {
    await broken.close();
  }
});

test("eligible recurrence keeps cadence and one pending, not one active", async () => {
  const h = harness({ resources: ["js", "js", "js", "js"] });
  try {
    const start = h.clock.now();
    const a = h.submit({ timeoutMs: 1000, recurrence: { anchor: "eligible", periodMs: 10 } });
    await h.turn(25);
    const records = Object.values(h.store.read().facts.tasks);
    assert.equal(records.length, 2);
    const b = records.find((task) => task.snapshot.taskId !== a.taskId);
    assert.equal(b?.snapshot.eligibleAt, at(start + 30));
    assert.notEqual(b?.request.requestId, a.requestId);
    assert.equal(b?.snapshot.seriesId, a.seriesId);
    await h.turn(5);
    const series = Object.values(h.store.read().facts.tasks);
    assert.equal(series.length, 3);
    assert.equal(
      series.filter((task) =>
        isPending(project(h.store.read().facts, task.snapshot.taskId, h.clock.now())),
      ).length,
      1,
    );
    assert.equal(
      series.filter(
        (task) => task.snapshot.eligibleAt <= at(h.clock.now()) && !task.snapshot.termination,
      ).length,
      2,
    );
    h.engine.cancelTask(a.taskId, caller);
    assert.equal(Object.values(h.store.read().facts.tasks).length, 3);
  } finally {
    await h.close();
  }
});

test("terminated recurrence anchors timeout at deadline and never repeats after late finish", async () => {
  const h = harness();
  try {
    const start = h.clock.now();
    const a = h.submit({ timeoutMs: 10, recurrence: { anchor: "terminated", periodMs: 20 } });
    await h.turn();
    await h.turn(54);
    let records = Object.values(h.store.read().facts.tasks);
    assert.equal(records.length, 2);
    const b = records.find((task) => task.snapshot.taskId !== a.taskId);
    assert.equal(b?.snapshot.eligibleAt, at(start + 70));
    assert.equal(h.engine.getTask(a.taskId, caller).termination, undefined);
    await h.turn(15);
    await h.finish();
    h.engine.tick();
    records = Object.values(h.store.read().facts.tasks);
    assert.equal(records.length, 2, "A cannot create C after B exits pending");
    assert.equal(
      records.find((task) => task.snapshot.taskId === a.taskId)?.successor?.taskId,
      b?.snapshot.taskId,
    );
  } finally {
    await h.close();
  }
});

test("capacity backpressure preserves recurrence planning and recovery references", async () => {
  const h = harness({ limits: { maxTasks: 1 } });
  try {
    const a = h.submit({ recurrence: { anchor: "eligible", periodMs: 10 } });
    assert.throws(() => h.submit(), { code: "capacity_exceeded" });
    await h.turn();
    assert.equal(h.store.read().facts.tasks[a.taskId]?.successor, undefined);
    h.engine.collect();
    assert.ok(h.store.read().facts.tasks[a.taskId]);
    h.engine.limits.maxTasks = 3;
    await h.turn();
    assert.ok(h.store.read().facts.tasks[a.taskId]?.successor);
  } finally {
    await h.close();
  }
});

test("history fixed watermarks, repeatable stream resumes, pure checkpoint equivalence", async () => {
  const h = harness();
  try {
    const task = h.submit();
    await h.turn();
    h.work[0]?.permit.progress({ percent: 1 });
    const page = h.engine.readHistory({ taskId: task.taskId }, { limit: 2 }, caller);
    h.work[0]?.permit.progress({ percent: 2 });
    assert.ok(page.next);
    const nextCursor = page.next;
    const second = h.engine.readHistory({ taskId: task.taskId }, { cursor: page.next }, caller);
    assert.ok(second.events.every((event) => event.sequence <= page.watermark));
    const sub = h.engine.subscribe({ taskId: task.taskId }, second.cursor, caller);
    assert.ok(sub.initial.events.some((event) => event.sequence > page.watermark));
    const repeat = h.engine.subscribe({ taskId: task.taskId }, second.cursor, caller);
    assert.deepEqual(repeat.initial.events, sub.initial.events);
    assert.throws(
      () => h.engine.readHistory({ seriesId: task.seriesId }, { cursor: nextCursor }, caller),
      { code: "invalid_cursor" },
    );
    sub.close();
    repeat.close();
    await h.finish();
    h.engine.tick();
    const view = h.store.read();
    assert.deepEqual(reduce(emptyFacts(), view.events), view.facts);
    const half = Math.floor(view.events.length / 2);
    assert.deepEqual(
      reduce(reduce(emptyFacts(), view.events.slice(0, half)), view.events.slice(half)),
      view.facts,
    );
    assert.deepEqual(reduce(view.facts, view.events), view.facts);
  } finally {
    await h.close();
  }
});

test("version-bound history and idempotency never silently use current validators", async () => {
  const store = new MemoryStore();
  const clock = new VirtualClock();
  const old: TaskType<JsonObject> = {
    type: "echo",
    version: "1",
    environment: "one",
    validate: validateEcho,
    equals: echoEquals,
    prepare: async (input) => input,
    validatePrepared: validateEcho,
    validateResult: json,
    validateProgress: json,
    async execute() {
      throw new Error("must not start future task");
    },
  };
  const options = {
    store,
    clock,
    types: [old],
    currentVersions: { echo: "1" },
    authorize: () => true,
  };
  const engine = createTaskEngine(options);
  engine.start();
  const raw = {
    requestId: newId(),
    type: "echo",
    text: "old",
    timeoutMs: 100,
    eligibleAt: at(clock.now() + 100),
  };
  const task = engine.submit(raw, caller);
  await engine.close();
  const newer = {
    ...old,
    version: "2",
    validate() {
      throw new Error("new validator must not interpret history");
    },
  };
  const restored = createTaskEngine({
    ...options,
    types: [old, newer],
    currentVersions: { echo: "2" },
  });
  restored.start();
  assert.equal(restored.submit(raw, caller).taskId, task.taskId);
  assert.deepEqual(restored.getRequest(raw.requestId, caller), raw);
  await restored.close();
  const unsupported = createTaskEngine({
    ...options,
    types: [newer],
    currentVersions: { echo: "2" },
  });
  assert.throws(() => unsupported.start(), { code: "unsupported_version" });
  store.close();
});

test("invalid business result becomes explicit execution failure, never a stranded running task", async () => {
  const h = harness();
  try {
    h.type.validateResult = () => {
      throw new Error("result schema defect");
    };
    const task = h.submit();
    await h.turn();
    await h.finish();
    h.engine.tick();
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "execution_failed");
    assert.equal(h.engine.getTask(task.taskId, caller).error?.code, "invalid_payload");
  } finally {
    await h.close();
  }
});

test("completed-after cannot adopt a completion equal to eligible; no premature running association", async () => {
  const h = harness();
  try {
    h.submit();
    await h.turn();
    const task = h.submit({ executionMatch: "completed-after-eligible" });
    h.engine.tick();
    await flush();
    h.engine.tick();
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "queued");
    await h.finish();
    h.engine.tick();
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "queued");
    await h.turn();
    assert.equal(h.work.length, 2);
  } finally {
    await h.close();
  }
});

test("fixed history page cannot retroactively gain an older Execution through a later binding", async () => {
  const h = harness();
  try {
    h.submit();
    await h.turn();
    const task = h.submit({ executionMatch: "completed-after-eligible" });
    h.engine.tick();
    await flush();
    const page = h.engine.readHistory({ taskId: task.taskId }, { limit: 1 }, caller);
    assert.ok(page.next);
    await h.turn();
    const rest = h.engine.readHistory({ taskId: task.taskId }, { cursor: page.next }, caller);
    assert.equal(
      rest.events.some((event) => event.executionId !== undefined),
      false,
    );
  } finally {
    await h.close();
  }
});
