import assert from "node:assert/strict";
import test from "node:test";
import {
  at,
  emptyFacts,
  isTimedOut,
  type JsonObject,
  reduce,
} from "@potential-guide/task-protocol";
import { createTaskEngine } from "../src/index.js";
import { MemoryStore } from "../src/testing.js";
import { caller, deferred, flush, harness } from "./fixtures.js";

for (const outcome of ["completed", "failed"] as const) {
  test(`terminate binds unprepared demand atomically at equality: ${outcome}`, async () => {
    const waiting = deferred<JsonObject>();
    let prepares = 0;
    const h = harness({
      prepare: async (input) => (++prepares === 1 ? input : waiting.promise),
    });
    try {
      const owner = h.submit();
      await h.turn();
      const follower = h.submit({ executionMatch: "terminated-after-eligible" });
      h.engine.tick();
      await flush();
      assert.equal(h.engine.getTask(follower.taskId, caller).stage, "preparing");
      assert.equal(h.engine.getTask(follower.taskId, caller).execution, undefined);
      h.clock.setTime(Date.parse(follower.eligibleAt));
      if (outcome === "completed") h.work[0]!.permit.complete({ text: "shared" });
      else h.work[0]!.permit.fail({ code: "business", message: "Failed" });
      const final = h.engine.getTask(follower.taskId, caller);
      assert.equal(final.stage, outcome === "completed" ? "completed" : "execution_failed");
      assert.equal(
        final.execution?.executionId,
        h.engine.getTask(owner.taskId, caller).execution?.executionId,
      );
      const view = h.store.read();
      const terminal = view.events.find((event) => event.type === `execution.${outcome}`)!;
      const bound = view.events.find(
        (event) => event.taskId === follower.taskId && event.type === "task.allocation.bound",
      )!;
      assert.ok(bound.sequence > terminal.sequence);
      assert.equal(bound.occurredAt, terminal.occurredAt);
      assert.deepEqual(reduce(emptyFacts(), view.events), view.facts);
      waiting.resolve({ text: "late" });
      await flush();
      assert.deepEqual(h.engine.getTask(follower.taskId, caller), final);
      assert.equal(h.work.length, 1);
      assert.throws(() => h.engine.cancelTask(follower.taskId, caller), { code: "task_finished" });
      const later = h.submit({ executionMatch: "terminated-after-eligible" });
      assert.equal(later.receivedAt, terminal.occurredAt);
      h.engine.tick();
      assert.equal(h.engine.getTask(later.taskId, caller).execution, undefined);
    } finally {
      waiting.resolve({ text: "late" });
      await h.close();
    }
  });
}

test("start binds all received input-equivalent tasks, not later same-millisecond requests", async () => {
  const firstPrepare = deferred<JsonObject>();
  const secondPrepare = deferred<JsonObject>();
  let prepares = 0;
  const h = harness({
    prepare: () => (++prepares === 1 ? firstPrepare.promise : secondPrepare.promise),
  });
  try {
    const first = h.submit();
    const second = h.submit();
    h.engine.tick();
    await flush();
    firstPrepare.resolve({ text: "prepared-a" });
    await flush();
    h.engine.tick();
    await flush();
    assert.equal(h.work.length, 1);
    const a = h.engine.getTask(first.taskId, caller);
    const b = h.engine.getTask(second.taskId, caller);
    assert.equal(a.execution?.startedAt, a.eligibleAt);
    assert.equal(b.execution?.executionId, a.execution?.executionId);
    const late = h.submit();
    assert.equal(late.receivedAt, a.execution?.startedAt);
    secondPrepare.resolve({ text: "prepared-b" });
    await flush();
    h.engine.tick();
    await flush();
    assert.notEqual(
      h.engine.getTask(late.taskId, caller).execution?.executionId,
      a.execution?.executionId,
    );
    assert.equal(h.engine.getTask(second.taskId, caller).stage, "running");
  } finally {
    firstPrepare.resolve({ text: "hello" });
    secondPrepare.resolve({ text: "hello" });
    await h.close();
  }
});

test("requested eligibility is preserved while effective anchors clamp once", async () => {
  const h = harness();
  try {
    const requested = at(h.clock.now() - 1000);
    const task = h.submit({ eligibleAt: requested, timeoutMs: 20 });
    const raw = h.engine.getRequest(task.requestId, caller);
    assert.equal(raw.eligibleAt, requested);
    assert.equal(task.eligibleAt, task.receivedAt);
    assert.equal(Date.parse(task.deadlineAt), Date.parse(task.receivedAt) + 20);
    h.clock.advance(100);
    const retried = h.engine.submit(raw, caller);
    assert.equal(retried.taskId, task.taskId);
    assert.equal(retried.eligibleAt, task.eligibleAt);
    assert.equal(retried.deadlineAt, task.deadlineAt);
    const future = h.submit({ eligibleAt: at(h.clock.now() + 100) });
    assert.equal(Date.parse(future.eligibleAt), h.clock.now() + 100);
    assert.throws(() => h.submit({ executionMatch: "completed-after-eligible" }), {
      code: "invalid_request",
    });
  } finally {
    await h.close();
  }
});

test("unbound terminated demand protects shared work; cancellation does not fake a binding", async () => {
  const h = harness();
  try {
    const first = h.submit({ timeoutMs: 5 });
    await h.turn();
    const demand = h.submit({ executionMatch: "terminated-after-eligible", timeoutMs: 100 });
    h.engine.cancelTask(first.taskId, caller);
    assert.equal(h.engine.getTask(demand.taskId, caller).execution, undefined);
    assert.equal(h.work[0]!.stops.length, 0);
    await h.finish();
    assert.equal(h.engine.getTask(demand.taskId, caller).stage, "completed");
    assert.ok(h.engine.getTask(first.taskId, caller).canceledAt);
  } finally {
    await h.close();
  }
});

for (const outcome of ["completed", "failed"] as const) {
  test(`timed-out unbound demand still accepts ${outcome} without scheduling work`, async () => {
    const h = harness();
    try {
      h.submit({ timeoutMs: 1000 });
      await h.turn();
      const task = h.submit({ executionMatch: "terminated-after-eligible", timeoutMs: 2 });
      await h.turn(3);
      assert.equal(h.work.length, 1);
      assert.equal(h.engine.getTask(task.taskId, caller).execution, undefined);
      assert.ok(isTimedOut(h.engine.getTask(task.taskId, caller)));
      if (outcome === "completed") h.work[0]!.permit.complete({ text: "late" });
      else h.work[0]!.permit.fail({ code: "late", message: "Late failure" });
      const result = h.engine.getTask(task.taskId, caller);
      assert.equal(result.stage, outcome === "completed" ? "completed" : "execution_failed");
      assert.ok(isTimedOut(result));
    } finally {
      await h.close();
    }
  });
}

test("authorization rejects async grants and rechecks before event matching", async () => {
  const h = harness();
  try {
    h.type.authorize = async () => {};
    assert.throws(() => h.submit(), { code: "invalid_type" });
    h.type.authorize = async () => {
      throw new Error("denied asynchronously");
    };
    assert.throws(() => h.submit(), { code: "invalid_type" });
    await flush();
    let denied = false;
    h.type.authorize = () => {
      if (denied) throw new Error("denied");
    };
    h.submit();
    await h.turn();
    const task = h.submit({ executionMatch: "terminated-after-eligible" });
    denied = true;
    await h.finish();
    assert.equal(h.engine.getTask(task.taskId, caller).execution, undefined);
    assert.ok(h.engine.errors.some((error) => error.message === "denied"));
  } finally {
    await h.close();
  }
});

test("expired start-policy demand may bind another task's start, but cannot schedule it", async () => {
  const h = harness();
  try {
    const expired = h.submit({ timeoutMs: 1 });
    await h.turn(2);
    assert.equal(h.work.length, 0);
    const driver = h.submit();
    await h.turn();
    assert.equal(h.work.length, 1);
    assert.equal(
      h.engine.getTask(expired.taskId, caller).execution?.executionId,
      h.engine.getTask(driver.taskId, caller).execution?.executionId,
    );
    await h.finish();
    assert.equal(h.engine.getTask(expired.taskId, caller).stage, "completed");
    assert.ok(isTimedOut(h.engine.getTask(expired.taskId, caller)));
  } finally {
    await h.close();
  }
});

test("last unbound terminated owner cancellation waits for physical release", async () => {
  const h = harness();
  try {
    const task = h.submit({ executionMatch: "terminated-after-eligible" });
    await h.turn();
    assert.equal(h.engine.getTask(task.taskId, caller).execution, undefined);
    assert.equal(h.work.length, 1);
    h.engine.cancelTask(task.taskId, caller);
    await h.engine.waitForTaskRelease(task.taskId, caller);
    assert.equal(h.work[0]!.stops.length, 1);
    assert.ok(h.engine.getTask(task.taskId, caller).canceledAt);
    assert.equal(h.engine.getTask(task.taskId, caller).execution, undefined);
    assert.ok(h.store.read().facts.executions[h.work[0]!.permit.executionId]!.reclaimedAt);
  } finally {
    await h.close();
  }
});

test("sealing preserves existing terminated demand but refuses post-seal arrivals", async () => {
  const h = harness({ resources: ["js"] });
  try {
    const task = h.submit({ executionMatch: "terminated-after-eligible", timeoutMs: 2 });
    await h.turn();
    await h.turn(3);
    assert.equal(h.work[0]!.stops.length, 0);
    let laterId = "";
    const execute = h.type.execute;
    h.type.execute = (input, options) =>
      execute(input, {
        ...options,
        authorizeReplacement(id, generation) {
          const authorized = options.authorizeReplacement(id, generation);
          if (authorized) {
            laterId = h.submit({ executionMatch: "terminated-after-eligible" }).taskId;
            h.work[0]!.permit.complete({ text: "late sealed result" });
          }
          return authorized;
        },
      });

    h.submit({ text: "replacement" });
    await h.turn();
    assert.ok(laterId);
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "completed");
    assert.ok(isTimedOut(h.engine.getTask(task.taskId, caller)));
    assert.equal(h.engine.getTask(laterId, caller).execution, undefined);
    const view = h.store.read();
    assert.deepEqual(view.facts.executions[h.work[0]!.permit.executionId]!.sealedTaskIds, [
      task.taskId,
    ]);
    assert.deepEqual(reduce(emptyFacts(), view.events), view.facts);
  } finally {
    await h.close();
  }
});

test("injected legacy facts and historical rebinding are rejected", async () => {
  const legacy = new MemoryStore();
  const read = legacy.read.bind(legacy);
  legacy.read = () =>
    ({
      ...read(),
      facts: { ...read().facts, projectionVersion: 1 },
    }) as never;
  assert.throws(
    () =>
      createTaskEngine({
        store: legacy,
        types: [],
        currentVersions: {},
        authorize: () => true,
      }),
    { code: "unsupported_version" },
  );
  legacy.close();

  const h = harness();
  try {
    h.submit();
    await h.turn();
    await h.finish();
    const later = h.submit({ executionMatch: "terminated-after-eligible" });
    const facts = h.store.read().facts;
    const execution = Object.values(facts.executions)[0]!;
    assert.throws(
      () =>
        reduce(facts, [
          {
            sequence: facts.watermark + 1,
            type: "task.allocation.bound",
            taskId: later.taskId,
            scope: caller.scope,
            occurredAt: execution.completedAt!,
            data: { executionId: execution.executionId },
          },
        ]),
      { code: "invalid_fact" },
    );
    const bad = structuredClone(facts);
    bad.tasks[later.taskId]!.request.executionMatch = "completed-after-eligible" as never;
    assert.throws(() => reduce(bad, []), { code: "unsupported_version" });
  } finally {
    await h.close();
  }
});

test("canceled unbound demand retains physical release references across recovery", async () => {
  const h = harness();
  const restoredStore = new MemoryStore();
  let restored: ReturnType<typeof createTaskEngine> | undefined;
  try {
    const task = h.submit({ executionMatch: "terminated-after-eligible" });
    await h.turn();
    h.engine.cancelTask(task.taskId, caller);
    const view = h.store.read();
    assert.deepEqual(view.facts.tasks[task.taskId]!.releaseExecutionIds, [
      h.work[0]!.permit.executionId,
    ]);
    restoredStore.claim("copy");
    restoredStore.append(
      "copy",
      0,
      view.events.map(({ sequence: _sequence, ...event }) => event),
    );
    restoredStore.release("copy");
    restored = createTaskEngine({
      store: restoredStore,
      types: [h.type],
      currentVersions: { echo: "1" },
      clock: h.clock,
      authorize: () => true,
    });
    restored.start();
    assert.equal(restored.getTask(task.taskId, caller).execution, undefined);
    await assert.rejects(restored.waitForTaskRelease(task.taskId, caller), {
      code: "reclamation_unconfirmed",
    });
  } finally {
    await restored?.close();
    restoredStore.close();
    await h.close();
  }
});
