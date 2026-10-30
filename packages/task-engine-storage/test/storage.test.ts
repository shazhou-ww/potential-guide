import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { VirtualClock } from "@potential-guide/task-engine/testing";
import {
  at,
  emptyFacts,
  type Json,
  json,
  reduce,
  type TaskType,
} from "@potential-guide/task-protocol";
import { openSqliteStore } from "../src/index.js";

const caller = { scope: "a", subject: "tester" };
const childFile = fileURLToPath(new URL("./crash-child.mjs", import.meta.url));
async function directory() {
  const root = resolve(".cache");
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, "task-sqlite-"));
}
function type(): TaskType<Json> {
  return {
    type: "echo",
    version: "1",
    environment: "test",
    inputSchema: { type: "object" },
    prepare: async (input) => input,
    validatePrepared: json,
    validateResult: json,
    validateProgress: json,
    async execute() {
      throw new Error("Recovered started work must not rerun.");
    },
  };
}
async function crash(filename: string, mode: string, requestId: string) {
  const child = fork(childFile, [filename, mode, requestId], { silent: true });
  let stderr = "";
  child.stderr?.on("data", (data) => {
    stderr += data;
  });
  const code = await new Promise<number | null>((resolveCode, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Child stalled: ${stderr}`));
    }, 10_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolveCode(code);
    });
  });
  assert.equal(code, 17, stderr);
}

test("SQLite WAL/FK/FULL, atomic indexes, checkpoint and duplicate owners", async () => {
  const root = await directory();
  const filename = join(root, "tasks.sqlite");
  const store = openSqliteStore(filename);
  const clock = new VirtualClock();
  const engine = createTaskEngine({
    store,
    clock,
    types: [type()],
    currentVersions: { echo: "1" },
    authorize: () => true,
  });
  engine.start();
  try {
    const raw = {
      requestId: newId(),
      type: "echo",
      text: "future",
      timeoutMs: 100,
      eligibleAt: at(clock.now() + 100),
    };
    const task = engine.submit(raw, caller);
    assert.equal(engine.submit(raw, caller).taskId, task.taskId);
    const competitor = openSqliteStore(filename);
    assert.throws(() => competitor.claim("other"), { code: "store_owned" });
    competitor.close();
    const inspection = new DatabaseSync(filename);
    assert.equal(inspection.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
    assert.equal(inspection.prepare("SELECT count(*) AS n FROM requests").get()?.n, 1);
    assert.equal(inspection.prepare("SELECT count(*) AS n FROM checkpoint").get()?.n, 1);
    inspection.close();
    const view = store.read();
    assert.deepEqual(view.facts, reduce(emptyFacts(), view.events));
  } finally {
    await engine.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("real process crash releases exclusive owner lock without stale PID guessing", async () => {
  const root = await directory();
  const filename = join(root, "tasks.sqlite");
  const child = fork(childFile, [filename, "owner", newId()], { silent: true });
  try {
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error("Owner did not become ready")), 10_000);
      child.once("message", () => {
        clearTimeout(timer);
        resolveReady();
      });
      child.once("error", reject);
    });
    const second = openSqliteStore(filename);
    assert.throws(() => second.claim("second"), { code: "store_owned" });
    const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
    child.kill();
    await exited;
    second.claim("recovered");
    second.release("recovered");
    second.close();
  } finally {
    child.kill();
    await rm(root, { recursive: true, force: true });
  }
});

for (const mode of ["started", "completed", "future"]) {
  test(`real restart: ${mode} preserves exact identity and adopts reliable facts`, async () => {
    const root = await directory();
    const filename = join(root, "tasks.sqlite");
    const requestId = newId();
    await crash(filename, mode, requestId);
    const store = openSqliteStore(filename);
    const clock = new VirtualClock();
    const engine = createTaskEngine({
      store,
      clock,
      types: [type()],
      currentVersions: { echo: "1" },
      authorize: () => true,
    });
    try {
      const before = Object.values(store.read().facts.tasks)[0];
      assert.ok(before);
      engine.start();
      const snapshot = engine.getTask(before.snapshot.taskId, caller);
      assert.equal(snapshot.requestId, requestId);
      assert.equal(snapshot.deadlineAt, before.snapshot.deadlineAt);
      assert.equal(
        snapshot.stage,
        mode === "completed" ? "completed" : mode === "started" ? "execution_failed" : "initial",
      );
      if (mode === "completed") assert.deepEqual(snapshot.result, { text: "durable final" });
      if (mode === "started") assert.equal(snapshot.error?.code, "execution_interrupted");
      assert.equal(
        engine.submit(engine.getRequest(requestId, caller), caller).taskId,
        snapshot.taskId,
      );
      const watermark = store.read().facts.watermark;
      await engine.close();
      const again = createTaskEngine({
        store,
        clock,
        types: [type()],
        currentVersions: { echo: "1" },
        authorize: () => true,
      });
      again.start();
      assert.equal(
        store.read().facts.watermark,
        watermark,
        "repeat recovery creates no duplicate failure",
      );
      await again.close();
    } finally {
      await engine.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const moment of ["before", "after"]) {
  test(`crash ${moment} commit keeps request/event/index atomic`, async () => {
    const root = await directory();
    const filename = join(root, "tasks.sqlite");
    const requestId = newId();
    await crash(filename, `submit-${moment}`, requestId);
    const store = openSqliteStore(filename);
    const clock = new VirtualClock();
    const engine = createTaskEngine({
      store,
      clock,
      types: [type()],
      currentVersions: { echo: "1" },
      authorize: () => true,
    });
    try {
      assert.equal(Object.keys(store.read().facts.tasks).length, moment === "before" ? 0 : 1);
      engine.start();
      const raw = { requestId, type: "echo", text: "crash", timeoutMs: 1000 };
      const task = engine.submit(raw, caller);
      assert.equal(engine.submit(raw, caller).taskId, task.taskId);
      assert.equal(Object.keys(store.read().facts.tasks).length, 1);
    } finally {
      await engine.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  test(`crash ${moment} successor transaction never splits planning/admission`, async () => {
    const root = await directory();
    const filename = join(root, "tasks.sqlite");
    const requestId = newId();
    await crash(filename, `successor-${moment}`, requestId);
    const store = openSqliteStore(filename);
    const clock = new VirtualClock();
    const engine = createTaskEngine({
      store,
      clock,
      types: [type()],
      currentVersions: { echo: "1" },
      authorize: () => true,
    });
    try {
      const prior = Object.values(store.read().facts.tasks).find(
        (task) => task.request.requestId === requestId,
      );
      assert.ok(prior);
      const saved = prior.successor;
      assert.equal(Object.keys(store.read().facts.tasks).length, moment === "before" ? 1 : 2);
      engine.start();
      clock.advance(1);
      engine.tick();
      const restored = store.read().facts.tasks[prior.snapshot.taskId];
      assert.ok(restored?.successor);
      if (saved) assert.deepEqual(restored.successor, saved);
      assert.equal(Object.keys(store.read().facts.tasks).length, 2);
    } finally {
      await engine.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("transaction fault rejects acceptance without partial state or silent memory fallback", async () => {
  const root = await directory();
  let armed = true;
  const store = openSqliteStore(join(root, "tasks.sqlite"), {
    fault(point) {
      if (armed && point === "beforeCommit") throw new Error("injected transaction failure");
    },
  });
  const engine = createTaskEngine({
    store,
    types: [type()],
    currentVersions: { echo: "1" },
    authorize: () => true,
  });
  engine.start();
  try {
    const raw = { requestId: newId(), type: "echo", text: "fail", timeoutMs: 1000 };
    assert.throws(() => engine.submit(raw, caller), /injected/);
    assert.equal(store.read().facts.watermark, 0);
    armed = false;
    engine.submit(raw, caller);
    assert.equal(Object.keys(store.read().facts.tasks).length, 1);
    assert.throws(() => openSqliteStore(join(root, "absent", "tasks.sqlite")));
    assert.throws(() => openSqliteStore(":memory:"), { code: "storage_failure" });
  } finally {
    await engine.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
