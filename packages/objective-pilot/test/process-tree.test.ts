import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { type TestContext, test } from "node:test";
import { promisify } from "node:util";
import { stopPosixTree } from "../src/process-tree.js";

const child = () => ({ pid: 93001, exitCode: null, signalCode: null }) as ChildProcess;
const absent = () => Object.assign(new Error("gone"), { code: "ESRCH" });

function snapshot(t: TestContext, stdout: string) {
  const original = childProcess.execFile;
  const replacement = (() => {
    throw new Error("Use the promisified fixture command.");
  }) as unknown as typeof childProcess.execFile;
  Object.defineProperty(replacement, promisify.custom, {
    value: async (command: string, args: string[], options: { timeout: number }) => {
      assert.equal(command, "ps");
      assert.deepEqual(args, ["-eo", "pid=,ppid="]);
      assert.equal(options.timeout, 1000);
      return { stdout, stderr: "" };
    },
  });
  childProcess.execFile = replacement;
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    childProcess.execFile = original;
    syncBuiltinESMExports();
  });
}

test("POSIX cleanup retains detached ownership after root exit and waits for hard-killed child exit", async (t) => {
  snapshot(t, "93002 93001\n93001 1\n94000 1\n");
  const alive = new Set([93001, 93002]);
  const hardKilled: number[] = [];
  t.mock.method(process, "kill", (pid: number, signal?: string | number) => {
    assert.ok([-93001, 93001, 93002].includes(pid), "never signal an unowned PID");
    if (signal === 0) {
      if (!alive.has(pid)) throw absent();
    } else if (signal === "SIGTERM" && pid === 93001) {
      alive.delete(pid);
    } else if (signal === "SIGKILL" && pid > 0) {
      hardKilled.push(pid);
      alive.delete(pid);
    }
    return true;
  });
  await stopPosixTree(child(), 1);
  assert.deepEqual(hardKilled, [93002]);
  assert.equal(alive.size, 0);
});

test("POSIX malformed snapshot attempts group cleanup but never reports successful tree cleanup", async (t) => {
  snapshot(t, "93001 1\nmalformed\n");
  const signals: [number, string | number | undefined][] = [];
  t.mock.method(process, "kill", (pid: number, signal?: string | number) => {
    signals.push([pid, signal]);
    return true;
  });
  await assert.rejects(stopPosixTree(child(), 1), /Invalid POSIX process tree snapshot/);
  assert.deepEqual(signals, [[-93001, "SIGKILL"]]);
});

test("POSIX unobservable PID is not accepted as an exit acknowledgement", async (t) => {
  snapshot(t, "93001 1\n");
  const denied = Object.assign(new Error("not observable"), { code: "EPERM" });
  t.mock.method(process, "kill", (_pid: number, signal?: string | number) => {
    if (signal === 0) throw denied;
    return true;
  });
  await assert.rejects(stopPosixTree(child(), 1), (error) => error === denied);
});

test("POSIX live owned PID remains a cleanup failure after the bounded hard-kill wait", async (t) => {
  snapshot(t, "93001 1\n");
  t.mock.method(process, "kill", () => true);
  await assert.rejects(stopPosixTree(child(), 1), /did not exit during bounded cleanup/);
});
