import assert from "node:assert/strict";
import test from "node:test";
import { at, json, type Json, type Store, type TaskType } from "@potential-guide/task-protocol";
import { createTaskEngine, newId } from "../src/index.js";
import { MemoryStore, VirtualClock } from "../src/testing.js";
import { caller, harness } from "./fixtures.js";

const type = (version: string): TaskType<Json> => ({
  type: "example",
  version,
  environment: "private-runtime-secret",
  inputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
  prepare: async (value) => value,
  validatePrepared: json,
  validateResult: json,
  validateProgress: json,
  async execute() {
    throw new Error("future task must not execute");
  },
});

test("discovery is immutable, current-only, submit-authorized and detached from author config", async () => {
  const store = new MemoryStore();
  const clock = new VirtualClock();
  const currentVersions = { example: "2" };
  const current = type("2");
  const engine = createTaskEngine({
    store,
    clock,
    types: [type("1"), current],
    currentVersions,
    authorize: (who, operation) => who.subject === "tester" && operation === "submit",
  });
  engine.start();
  try {
    const found = engine.discoverTypes(caller);
    assert.equal(found.length, 1);
    assert.deepEqual(Object.keys(found[0]!).sort(), ["inputSchema", "revision", "type", "version"]);
    assert.equal(found[0]?.version, "2");
    assert.ok(!JSON.stringify(found).includes("private-runtime-secret"));
    assert.ok(Object.isFrozen(found));
    assert.ok(Object.isFrozen(found[0]?.inputSchema));
    assert.throws(() => engine.discoverTypes({ ...caller, subject: "denied" }), {
      code: "forbidden",
    });
    assert.throws(() => engine.discoverTypes({ scope: "", subject: "" }), {
      code: "unauthenticated",
    });
    currentVersions.example = "1";
    current.inputSchema.properties = {};
    assert.equal(engine.discoverTypes(caller)[0]?.version, "2");
    const request = {
      requestId: newId(),
      type: "example",
      value: 1,
      timeoutMs: 100,
      eligibleAt: at(clock.now() + 1000),
    };
    const revision = found[0]!.revision;
    assert.throws(() => engine.submit(request, caller, { expectedRevision: "stale" }), {
      code: "contract_revision_mismatch",
    });
    assert.equal(store.read().facts.watermark, 0);
    const created = engine.submit(request, caller, { expectedRevision: revision });
    assert.equal(engine.submit(request, caller).taskId, created.taskId);
    assert.equal(
      engine.submit(request, caller, { expectedRevision: revision }).taskId,
      created.taskId,
    );
    assert.throws(
      () => engine.submit({ ...request, value: 2 }, caller, { expectedRevision: revision }),
      { code: "idempotency_conflict" },
    );
    assert.equal(store.read().facts.tasks[created.taskId]?.binding.contractRevision, revision);
    assert.deepEqual(store.read().facts.tasks[created.taskId]?.request, request);
  } finally {
    await engine.close();
    store.close();
  }
});

test("revision races fail before persistence; history never silently changes Schema identity", async () => {
  const store = new MemoryStore();
  const clock = new VirtualClock();
  const original = type("1");
  const options = { store, clock, authorize: () => true };
  const first = createTaskEngine({
    ...options,
    types: [original],
    currentVersions: { example: "1" },
  });
  first.start();
  const oldRevision = first.discoverTypes(caller)[0]!.revision;
  const raw = {
    requestId: newId(),
    type: "example",
    value: 1,
    timeoutMs: 100,
    eligibleAt: at(clock.now() + 1000),
  };
  const task = first.submit(raw, caller);
  await first.close();
  const newer = type("2");
  const second = createTaskEngine({
    ...options,
    types: [original, newer],
    currentVersions: { example: "2" },
  });
  second.start();
  assert.throws(
    () => second.submit({ ...raw, requestId: newId() }, caller, { expectedRevision: oldRevision }),
    { code: "contract_revision_mismatch" },
  );
  assert.equal(second.submit(raw, caller).taskId, task.taskId);
  assert.deepEqual(
    second.discoverTypes(caller).map((entry) => entry.version),
    ["2"],
  );
  await second.close();
  const mutated = type("1");
  mutated.inputSchema = { type: "object" };
  const replaced = createTaskEngine({
    ...options,
    types: [mutated],
    currentVersions: { example: "1" },
  });
  assert.throws(() => replaced.start(), { code: "unsupported_contract" });
  const missing = createTaskEngine({
    ...options,
    types: [newer],
    currentVersions: { example: "2" },
  });
  assert.throws(() => missing.start(), { code: "unsupported_version" });
  const legacy: Store = {
    claim: (owner) => store.claim(owner),
    release: (owner) => store.release(owner),
    append: (...args) => store.append(...args),
    compact: (...args) => store.compact(...args),
    close: () => store.close(),
    read() {
      const view = store.read();
      for (const record of Object.values(view.facts.tasks))
        Reflect.deleteProperty(record.binding, "contractRevision");
      return view;
    },
  };
  const historical = createTaskEngine({
    ...options,
    store: legacy,
    types: [original],
    currentVersions: { example: "1" },
  });
  assert.throws(() => historical.start(), { code: "unsupported_contract" });
  store.close();
});

test("execution records independently require the original contract identity", async () => {
  const h = harness();
  try {
    h.submit();
    await h.turn();
    await h.finish();
    h.engine.tick();
    await h.engine.close();
    for (const revision of [undefined, "different"]) {
      const store: Store = {
        claim: (owner) => h.store.claim(owner),
        release: (owner) => h.store.release(owner),
        append: (...args) => h.store.append(...args),
        compact: (...args) => h.store.compact(...args),
        close: () => h.store.close(),
        read() {
          const view = h.store.read();
          for (const execution of Object.values(view.facts.executions)) {
            if (revision === undefined)
              Reflect.deleteProperty(execution.binding, "contractRevision");
            else execution.binding.contractRevision = revision;
          }
          return view;
        },
      };
      const restored = createTaskEngine({
        store,
        clock: h.clock,
        types: [h.type],
        currentVersions: { echo: "1" },
        authorize: () => true,
      });
      assert.throws(() => restored.start(), { code: "unsupported_contract" });
    }
  } finally {
    await h.close();
  }
});
