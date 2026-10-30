import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { newId } from "@potential-guide/task-engine";
import type { TaskSnapshot } from "@potential-guide/task-protocol";

for (const transport of ["https", "file"])
  test(`real ${transport} SQLite/Node-worker restart preserves identity/deadline, original bytes and never reruns unknown execution`, async () => {
    const root = resolve(".cache", `check-restart-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const database = resolve(root, "tasks.sqlite");
    const marker = resolve(root, "runs.txt");
    const archive = resolve(root, "checker.tgz");
    const children: ChildProcess[] = [];
    const exits = new Map<ChildProcess, Promise<void>>();
    async function launch(mode: string) {
      const child = fork(
        fileURLToPath(new URL("./restart-child.mjs", import.meta.url)),
        [
          database,
          resolve(root, `workers-${mode}`),
          mode,
          ...(transport === "file" ? [archive] : []),
        ],
        { silent: true, execArgv: [] },
      );
      children.push(child);
      exits.set(child, new Promise((resolve) => child.once("exit", () => resolve())));
      let output = "";
      child.stderr!.on("data", (chunk) => {
        output += chunk;
      });
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Child readiness timeout: ${output}`)),
          10000,
        );
        child.once("message", (message) => {
          clearTimeout(timer);
          resolve((message as { url: string }).url);
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error(`Child exited: ${output}`));
        });
      });
      return { child, url };
    }
    const headers = { authorization: "Bearer test", "content-type": "application/json" };
    async function submit(url: string, name: string, spin: boolean) {
      const response = await fetch(`${url}/tasks`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": newId() },
        body: JSON.stringify({
          type: "check",
          checker: {
            kind: "checker",
            url:
              transport === "file"
                ? pathToFileURL(archive).href
                : "https://example.test/checker.tgz",
          },
          subject: { name, spin, marker },
          timeoutMs: 30000,
        }),
      });
      assert.equal(response.status, 202);
      return (await response.json()) as TaskSnapshot;
    }
    async function wait(url: string, id: string, stage: string) {
      for (let count = 0; count < 500; count++) {
        const response = await fetch(`${url}/tasks/${id}`, { headers });
        assert.equal(response.status, 200);
        const value = (await response.json()) as TaskSnapshot;
        if (value.stage === stage) return value;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Missing ${stage}`);
    }
    try {
      const first = await launch("initial");
      const running = await submit(first.url, "running", true);
      const bound = await wait(first.url, running.taskId, "running");
      const queued = await submit(first.url, "queued", false);
      await wait(first.url, queued.taskId, "queued");
      for (let attempt = 0; ; attempt++) {
        if ((await readFile(marker, "utf8").catch(() => "")).includes("running")) break;
        assert.ok(attempt < 500);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      first.child.kill("SIGKILL");
      await exits.get(first.child);
      if (transport === "file") await rm(archive);
      const restarted = await launch("restart");
      const interrupted = await wait(restarted.url, running.taskId, "execution_failed");
      assert.equal(interrupted.error?.code, "execution_interrupted");
      assert.equal(interrupted.requestId, running.requestId);
      assert.equal(interrupted.execution?.executionId, bound.execution?.executionId);
      assert.equal(interrupted.deadlineAt, running.deadlineAt);
      const restored = await wait(restarted.url, queued.taskId, "completed");
      assert.equal(restored.requestId, queued.requestId);
      assert.equal(restored.deadlineAt, queued.deadlineAt);
      assert.deepEqual((await readFile(marker, "utf8")).trim().split(/\r?\n/), [
        "running",
        "queued",
      ]);
      restarted.child.send("close");
      await exits.get(restarted.child);
    } finally {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exits.get(child);
      }
      await rm(root, { recursive: true, force: true });
    }
  });
