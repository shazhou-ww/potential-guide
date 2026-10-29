import assert from "node:assert/strict";
import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { createExecutorPool } from "@potential-guide/task-engine/pool";
import { MemoryStore, VirtualClock } from "@potential-guide/task-engine/testing";
import { canonical, fail, json, object, TaskError } from "@potential-guide/task-protocol";

export const caller = { subject: "deployment", scope: "a" };
export const epoch = 1_800_000_000_000;
export function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
export async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
export function bounded(promise, label, ms = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`等待超时: ${label}`)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
function validate(value, version = "1") {
  const input = object(value);
  const keys = Object.keys(input);
  if (keys.some(key => !["text", "mode", "resource"].includes(key)) ||
    typeof input.text !== "string" ||
    (input.mode !== undefined && !["skip", "fault"].includes(input.mode)) ||
    (input.resource !== undefined && !["cpu", "other"].includes(input.resource)) ||
    (version === "2" && !input.text.startsWith("v2:")))
    fail("invalid_request", "测试 echo 输入不合法。");
  return input;
}
export function harness(options = {}) {
  const clock = options.clock ?? new VirtualClock(options.now ?? epoch);
  const store = options.store ?? new MemoryStore();
  const works = [];
  const preparation = [];
  const pool = createExecutorPool({
    resources: options.resources ?? ["cpu", "cpu", "cpu", "other"],
    graceMs: 10, reclaimMs: 3000,
    resourceKey: input => input.resource ?? "cpu",
    run(input, permit, context) {
      assert.ok(Object.isFrozen(context));
      assert.equal(typeof permit.executionId, "string");
      const done = deferred(), exited = deferred();
      const work = { input, permit, done, exited, stops: [], cleaned: false };
      works.push(work);
      if (input.mode === "skip") { done.resolve({ performed: false, reason: "fixture-unavailable" }); exited.resolve(); }
      if (input.mode === "fault") { done.reject(Error("测试前置判断异常")); exited.resolve(); }
      if ("total" in input) { done.resolve({ total: input.total }); exited.resolve(); }
      return {
        result: done.promise, exited: exited.promise,
        cooperate(reason) { work.stops.push(reason); done.reject(Error(reason)); exited.resolve(); },
        async force() { throw Error("同线程测试工作不支持强杀"); },
        async cleanup() { work.cleaned = true; },
      };
    },
  });
  const makeType = version => ({
    type: "echo", version, environment: `fixture-${version}`,
    validate: value => validate(value, version),
    equals(input, other) {
      try { return canonical(input) === canonical(validate(other, version)); }
      catch (error) {
        if (error instanceof TaskError && ["invalid_request", "invalid_payload"].includes(error.code)) return false;
        throw error;
      }
    },
    async prepare(input, context) {
      preparation.push({ version, text: input.text, aborted: context.signal.aborted });
      return options.prepare ? options.prepare(input, context) : input;
    },
    validatePrepared: json, validateResult: json, validateProgress: json,
    execute: (input, context) => pool.execute(input, context),
  });
  const echo = makeType("1"), newer = makeType("2");
  const sum = {
    ...echo, type: "sum",
    validate(value) {
      const input = object(value);
      if (Object.keys(input).join(",") !== "values" || !Array.isArray(input.values) ||
        !input.values.every(item => typeof item === "number")) fail("invalid_request", "测试 sum 输入不合法。");
      return input;
    },
    equals: (a, b) => canonical(a) === canonical(json(b)),
    async prepare(input) {
      preparation.push({ version: "1", type: "sum" });
      return { ...input, total: input.values.reduce((a, b) => a + b, 0) };
    },
  };
  const types = options.omitOriginal ? [newer] : [echo, newer, sum];
  const engine = createTaskEngine({
    store, clock, types,
    currentVersions: { echo: options.currentVersion ?? "1", sum: "1" },
    authorize: who => who.subject === caller.subject,
    limits: { executionWallMs: 10000, ...options.limits },
  });
  engine.start();
  const submit = (extra = {}) => engine.submit({
    requestId: newId(), type: "echo", text: "hello", timeoutMs: 100, ...extra,
  }, caller);
  const turn = async (ms = 1) => {
    clock.advance(ms); engine.tick(); await flush(); engine.tick(); await flush();
  };
  const complete = async (text, result) => {
    const work = works.find(item => item.input.text === text && !item.cleaned);
    assert.ok(work, `运行中工作不存在: ${text}`);
    work.done.resolve(result ?? { text }); work.exited.resolve(); await flush();
  };
  const close = async () => { await engine.close(); await pool.close(); store.close(); };
  return { engine, clock, store, pool, works, preparation, echo, sum, submit, turn, complete, close };
}
export function created(engine, seriesId) {
  const page = engine.readHistory({ seriesId }, {}, caller);
  assert.equal(page.next, undefined, "测试历史必须在有界单页内");
  return page.events.filter(event => event.type === "task.created").map(event => event.data.task.snapshot);
}
