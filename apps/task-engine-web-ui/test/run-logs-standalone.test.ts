import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import { newId } from "@potential-guide/task-engine";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { TaskError } from "@potential-guide/task-protocol";
import { buildTaskBundle, packTaskBundle } from "@potential-guide/task-sdk/build";
import { consumeRunLogSse } from "../src/run-logs.js";

test("built standalone UI (without installed UI dependencies) proxies real SDK diagnostic sample history/SSE with token and endpoint isolation", async () => {
  const directory = resolve(".cache", `standalone-logs-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  let child: ChildProcess | undefined;
  let backend: Awaited<ReturnType<typeof startTaskServer>> | undefined;
  let exited: Promise<void> | undefined;
  try {
    const built = await buildTaskBundle({
      declaration: fileURLToPath(
        new URL("../../../packages/task-sdk/examples/check-diagnostics/task.yaml", import.meta.url),
      ),
      entry: fileURLToPath(
        new URL(
          "../../../packages/task-sdk/examples/check-diagnostics/callback.ts",
          import.meta.url,
        ),
      ),
      outDirectory: join(directory, "bundle"),
    });
    const packed = await packTaskBundle(built.directory, join(directory, "sample.tar.gz"));
    backend = await startTaskServer({
      port: 0,
      store: new MemoryStore(),
      bundleDirectory: join(directory, "cache"),
      logs: { pageSize: 1 },
      authorize: (caller, _operation, scope) => caller.scope === scope,
      resolveCaller: (request) => {
        if (request.headers.get("authorization") !== "Bearer standalone-fixture")
          throw new TaskError("unauthenticated", "Fixture bearer required.");
        return { scope: "sample", subject: "tester" };
      },
    });
    const caller = { scope: "sample", subject: "tester" };
    let decision = await backend.engine.submit(
      {
        requestId: newId(),
        bundle: { url: pathToFileURL(packed.archive).href, digest: built.digest },
        timeoutMs: 30_000,
        checks: [
          { name: "package identity", expected: "v2", actual: "v2" },
          { name: "readiness", expected: "ready", actual: "not-ready" },
        ],
      },
      caller,
    );
    if (decision.status === "preparing")
      decision = await backend.engine.getRequestStatus(
        decision.requestId,
        { waitMs: 10_000 },
        caller,
      );
    assert.equal(decision.status, "accepted");
    if (decision.status !== "accepted") throw Error("Sample not accepted.");
    const taskId = decision.taskId;
    let task = backend.engine.getTask(taskId, caller);
    const deadline = performance.now() + 15_000;
    while (!task.termination) {
      if (performance.now() > deadline) throw Error("Sample did not finish.");
      await new Promise((resolve) => setTimeout(resolve, 10));
      task = backend.engine.getTask(taskId, caller);
    }
    assert.deepEqual(task.result, { ok: false, problemCount: 1 });
    const runId = task.run!.runId;
    const ui = join(directory, "standalone");
    await mkdir(ui);
    await cp(resolve("dist"), join(ui, "dist"), { recursive: true });
    await writeFile(join(ui, "package.json"), JSON.stringify({ type: "module", private: true }));
    await writeFile(
      join(ui, "ui.json"),
      JSON.stringify({
        port: 0,
        favoritesFile: join(ui, "favorites.json"),
        endpoints: [
          {
            id: "sample",
            label: "Diagnostic sample",
            binding: "sample-v2",
            url: backend.url,
            bearerEnv: "STANDALONE_LOGS_TOKEN",
          },
        ],
      }),
    );
    let diagnostics = "";
    child = spawn(
      process.execPath,
      [
        process.allowedNodeEnvironmentFlags.has("--permission")
          ? "--permission"
          : "--experimental-permission",
        `--allow-fs-read=${ui}`,
        `--allow-fs-write=${ui}`,
        join(ui, "dist", "src", "main.js"),
        join(ui, "ui.json"),
      ],
      {
        cwd: ui,
        env: { ...process.env, STANDALONE_LOGS_TOKEN: "standalone-fixture", NODE_PATH: "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    exited = new Promise((resolve) => child!.once("exit", () => resolve()));
    child.stderr!.on("data", (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-8192);
    });
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error(`Standalone UI readiness timeout: ${diagnostics}`)),
        10_000,
      );
      let output = "";
      child!.once("error", reject);
      child!.once("exit", () => {
        clearTimeout(timer);
        reject(Error(`Standalone UI exited: ${diagnostics}`));
      });
      child!.stdout!.on("data", (chunk) => {
        output += chunk;
        const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
    });
    const bootstrap = (await fetch(`${url}/api/bootstrap`).then((response) => response.json())) as {
      csrf: string;
      endpoints: { binding: string }[];
    };
    assert.equal(
      JSON.stringify(bootstrap).includes("standalone-fixture"),
      false,
      "Bearer stays on the UI server.",
    );
    const headers = {
      Origin: url,
      "X-UI-Token": bootstrap.csrf,
      "X-Endpoint-Binding": bootstrap.endpoints[0]!.binding,
    };
    const path = `${url}/api/endpoints/sample/runs/${runId}/logs`;
    const history = await fetch(path, { headers });
    assert.equal(history.status, 200);
    const logs = (await history.json()) as { entries: { message: string }[] };
    assert.equal(logs.entries.length, 1);
    assert.match(logs.entries[0]!.message, /package identity|identity|通过/);
    let replayed = 0;
    await consumeRunLogSse(await fetch(`${path}/events?afterSequence=1`, { headers }), (page) => {
      replayed += page.entries.length;
    });
    assert.equal(replayed, 2);
    assert.equal(
      (await fetch(path, { headers: { ...headers, "X-UI-Token": "wrong" } })).status,
      403,
    );
    assert.equal(
      (await fetch(path, { headers: { ...headers, "X-Endpoint-Binding": "retired" } })).status,
      409,
    );
    assert.equal((await fetch(`${path}?scope=other`, { headers })).status, 404);
    const assets = await fetch(`${url}/app.js`);
    assert.equal(assets.status, 200);
    assert.ok((await assets.text()).includes("run-log-viewport"));
  } finally {
    if (child && child.exitCode === null) child.kill();
    await exited;
    await backend?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
