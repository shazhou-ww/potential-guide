import assert from "node:assert/strict";
import childProcess, { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { type TestContext, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { killProcessTree } from "@potential-guide/cli-core";

function windowsCommands(
  t: TestContext,
  execute: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>,
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

test("forceful cleanup terminates an owned process and its uncooperative child", async () => {
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
