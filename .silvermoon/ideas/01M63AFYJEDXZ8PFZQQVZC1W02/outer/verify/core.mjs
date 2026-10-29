import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { createExecutorPool } from "@potential-guide/task-engine/pool";
import { MemoryStore, VirtualClock } from "@potential-guide/task-engine/testing";
import { at, isPending, isTimedOut, json } from "@potential-guide/task-protocol";
import { bounded, caller, created, deferred, epoch, flush, harness } from "./support.mjs";

export async function verifyCore(record) {
  assert.equal(process.getActiveResourcesInfo().includes("TCPServerWrap"), false);
  let h = harness();
  try {
    const task = h.submit();
    const raw = h.engine.getRequest(task.requestId, caller);
    assert.equal("eligibleAt" in raw, false);
    assert.equal(h.engine.submit(raw, caller).taskId, task.taskId);
    assert.throws(() => h.engine.submit({ ...raw, timeoutMs: 101 }, caller), { code: "idempotency_conflict" });
    assert.throws(() => h.submit({ prerequisites: [] }), { code: "invalid_request" });
    assert.throws(() => h.submit({ type: "missing" }), { code: "unknown_type" });
    assert.throws(() => h.engine.getTask(task.taskId, { ...caller, scope: "b" }), { code: "forbidden" });
    const second = h.submit();
    await h.turn();
    assert.equal(h.works.length, 1);
    assert.equal(h.preparation.length, 2);
    const frozen = h.engine.cancelTask(task.taskId, caller);
    assert.equal(h.works[0].stops.length, 0);
    await h.complete("hello");
    h.clock.setTime(epoch + 200);
    assert.equal(isTimedOut(h.engine.getTask(second.taskId, caller)), false);
    assert.throws(() => h.engine.cancelTask(second.taskId, caller), { code: "task_finished" });
    assert.deepEqual(h.engine.getTask(second.taskId, caller).result, { text: "hello" });
    assert.equal(h.engine.getTask(task.taskId, caller).canceledAt, frozen.canceledAt);
    assert.equal(h.engine.getTask(task.taskId, caller).result, undefined);
    const sum = h.engine.submit({ requestId: newId(), type: "sum", values: [2, 3], timeoutMs: 100 }, caller);
    await h.turn(); h.engine.tick();
    assert.deepEqual(h.engine.getTask(sum.taskId, caller).result, { total: 5 });
    record("core:identity-types-sharing-cancel", { starts: h.works.length, sum: 5, noMandatoryCheck: true });
    for (const mode of ["skip", "fault"]) {
      const item = h.submit({ text: mode, mode });
      await h.turn(); h.engine.tick();
      const snapshot = h.engine.getTask(item.taskId, caller);
      assert.equal(snapshot.stage, mode === "skip" ? "completed" : "execution_failed");
      if (mode === "skip") assert.deepEqual(snapshot.result, { performed: false, reason: "fixture-unavailable" });
    }
    record("core:business-preflight", { skipped: "completed", thrown: "execution_failed" });
  } finally { await h.close(); }
  for (const offset of [0, 1]) {
    h = harness();
    try {
      const task = h.submit();
      await h.turn();
      h.clock.setTime(Date.parse(task.deadlineAt) + offset);
      await h.complete("hello");
      h.clock.setTime(Date.parse(task.deadlineAt) + 1000);
      assert.equal(isTimedOut(h.engine.getTask(task.taskId, caller)), offset > 0);
      h.engine.tick();
      assert.equal(h.engine.getTask(task.taskId, caller).stage, "completed");
      assert.equal(isTimedOut(h.engine.getTask(task.taskId, caller)), offset > 0);
      record(`core:deadline+${offset}`, { completed: true, timedOut: offset > 0 });
    } finally { await h.close(); }
  }
  let version = 0;
  h = harness({ prepare: async input => ({ ...input, resolvedVersion: ++version }) });
  try {
    h.submit(); h.submit(); await h.turn();
    assert.equal(h.works.length, 2);
    assert.notEqual(h.works[0].permit.executionId, h.works[1].permit.executionId);
    record("core:exact-prepared-version", { sameInput: true, executionCount: 2 });
  } finally { await h.close(); }
  h = harness({ resources: ["cpu"] });
  try {
    h.submit({ text: "busy", timeoutMs: 10 }); await h.turn();
    const queued = h.submit({ text: "queued", timeoutMs: 5 }); await h.turn();
    assert.equal(h.engine.getTask(queued.taskId, caller).stage, "queued");
    await h.turn(20);
    assert.equal(h.works[0].stops.length, 0);
    assert.equal(h.pool.stats.queued, 0);
    await h.complete("busy"); await h.turn();
    assert.equal(h.works.length, 1);
    assert.equal(h.engine.getTask(queued.taskId, caller).stage, "queued");
    record("core:queue-deadline", { starts: 1, retractedQueue: true, noTimeoutKill: true });
  } finally { await h.close(); }
  h = harness();
  try {
    const start = h.clock.now();
    const a = h.submit({ recurrence: { anchor: "eligible", periodMs: 10 }, timeoutMs: 1000 });
    await h.turn(25);
    let rounds = created(h.engine, a.seriesId);
    assert.equal(rounds.length, 2);
    assert.equal(rounds[1].eligibleAt, at(start + 30));
    await h.turn(5);
    rounds = created(h.engine, a.seriesId);
    assert.equal(rounds.length, 3);
    assert.equal(rounds.filter(item => isPending(h.engine.getTask(item.taskId, caller))).length, 1);
    assert.equal(rounds.filter(item => item.eligibleAt <= at(h.clock.now())).length, 2);
    for (const item of rounds) h.engine.cancelTask(item.taskId, caller);
    record("core:eligible-recurrence", { count: 3, pending: 1, eligibleActive: 2, nextOffsets: [30, 40] });
  } finally { await h.close(); }
  h = harness();
  try {
    const start = h.clock.now();
    const a = h.submit({ timeoutMs: 10, recurrence: { anchor: "terminated", periodMs: 20 } });
    await h.turn(); await h.turn(54);
    const rounds = created(h.engine, a.seriesId);
    assert.equal(rounds.length, 2);
    assert.equal(rounds[1].eligibleAt, at(start + 70));
    await h.turn(15); await h.complete("hello"); h.engine.tick();
    assert.equal(created(h.engine, a.seriesId).length, 2);
    const associations = h.engine.readHistory({ seriesId: a.seriesId }, {}, caller).events.filter(event => event.type === "task.successor");
    assert.equal(associations.length, 1);
    record("core:timeout-successor-dedup", { successorOffset: 70, associations: 1, lateFinishCreatesNone: true });
  } finally { await h.close(); }
  h = harness({ resources: ["cpu", "other"] });
  try {
    h.submit({ text: "candidate", timeoutMs: 5 }); await h.turn();
    h.submit({ text: "occupy-other", resource: "other", timeoutMs: 100 }); await h.turn(10);
    const target = h.submit({ text: "needs-other", resource: "other", timeoutMs: 100 }); await h.turn();
    assert.equal(h.engine.getTask(target.taskId, caller).stage, "queued");
    assert.equal(h.works[0].stops.length, 0);
    h.engine.cancelTask(target.taskId, caller);
    record("core:replacement-resource-compatibility", { incompatibleCandidateKilled: false });
  } finally { await h.close(); }
  h = harness({ resources: ["cpu"] });
  const release = deferred();
  try {
    h.submit({ timeoutMs: 5 }); await h.turn(); await h.turn(10);
    const execute = h.echo.execute;
    h.echo.execute = async (input, options) => {
      if (input.text === "replacement") await release.promise;
      return execute(input, options);
    };
    h.submit({ text: "replacement" }); await h.turn();
    const owner = h.submit({ executionMatch: "completed-after-eligible" }); await h.turn();
    assert.equal(h.engine.getTask(owner.taskId, caller).execution.executionId, h.works[0].permit.executionId);
    release.resolve(); await flush();
    assert.equal(h.works[0].stops.length, 0);
    assert.equal(h.pool.stats.queued, 1);
    record("core:protected-owner-recheck", { replacementDenied: true, ownerPreserved: true });
  } finally { release.resolve(); await h.close(); }
  await verifyNested(record);
  await verifyWorker(record);
  assert.equal(process.getActiveResourcesInfo().includes("TCPServerWrap"), false);
  record("core:no-http-listener", { beforeAndAfter: true });
}

async function verifyWorker(record) {
  const store = new MemoryStore(), clock = new VirtualClock(epoch), ready = deferred(), replacementStarted = deferred();
  let worker, exited = false, cleaned = false, forced = 0;
  const executionIds = [];
  const pool = createExecutorPool({
    resources: ["worker"], resourceKey: () => "worker", graceMs: 10, reclaimMs: 3000,
    run(input, permit) {
      executionIds.push(permit.executionId);
      assert.equal(engine.readHistory({ executionId: permit.executionId }, {}, caller).events[0].type, "execution.started");
      if (input.text === "replacement") {
        assert.ok(exited && cleaned, "替换启动前必须观察到旧 Worker 退出并清理");
        replacementStarted.resolve();
        return { result: Promise.resolve({ text: "replacement" }), exited: Promise.resolve(), cooperate() {}, async force() {}, async cleanup() {} };
      }
      worker = new Worker("const {parentPort}=require('node:worker_threads');parentPort.postMessage('ready');while(true){}", { eval: true });
      worker.once("message", () => ready.resolve());
      const result = deferred();
      worker.once("error", result.reject);
      const stopped = new Promise(resolve => worker.once("exit", () => { exited = true; result.reject(Error("物理退出")); resolve(); }));
      return {
        result: result.promise, exited: stopped, cooperate() {},
        async force() { forced++; await worker.terminate(); },
        async cleanup() { assert.ok(exited); assert.equal(worker.threadId, -1); cleaned = true; },
      };
    },
  });
  const type = {
    type: "loop", version: "1", environment: "worker", validate: json,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    prepare: async input => input, validatePrepared: json, validateResult: json, validateProgress: json,
    execute: (input, options) => pool.execute(input, options),
  };
  const engine = createTaskEngine({ store, clock, types: [type], currentVersions: { loop: "1" }, authorize: who => who.subject === caller.subject });
  engine.start();
  try {
    const old = engine.submit({ requestId: newId(), type: "loop", text: "runaway", timeoutMs: 5 }, caller);
    clock.advance(1); engine.tick(); await flush(); engine.tick(); await flush();
    await bounded(ready.promise, "Worker ready");
    clock.advance(10); engine.tick();
    assert.equal(forced, 0);
    const next = engine.submit({ requestId: newId(), type: "loop", text: "replacement", timeoutMs: 100 }, caller);
    clock.advance(1); engine.tick(); await flush(); engine.tick();
    await bounded(replacementStarted.promise, "替换 tracking");
    await flush(); engine.tick();
    assert.equal(forced, 1);
    assert.notEqual(executionIds[0], executionIds[1]);
    assert.equal(engine.getTask(next.taskId, caller).stage, "completed");
    assert.equal(engine.getTask(old.taskId, caller).stage, "execution_failed");
    record("core:isolated-forced-replacement", { forced, exited, cleaned, oldThreadId: worker.threadId, distinctExecutionIds: true });
  } finally { await worker?.terminate(); await engine.close(); await pool.close(); store.close(); }
}

async function verifyNested(record) {
  const clock = new VirtualClock(epoch), store = new MemoryStore();
  let childId;
  const pool = createExecutorPool({
    resources: ["parent", "child"], resourceKey: input => input.kind,
    run(input) {
      const stop = new AbortController();
      const result = (async () => {
        if (input.kind === "child") return { value: 6 };
        const child = engine.submit({ requestId: newId(), type: "child", value: 3, timeoutMs: 100 }, caller);
        childId = child.taskId;
        while (!stop.signal.aborted) {
          const snapshot = engine.getTask(child.taskId, caller);
          if (snapshot.stage === "completed") return { childTaskId: child.taskId, result: snapshot.result };
          await new Promise(resolve => setImmediate(resolve));
        }
        throw Error("父任务已停止");
      })();
      return { result, exited: result.then(() => {}, () => {}),
        cooperate() { stop.abort(); }, async force() { throw Error("仅合作式测试任务"); }, async cleanup() {} };
    },
  });
  const parent = {
    type: "parent", version: "1", environment: "js", validate: json,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    prepare: async input => ({ ...input, kind: "parent" }),
    validatePrepared: json, validateResult: json, validateProgress: json,
    execute: (input, options) => pool.execute(input, options),
  };
  const child = { ...parent, type: "child", prepare: async input => ({ ...input, kind: "child" }) };
  const engine = createTaskEngine({ store, clock, types: [parent, child], currentVersions: { parent: "1", child: "1" }, authorize: who => who.subject === caller.subject });
  engine.start();
  try {
    const task = engine.submit({ requestId: newId(), type: "parent", timeoutMs: 100 }, caller);
    for (let i = 0; i < 20; i++) {
      clock.advance(1); engine.tick(); await flush(); engine.tick();
      await new Promise(resolve => setImmediate(resolve));
      if (engine.getTask(task.taskId, caller).stage === "completed") break;
    }
    const result = engine.getTask(task.taskId, caller);
    assert.equal(result.stage, "completed");
    assert.deepEqual(result.result, { childTaskId: childId, result: { value: 6 } });
    assert.notEqual(result.execution.executionId, engine.getTask(childId, caller).execution.executionId);
    record("core:nested-resource-domains", { childValue: 6, separateExecutions: true, noSelfHttp: true });
  } finally { await engine.close(); await pool.close(); store.close(); }
}
