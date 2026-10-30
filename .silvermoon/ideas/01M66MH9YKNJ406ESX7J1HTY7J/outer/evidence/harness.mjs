import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import { at, isTimedOut, json } from "@potential-guide/task-protocol";

export const epoch = 1_800_000_000_000;
export const caller = { scope: "external-proof", subject: "external-owner" };
export const policies = ["started-after-eligible", "terminated-after-eligible"];

export function isolation() {
  assert.equal(process.env.NODE_PATH, undefined);
  assert.equal(process.env.NODE_OPTIONS, undefined);
  const prefix = realpathSync(resolve("node_modules")) + sep;
  return [
    "@potential-guide/task-protocol",
    "@potential-guide/task-engine",
    "@potential-guide/task-engine/testing",
    "@potential-guide/task-engine-storage",
  ].map((specifier) => {
    const url = import.meta.resolve(specifier);
    const realpath = realpathSync(fileURLToPath(url));
    assert.ok(realpath.startsWith(prefix), `${specifier} escaped the isolated installation`);
    return { specifier, url, realpath };
  });
}

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class Clock {
  constructor(time) {
    this.time = time;
    this.scheduled = new Set();
  }
  now() {
    return this.time;
  }
  set(time) {
    this.time = time;
  }
  schedule(callback, delayMs) {
    const entry = { callback, delayMs };
    this.scheduled.add(entry);
    return () => this.scheduled.delete(entry);
  }
}

export async function flush() {
  for (let turn = 0; turn < 40; turn++) await Promise.resolve();
}

export function harness(options = {}) {
  const clock = new Clock(options.time ?? epoch);
  const store = options.store ?? new MemoryStore();
  const work = [];
  const inputs = [];
  let preparations = 0;
  const type = {
    type: "external-echo",
    version: "1",
    environment: "external-fake-work-v1",
    validate(value) {
      const input = json(value);
      assert.deepEqual(Object.keys(input), ["key"]);
      assert.equal(typeof input.key, "string");
      return input;
    },
    equals(input, other) {
      return typeof other?.key === "string" && input.key.toLowerCase() === other.key.toLowerCase();
    },
    async prepare(input) {
      preparations++;
      if (options.prepare) return options.prepare(input, preparations);
      return { key: input.key, preparation: preparations };
    },
    validatePrepared: json,
    validateResult: json,
    validateProgress: json,
    async execute(prepared, allocation) {
      const permit = allocation.start();
      const exit = deferred();
      const record = { permit, prepared, reclaims: [], logicalEnd: false };
      work.push(record);
      record.finish = (outcome) => {
        if (outcome === "completed") permit.complete({ value: "external-success" });
        else permit.fail({ code: "external_failure", message: "Controlled external failure" });
        record.logicalEnd = true;
        exit.resolve();
      };
      return {
        executionId: permit.executionId,
        generation: permit.generation,
        startedAt: permit.startedAt,
        finished: exit.promise,
        async reclaim(reason) {
          record.reclaims.push(reason);
          if (!record.logicalEnd) {
            permit.fail({ code: reason, message: "Fake work cooperatively released" });
            record.logicalEnd = true;
          }
          exit.resolve();
        },
      };
    },
  };
  const engine = createTaskEngine({
    store,
    clock,
    types: [type],
    currentVersions: { [type.type]: type.version },
    authorize: (who, _operation, scope) => who.subject === caller.subject && who.scope === scope,
    limits: { executionWallMs: 60_000 },
  });
  engine.start();
  const read = (task) => engine.getTask(typeof task === "string" ? task : task.taskId, caller);
  const submit = (fields = {}) => {
    const raw = {
      requestId: newId(clock.now()),
      type: type.type,
      key: "shared",
      timeoutMs: 1000,
      ...fields,
    };
    const task = engine.submit(raw, caller);
    inputs.push(raw);
    return task;
  };
  async function drive() {
    engine.tick();
    await flush();
    engine.tick();
    await flush();
  }
  function history(task) {
    const events = [];
    let cursor;
    do {
      const page = engine.readHistory(
        { taskId: typeof task === "string" ? task : task.taskId },
        { limit: 100, ...(cursor ? { cursor } : {}) },
        caller,
      );
      events.push(...page.events);
      cursor = page.next;
    } while (cursor);
    return events;
  }
  function evidence(tasks) {
    const events = new Map();
    for (const task of tasks) for (const event of history(task)) events.set(event.sequence, event);
    return {
      inputs,
      snapshots: tasks.map((task) => {
        const snapshot = read(task);
        return { snapshot, timedOut: isTimedOut(snapshot) };
      }),
      events: [...events.values()]
        .sort((a, b) => a.sequence - b.sequence)
        .map((event) => ({
          sequence: event.sequence,
          type: event.type,
          occurredAt: event.occurredAt,
          ...(event.taskId ? { taskId: event.taskId } : {}),
          ...(event.executionId ? { executionId: event.executionId } : {}),
          ...(event.type === "task.allocation.bound"
            ? { boundExecutionId: event.data.executionId }
            : {}),
        })),
      fakeWork: work.map((record) => ({
        executionId: record.permit.executionId,
        startedAt: record.permit.startedAt,
        reclaims: [...record.reclaims],
      })),
    };
  }
  async function close() {
    await engine.close();
    store.close();
    assert.equal(clock.scheduled.size, 0, "Owned Clock registrations leaked");
  }
  return { engine, clock, work, submit, read, drive, history, evidence, close };
}

export function recorder() {
  const checks = [];
  function equal(label, actual, expected) {
    assert.deepEqual(actual, expected, label);
    checks.push({ label, expected, actual });
  }
  function truth(label, actual) {
    assert.ok(actual, label);
    checks.push({ label, expected: true, actual: Boolean(actual) });
  }
  function error(label, action, code) {
    let caught;
    try {
      action();
    } catch (failure) {
      caught = failure;
    }
    assert.ok(caught, `${label}: command did not reject`);
    assert.equal(caught.code, code, label);
    checks.push({ label, expected: code, actual: caught.code, message: caught.message });
  }
  return { checks, equal, truth, error };
}

export { at, isTimedOut, newId };
