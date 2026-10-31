import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { newId } from "@potential-guide/task-engine";
import type { TaskSnapshot } from "@potential-guide/task-protocol";

test("real process restart interrupts started Probe and children without observing again; SQLite result/history survive", async () => {
  const root = resolve(".cache", `probe-restart-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const children: ChildProcess[] = [];
  const exits = new Map<ChildProcess, Promise<void>>();
  const marker = resolve(root, "runs.txt");
  async function launch(mode: string) {
    const child = fork(
      fileURLToPath(new URL("./restart-child.mjs", import.meta.url)),
      [resolve(root, "tasks.sqlite"), resolve(root, mode)],
      { silent: true, execArgv: [] },
    );
    children.push(child);
    exits.set(child, new Promise((resolve) => child.once("exit", () => resolve())));
    let output = "";
    child.stderr!.on("data", (chunk) => {
      output += chunk;
    });
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(output || "Child startup timeout.")), 60000);
      child.once("message", (value) => {
        clearTimeout(timer);
        resolve((value as { url: string }).url);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(output));
      });
    });
    return { child, url };
  }
  async function submit(url: string, name: string, spin: boolean) {
    const response = await fetch(`${url}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": newId() },
      body: JSON.stringify({
        type: "probe",
        objective: { kind: "objective", url: "https://example.test/root" },
        subject: { name, spin, marker },
        timeoutMs: 30000,
      }),
    });
    assert.equal(response.status, 202);
    return (await response.json()) as TaskSnapshot;
  }
  async function read(url: string, id: string) {
    const response = await fetch(`${url}/tasks/${id}`);
    assert.equal(response.status, 200);
    return (await response.json()) as TaskSnapshot;
  }
  async function wait(url: string, id: string, stage: string) {
    for (let count = 0; count < 1000; count++) {
      const snapshot = await read(url, id);
      if (snapshot.stage === stage) return snapshot;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Missing ${stage}`);
  }
  try {
    const first = await launch("first");
    const completed = await submit(first.url, "completed", false);
    const done = await wait(first.url, completed.taskId, "completed");
    const running = await submit(first.url, "running", true);
    const bound = await wait(first.url, running.taskId, "running");
    for (let attempt = 0; ; attempt++) {
      if ((await readFile(marker, "utf8").catch(() => "")).includes("running")) break;
      assert.ok(attempt < 1000);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    first.child.kill("SIGKILL");
    await exits.get(first.child);
    const second = await launch("second");
    const interrupted = await wait(second.url, running.taskId, "run_failed");
    assert.equal(interrupted.error?.code, "execution_interrupted");
    assert.equal(interrupted.run?.runId, bound.run?.runId);
    assert.equal(interrupted.deadlineAt, running.deadlineAt);
    const restored = await read(second.url, completed.taskId);
    assert.deepEqual(restored.result, done.result);
    assert.equal(restored.run?.runId, done.run?.runId);
    assert.deepEqual((await readFile(marker, "utf8")).trim().split(/\r?\n/), [
      "completed",
      "running",
    ]);
    second.child.send("close");
    await exits.get(second.child);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exits.get(child);
    }
    await rm(root, { recursive: true, force: true });
  }
});
