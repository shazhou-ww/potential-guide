import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  HistoryPage,
  RunLogPage,
  RunSnapshot,
  SubmissionResult,
  TaskSnapshot,
} from "@potential-guide/task-protocol";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const rpc = process.env.PGUIDE_E2E_KUBO_RPC;
const gateway = process.env.PGUIDE_E2E_KUBO_GATEWAY;

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = performance.now() + 30_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(performance.now() < deadline, `Observation timed out: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("real pguide init/build -> Kubo CAR import -> CLI execution and SQLite recovery", {
  skip:
    !rpc || !gateway ? "Set PGUIDE_E2E_KUBO_RPC and PGUIDE_E2E_KUBO_GATEWAY explicitly." : false,
  timeout: 180_000,
}, async (t) => {
  assert.ok(rpc);
  assert.ok(gateway);
  const gatewayUrl = gateway;
  const { newId } = await import("@potential-guide/task-engine");
  await mkdir(join(root, ".cache"), { recursive: true });
  const directory = await mkdtemp(join(root, ".cache", "real-kubo-"));
  const stops: (() => Promise<void>)[] = [];
  t.after(async () => {
    try {
      for (const stop of stops.reverse()) await stop();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  const bin = join(directory, "bin");
  await mkdir(bin);
  const servicePidFile = join(directory, "service.pid");
  const launcher = join(directory, "engine-launcher.mjs");
  await writeFile(
    launcher,
    `import {writeFileSync} from "node:fs";
if (!process.argv.includes("--pguide-command-metadata"))
  writeFileSync(${JSON.stringify(servicePidFile)}, String(process.pid));
await import(${JSON.stringify(pathToFileURL(join(root, "apps", "pguide-task-engine", "dist", "main.js")).href)});
`,
  );
  for (const [command, entry] of [
    ["task-bundle", join(root, "packages", "pguide-task-bundle", "dist", "bin.js")],
    ["task-engine", launcher],
  ]) {
    const shim = join(bin, `pguide-${command}${process.platform === "win32" ? ".cmd" : ""}`);
    await writeFile(
      shim,
      process.platform === "win32"
        ? `@"${process.execPath}" "${entry}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${entry}" "$@"\n`,
    );
    await chmod(shim, 0o755);
  }
  const systemPaths =
    process.platform === "win32"
      ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")]
      : ["/usr/bin", "/bin"];
  const env = {
    ...process.env,
    PATH: [bin, dirname(process.execPath), ...systemPaths].join(delimiter),
    APPDATA: join(directory, "user"),
    XDG_CONFIG_HOME: join(directory, "user"),
  };
  const pguide = join(root, "packages", "pguide", "dist", "bin.js");
  async function command(args: string[]) {
    const child = spawn(process.execPath, [pguide, ...args], {
      cwd: directory,
      env,
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    try {
      const [code] = await once(child, "close");
      assert.equal(code, 0, `${args.join(" ")}\n${stdout}\n${stderr}`);
      return JSON.parse(stdout).result;
    } finally {
      clearTimeout(timer);
    }
  }

  const taskDirectory = join(directory, "task");
  await mkdir(taskDirectory);
  await writeFile(join(taskDirectory, "package.json"), '{"private":true,"type":"module"}\n');
  const initialized = await command(["task-bundle", "init", taskDirectory, "--format", "json"]);
  assert.equal(initialized.packageDirectory, taskDirectory);
  // Reuse installed workspace dependencies without publishing or changing the root manifest.
  for (const [scope, name] of [
    ["@potential-guide", "task-sdk"],
    ["@sinclair", "typebox"],
  ] as const) {
    await mkdir(join(taskDirectory, "node_modules", scope), { recursive: true });
    await symlink(
      await realpath(join(root, "packages", "pguide-task-bundle", "node_modules", scope, name)),
      join(taskDirectory, "node_modules", scope, name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  const artifact = join(directory, "result.json");
  await mkdir(join(taskDirectory, "assets"));
  await writeFile(join(taskDirectory, "assets", "suffix.txt"), " from Kubo");
  await writeFile(
    join(taskDirectory, "task.build.yaml"),
    `${await readFile(join(taskDirectory, "task.build.yaml"), "utf8")}include:\n  - from: assets/suffix.txt\n    to: resources/\n`,
  );
  await writeFile(
    join(taskDirectory, "src", "main.ts"),
    `import { writeFile } from "node:fs/promises";
import { runTask } from "@potential-guide/task-sdk";
import type { Static } from "@sinclair/typebox";
import type contract from "./contract.js";
runTask(async (input: Static<typeof contract.input>, context) => {
  const suffix = await new Response(await context.bundle.read("resources/suffix.txt")).text();
  await context.log({level: "info", message: "resource-read", fields: {suffix}});
  await context.progress({stage: "execution", message: "Writing verified artifact"});
  const result = {text: input.text + suffix};
  await writeFile(${JSON.stringify(artifact)}, JSON.stringify({runId: context.runId, result}));
  return result;
});
`,
  );
  const built = await command([
    "task-bundle",
    "build",
    join(taskDirectory, "task.build.yaml"),
    "--format",
    "json",
  ]);
  const checked = await command([
    "task-bundle",
    "check",
    "artifact",
    built.car,
    "--format",
    "json",
  ]);
  assert.equal(checked.cid, built.cid);
  const rpcUrl = new URL(rpc);
  const importUrl = new URL(`${rpcUrl.pathname.replace(/\/$/, "")}/api/v0/dag/import`, rpcUrl);
  importUrl.searchParams.set("pin-roots", "true");
  const form = new FormData();
  form.append("file", new Blob([await readFile(built.car)]), "bundle.car");
  const imported = await fetch(importUrl, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const importText = await imported.text();
  assert.equal(imported.status, 200, importText);
  assert.ok(
    importText
      .trim()
      .split("\n")
      .some((line) => JSON.parse(line).Root?.Cid?.["/"] === built.cid),
    importText,
  );
  const raw = await fetch(`${gateway.replace(/\/$/, "")}/ipfs/${built.cid}?format=raw`, {
    headers: { accept: "application/vnd.ipld.raw" },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(raw.status, 200);
  assert.match(raw.headers.get("content-type") ?? "", /application\/vnd.ipld.raw/);
  await raw.arrayBuffer();

  async function start() {
    await rm(servicePidFile, { force: true });
    const child = spawn(
      process.execPath,
      [
        pguide,
        "task-engine",
        "--no-global-config",
        "--port",
        "0",
        "--database",
        join(directory, "tasks.sqlite"),
        "--ipfs-gateway-url",
        gatewayUrl,
      ],
      { cwd: directory, env, windowsHide: true },
    );
    let text = "";
    let errors = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const exited = once(child, "close");
    let pid: number | undefined;
    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      if (pid === undefined) {
        try {
          pid = Number(await readFile(servicePidFile, "utf8"));
          assert.ok(Number.isSafeInteger(pid) && pid > 0, "Invalid owned service PID.");
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      // On Windows SIGTERM is forced; wait for reclaimed Runs before normal shutdown.
      if (pid !== undefined && child.exitCode === null && child.signalCode === null)
        process.kill(pid, "SIGTERM");
      else if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Owned CLI did not exit.")), 10_000).unref();
        }),
      ]);
      stopped = true;
    };
    stops.push(stop);
    const ready = await until(
      async () => {
        assert.equal(child.exitCode, null, `${text}\n${errors}`);
        const line = text.split("\n").find((value) => value.startsWith('{"event":"ready"'));
        return line ? (JSON.parse(line) as { url: string; pid: number }) : undefined;
      },
      (value) => value !== undefined,
    ).catch((error: unknown) => {
      throw new Error(`CLI readiness failed.\nstdout: ${text}\nstderr: ${errors}`, {
        cause: error,
      });
    });
    assert.ok(ready);
    pid = ready.pid;
    assert.equal((await fetch(`${ready.url}/tasks`)).status, 200);
    t.diagnostic(`Engine ready: ${JSON.stringify(ready)}`);
    return { ...ready, stop };
  }
  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const value = await response.json();
    assert.ok(response.ok, `${response.status}: ${JSON.stringify(value)}`);
    return value as T;
  }
  const first = await start();
  const requestId = newId();
  const body = { bundle: built.cid, timeoutMs: 30_000, text: "Hello" };
  const submit = (url: string) =>
    json<SubmissionResult>(`${url}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": requestId },
      body: JSON.stringify(body),
    });
  const initial = await submit(first.url);
  assert.ok(initial.status === "preparing" || initial.status === "accepted");
  const accepted = await json<SubmissionResult>(
    `${first.url}/requests/${requestId}/status?waitMs=10000`,
  );
  assert.equal(accepted.status, "accepted", JSON.stringify(accepted));
  if (accepted.status !== "accepted") throw new Error("Bundle admission did not accept.");
  const task = await until(
    () => json<TaskSnapshot>(`${first.url}/tasks/${accepted.taskId}`),
    (value) => value.stage === "completed",
  );
  assert.deepEqual(task.result, { text: "Hello from Kubo" });
  const taskHistory = await json<HistoryPage>(`${first.url}/tasks/${task.taskId}/history`);
  assert.ok(taskHistory.events.some((event) => event.type === "task.created"));
  assert.ok(task.run);
  const runId = task.run.runId;
  const run = await until(
    () => json<RunSnapshot>(`${first.url}/runs/${runId}`),
    (value) => !!value.reclaimedAt,
  );
  assert.equal(run.stage, "completed");
  assert.deepEqual(run.result, task.result);
  assert.deepEqual(JSON.parse(await readFile(artifact, "utf8")), {
    runId: run.runId,
    result: task.result,
  });
  const history = await json<HistoryPage>(`${first.url}/runs/${run.runId}/history`);
  const kinds = history.events.map((event) => event.type);
  for (const kind of [
    "run.started",
    "run.dispatched",
    "run.progress",
    "run.outcome",
    "run.exited",
    "run.reclaimed",
  ])
    assert.ok(kinds.includes(kind), `${kind}: ${JSON.stringify(kinds)}`);
  assert.partialDeepStrictEqual(
    history.events.find((event) => event.type === "run.outcome")?.data,
    {
      outcome: { kind: "completed", result: task.result },
    },
  );
  const logs = await json<RunLogPage>(`${first.url}/runs/${run.runId}/logs`);
  assert.ok(logs.entries.some((entry) => entry.message === "resource-read"));
  await first.stop();
  await assert.rejects(fetch(`${first.url}/tasks`));
  const restarted = await start();
  assert.deepEqual(await submit(restarted.url), accepted);
  const recovered = await json<TaskSnapshot>(`${restarted.url}/tasks/${task.taskId}`);
  assert.equal(recovered.stage, "completed");
  assert.deepEqual(recovered.result, task.result);
  assert.equal(recovered.run?.runId, run.runId);
  const recoveredHistory = await json<HistoryPage>(`${restarted.url}/runs/${run.runId}/history`);
  assert.deepEqual(recoveredHistory.events, history.events);
  const recoveredLogs = await json<RunLogPage>(`${restarted.url}/runs/${run.runId}/logs`);
  assert.deepEqual(recoveredLogs.entries, logs.entries);
  const report = {
    cid: built.cid,
    requestId,
    taskId: task.taskId,
    runId: run.runId,
    stage: recovered.stage,
    result: recovered.result,
    events: kinds,
    logs: logs.entries,
    artifact: JSON.parse(await readFile(artifact, "utf8")),
    engine: { url: first.url, pid: first.pid },
    restarted: { url: restarted.url, pid: restarted.pid },
    rpc,
    gateway,
  };
  await restarted.stop();
  await assert.rejects(fetch(`${restarted.url}/tasks`));
  const retained = await fetch(`${gateway.replace(/\/$/, "")}/ipfs/${built.cid}?format=raw`);
  assert.equal(retained.status, 200);
  await retained.arrayBuffer();
  const verified = { ...report, ownedServicesStopped: true, sharedGatewayAvailable: true };
  t.diagnostic(JSON.stringify(verified));
  if (process.env.PGUIDE_E2E_REPORT)
    await writeFile(process.env.PGUIDE_E2E_REPORT, `${JSON.stringify(verified, null, 2)}\n`);
});
