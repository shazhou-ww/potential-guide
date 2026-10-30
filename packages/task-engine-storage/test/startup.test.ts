import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { VirtualClock } from "@potential-guide/task-engine/testing";
import { type Json, json, type TaskType } from "@potential-guide/task-protocol";
import { openSqliteStore } from "../src/index.js";

for (const boundary of ["before", "after"]) {
  test(`crash ${boundary} startup commit distinguishes resumable queued from uncertain execution`, async () => {
    await mkdir(resolve(".cache"), { recursive: true });
    const root = await mkdtemp(join(resolve(".cache"), "task-startup-"));
    const filename = join(root, "tasks.sqlite");
    const child = fork(
      fileURLToPath(new URL("./crash-child.mjs", import.meta.url)),
      [filename, `startup-${boundary}`, newId()],
      { silent: true },
    );
    const exit = await new Promise<number | null>((resolveExit, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("startup fixture stalled"));
      }, 10000);
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolveExit(code);
      });
      child.once("error", reject);
    });
    assert.equal(exit, 17);
    const store = openSqliteStore(filename);
    const before = Object.values(store.read().facts.tasks)[0];
    assert.ok(before);
    assert.equal(before.snapshot.stage, boundary === "before" ? "queued" : "running");
    let starts = 0;
    const type: TaskType<Json> = {
      type: "echo",
      version: "1",
      environment: "test",
      inputSchema: { type: "object" },
      prepare: async (input) => input,
      validatePrepared: json,
      validateResult: json,
      validateProgress: json,
      async execute(input, options) {
        starts++;
        const permit = options.start();
        permit.complete(input);
        return { ...permit, finished: Promise.resolve(), async reclaim() {} };
      },
    };
    const clock = new VirtualClock();
    clock.advance(10);
    const engine = createTaskEngine({
      store,
      clock,
      types: [type],
      currentVersions: { echo: "1" },
      authorize: () => true,
    });
    try {
      engine.start();
      engine.tick();
      for (let index = 0; index < 30; index++) await Promise.resolve();
      engine.tick();
      const task = engine.getTask(before.snapshot.taskId, { scope: "a", subject: "tester" });
      assert.equal(task.requestId, before.request.requestId);
      assert.equal(task.deadlineAt, before.snapshot.deadlineAt);
      assert.equal(starts, boundary === "before" ? 1 : 0);
      assert.equal(task.stage, boundary === "before" ? "completed" : "execution_failed");
      if (boundary === "after") assert.equal(task.error?.code, "execution_interrupted");
    } finally {
      await engine.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
