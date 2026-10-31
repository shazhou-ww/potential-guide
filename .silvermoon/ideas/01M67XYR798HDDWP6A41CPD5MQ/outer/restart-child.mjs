import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { newId } from "@potential-guide/task-engine";
import { assembly, caller, root } from "./consumer-lib.mjs";
const a = await assembly(join(root, "history.sqlite"));
try {
  if (process.argv[2] === "seed") {
    const base = { timeoutMs: 10000, subject: { case: "real-process-restart" } };
    const check = a.engine.submit({ ...base, requestId: newId(), type: "check", checker: { kind: "checker", url: pathToFileURL(join(root, "artifacts", "floating-checker.tgz")).href } }, caller);
    const probe = a.engine.submit({ ...base, requestId: newId(), type: "probe", objective: { kind: "objective", url: pathToFileURL(join(root, "artifacts", "floating-objective.tgz")).href } }, caller);
    for (const task of [check, probe]) await a.engine.waitForTaskRelease(task.taskId, caller);
    const tasks = [check, probe].map((task) => a.engine.getTask(task.taskId, caller));
    assert.ok(tasks.every((task) => task.stage === "completed"));
    await writeFile(join(root, "restart-before.json"), JSON.stringify(tasks));
    process.send({ kind: "result", tasks, events: a.store.read().events, pid: process.pid });
  } else {
    const { readFile } = await import("node:fs/promises");
    const before = JSON.parse(await readFile(join(root, "restart-before.json"), "utf8"));
    const tasks = before.map((task) => a.engine.getTask(task.taskId, caller));
    assert.deepEqual(tasks.map((task) => task.result), before.map((task) => task.result));
    assert.equal(a.reads.length, 0);
    const history = a.engine.readHistory({ taskId: tasks[0].taskId }, {}, caller);
    assert.ok(history.events.length);
    process.send({ kind: "result", tasks, reads: a.reads, events: a.store.read().events, history, pid: process.pid });
  }
} finally { await a.close(); process.disconnect(); }
