import assert from "node:assert/strict";
import childProcess, { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { type TestContext, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { killProcessTree } from "@potential-guide/cli-core";

function windowsCommands(
  t: TestContext,
  execute: (
    command: string,
    args: string[],
    options?: { windowsHide?: boolean; timeout?: number },
  ) => Promise<{ stdout: string; stderr: string }>,
) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const systemRoot = process.env.SystemRoot;
  const original = childProcess.execFile;
  t.after(() => {
    t.mock.restoreAll();
    childProcess.execFile = original;
    syncBuiltinESMExports();
    if (platform !== undefined) Object.defineProperty(process, "platform", platform);
    if (systemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = systemRoot;
  });
  Object.defineProperty(process, "platform", { value: "win32" });
  process.env.SystemRoot = "C:\\Windows";
  const replacement = (() => {
    throw new Error("Use the promisified fixture command.");
  }) as unknown as typeof childProcess.execFile;
  Object.defineProperty(replacement, promisify.custom, { value: execute });
  childProcess.execFile = replacement;
  syncBuiltinESMExports();
}

const tree = [
  { ProcessId: 93003, ParentProcessId: 93002 },
  { ProcessId: 93001, ParentProcessId: 1 },
  { ProcessId: 93002, ParentProcessId: 93001 },
  { ProcessId: 94000, ParentProcessId: 1 },
];
const absent = () => Object.assign(new Error("gone"), { code: "ESRCH" });
const ownedChild = () => ({ pid: 93001, exitCode: null, signalCode: null }) as ChildProcess;

test("Windows nonzero taskkill succeeds only after every snapshotted owned PID disappears", async (t) => {
  const failure = Object.assign(new Error("終了競合"), { code: 128 });
  const child = ownedChild();
  const observed: number[] = [];
  windowsCommands(t, async (command, args) => {
    if (command.endsWith("powershell.exe")) return { stdout: JSON.stringify(tree), stderr: "" };
    assert.equal(command, "taskkill");
    assert.deepEqual(args, ["/PID", "93001", "/T", "/F"]);
    Object.assign(child, { exitCode: 0 });
    throw failure;
  });
  t.mock.method(process, "kill", (pid: number, signal?: string | number) => {
    assert.equal(signal, 0);
    observed.push(pid);
    throw absent();
  });
  await killProcessTree(child);
  assert.deepEqual(new Set(observed), new Set([93001, 93002, 93003]));
});

test("Windows root exit during the snapshot is verified without killing its PID again", async (t) => {
  const child = ownedChild();
  windowsCommands(t, async (command) => {
    assert.ok(command.endsWith("powershell.exe"), "an exited root must not be targeted again");
    Object.assign(child, { exitCode: 0 });
    return { stdout: JSON.stringify(tree), stderr: "" };
  });
  const observed: number[] = [];
  t.mock.method(process, "kill", (pid: number, signal?: string | number) => {
    assert.equal(signal, 0);
    observed.push(pid);
    throw absent();
  });
  await killProcessTree(child);
  assert.deepEqual(new Set(observed), new Set([93001, 93002, 93003]));
});

test("Windows root exit cannot hide a live owned descendant after nonzero taskkill", async (t) => {
  const failure = Object.assign(new Error("終了失敗"), { code: 128 });
  const child = ownedChild();
  windowsCommands(t, async (command) => {
    if (command.endsWith("powershell.exe")) return { stdout: JSON.stringify(tree), stderr: "" };
    Object.assign(child, { exitCode: 0 });
    throw failure;
  });
  t.mock.method(process, "kill", (pid: number, signal?: string | number) => {
    assert.equal(signal, 0);
    assert.ok([93001, 93002, 93003].includes(pid));
    if (pid === 93003) return true;
    throw absent();
  });
  await assert.rejects(killProcessTree(child), (error) => error === failure);
});

test("Windows cleanup never treats an unobservable PID as proven dead", async (t) => {
  const failure = Object.assign(new Error("終了失敗"), { code: 128 });
  const denied = Object.assign(new Error("not observable"), { code: "EPERM" });
  windowsCommands(t, async (command) => {
    if (command.endsWith("powershell.exe")) return { stdout: JSON.stringify(tree), stderr: "" };
    throw failure;
  });
  t.mock.method(process, "kill", () => {
    throw denied;
  });
  await assert.rejects(
    killProcessTree(ownedChild()),
    (error) =>
      error instanceof AggregateError && error.errors[0] === failure && error.errors[1] === denied,
  );
});

test("Windows snapshot failure still attempts termination and fails explicitly", async (t) => {
  let terminated = false;
  windowsCommands(t, async (command) => {
    if (command.endsWith("powershell.exe")) return { stdout: "not JSON", stderr: "" };
    assert.equal(command, "taskkill");
    terminated = true;
    return { stdout: "", stderr: "" };
  });
  await assert.rejects(killProcessTree(ownedChild()), SyntaxError);
  assert.equal(terminated, true);
});

test("Windows snapshot command failures retain only bounded diagnostic fields", async (t) => {
  const canary = "fixture-canary-must-not-be-exposed";
  const cases = [
    [
      { code: null, killed: true, signal: "SIGTERM" },
      "kind=timeout;exit=none;errno=none;signal=SIGTERM;killed=true",
    ],
    [{ code: 23 }, "kind=exit;exit=23;errno=none"],
    [{ code: -1073741515 }, "kind=exit;exit=-1073741515;errno=none"],
    [{ code: "ENOENT" }, "kind=spawn;exit=none;errno=ENOENT"],
    [{ code: "EACCES" }, "kind=spawn;exit=none;errno=EACCES"],
    [
      { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true },
      "kind=output-limit;exit=none;errno=ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    ],
    [
      { code: 1, stderr: `PGUIDE_WINDOWS_SNAPSHOT_ERROR:module-autoload\n${canary}` },
      "reason=module-autoload]",
    ],
    [{ code: 1, stderr: `PGUIDE_WINDOWS_SNAPSHOT_ERROR:${canary}\n` }, "reason=unclassified]"],
    [
      { code: 1, stderr: `PGUIDE_WINDOWS_SNAPSHOT_ERROR:module-autoload-${canary}\n` },
      "reason=unclassified]",
    ],
    [
      { code: canary, signal: canary, stderr: canary },
      "kind=unknown;exit=none;errno=none;signal=none",
    ],
  ] as const;
  let failure: Error;
  let terminated = false;
  windowsCommands(t, async (command, _args, options) => {
    if (command.endsWith("powershell.exe")) {
      assert.equal(options?.timeout, 10_000, "bound internal ownership measurement");
      throw failure;
    }
    assert.equal(command, "taskkill");
    terminated = true;
    return { stdout: "", stderr: "" };
  });
  for (const [fields, expected] of cases) {
    failure = Object.assign(new Error(canary), fields);
    terminated = false;
    await assert.rejects(killProcessTree(ownedChild()), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.cause, failure);
      assert.ok(error.message.includes(expected), error.message);
      assert.match(error.message, /elapsedMs=\d{1,10};reported=(?:true|false);reason=/);
      assert.equal(error.message.includes(canary), false);
      return true;
    });
    assert.equal(terminated, true, "failed snapshot must still attempt owned termination");
  }
});

test("Windows simultaneous snapshot and termination failures preserve safe command diagnostics", async (t) => {
  const failure = Object.assign(new Error("fixture-canary"), { code: "ENOENT" });
  const termination = new Error("fixture-taskkill-canary");
  windowsCommands(t, async (command) => {
    if (command.endsWith("powershell.exe")) throw failure;
    throw termination;
  });
  await assert.rejects(killProcessTree(ownedChild()), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0].cause, failure);
    assert.equal(error.errors[1], termination);
    assert.match(error.message, /windows-snapshot-command\[kind=spawn;exit=none;errno=ENOENT;/);
    assert.equal(error.message.includes("canary"), false);
    return true;
  });
});

async function sparseEnvironment(t: TestContext): Promise<NodeJS.ProcessEnv> {
  const cache = resolve(".cache");
  await mkdir(cache, { recursive: true });
  const home = await mkdtemp(join(cache, "pguide-cim-home-"));
  t.after(() => rm(home, { recursive: true, force: true, maxRetries: 3 }));
  return {
    ...Object.fromEntries(
      ["Path", "PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap((name) =>
        process.env[name] === undefined ? [] : [[name, process.env[name]]],
      ),
    ),
    HOME: home,
    USERPROFILE: home,
  };
}

if (process.platform === "win32") {
  test("Windows real snapshot subprocess distinguishes command, module and 10s watchdog faults", async (t) => {
    const execute = promisify(childProcess.execFile);
    const env = await sparseEnvironment(t);
    const query =
      "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | Select-Object ProcessId,ParentProcessId";
    let replacement = "";
    windowsCommands(t, async (command, args, options) => {
      if (command.endsWith("powershell.exe")) {
        assert.equal(options?.timeout, 10_000);
        return execute(
          command,
          args.map((arg) => arg.replace(query, replacement)),
          { ...options, env, encoding: "utf8" },
        );
      }
      assert.equal(command, "taskkill");
      return { stdout: "", stderr: "" };
    });
    for (const [fixture, expected] of [
      ["Get-PguideMissingCimFixture", /kind=exit;exit=1;.*reason=command-not-found/],
      [
        "Write-Error -ErrorId CouldNotAutoloadMatchingModule -Message 'fixture-canary'",
        /kind=exit;exit=1;.*reason=module-autoload/,
      ],
      ["Start-Sleep -Seconds 20", /kind=timeout;exit=none;.*killed=true;.*reason=unclassified/],
    ] as const) {
      replacement = fixture;
      await assert.rejects(killProcessTree(ownedChild()), (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, expected);
        assert.equal(error.message.includes("fixture-canary"), false);
        return true;
      });
    }
  });
}

test("forceful cleanup terminates an owned process and its uncooperative child", async (t) => {
  if (process.platform === "win32") {
    const execute = promisify(childProcess.execFile);
    const env = await sparseEnvironment(t);
    assert.equal(env.PSModulePath, undefined);
    assert.equal(env.ProgramFiles, undefined);
    assert.equal(env.LOCALAPPDATA, undefined);
    windowsCommands(t, async (command, args, options) => {
      if (command.endsWith("powershell.exe")) {
        assert.equal(options?.timeout, 10_000);
        const started = performance.now();
        const result = await execute(
          command,
          args.map((arg, index) => (index === 3 ? `Start-Sleep -Seconds 6; ${arg}` : arg)),
          { ...options, env, encoding: "utf8" },
        );
        const elapsed = performance.now() - started;
        assert.ok(elapsed > 5000 && elapsed < 10000, `actual snapshot took ${elapsed}ms`);
        t.diagnostic(`Owned Windows snapshot completed in ${Math.round(elapsed)}ms.`);
        return result;
      }
      assert.equal(command, "taskkill");
      await execute(command, args, { ...options, env, encoding: "utf8" });
      // Simulate a partial/nonzero result after real termination: all captured PIDs must be absent.
      throw Object.assign(new Error("fixture termination race"), { code: 128 });
    });
  }
  const childSource = `process.on("SIGTERM",()=>{});console.log(process.pid);setInterval(()=>{},1000);`;
  const rootSource = `
    const {spawn}=require("node:child_process");
    process.on("SIGTERM",()=>{});
    spawn(process.execPath,["-e",${JSON.stringify(childSource)}],{stdio:["ignore","inherit","inherit"]});
    setInterval(()=>{},1000);
  `;
  const child = spawn(process.execPath, ["-e", rootSource], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = once(child, "close");
  try {
    const grandchild = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Child process did not start.")), 5000);
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.includes("\n")) {
          clearTimeout(timer);
          resolve(Number(output.trim()));
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    assert.ok(Number.isSafeInteger(grandchild) && grandchild > 0);
    await killProcessTree(child);
    await closed;
    const deadline = Date.now() + 3000;
    while (true) {
      try {
        process.kill(grandchild, 0);
      } catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
        break;
      }
      assert.ok(Date.now() < deadline, "Owned descendant remained alive after termination.");
      await delay(10);
    }
  } finally {
    await killProcessTree(child);
    await closed;
  }
});
