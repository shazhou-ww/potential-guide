import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("native mutex retains its guard across forced GC until the unresolved owner exits", async () => {
  const root = resolve(".cache", `mutex-gc-${randomUUID()}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "mutex.db");
  await writeFile(path, "", { mode: 0o600 });
  const child = spawn(
    process.execPath,
    [
      "--expose-gc",
      "--input-type=module",
      "-e",
      `const {withFileMutex}=await import(process.argv[1]);
await withFileMutex(process.argv[2],async()=>{
  setTimeout(()=>{global.gc();console.log("collected");},50);
  await new Promise(()=>setInterval(()=>{},1000));
});`,
      new URL("../dist/store-lock.js", import.meta.url).href,
      path,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = new Promise<void>((done) => child.once("close", () => done()));
  let guard: DatabaseSync | undefined;
  try {
    await new Promise<void>((done, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("GC fixture did not acquire its lock.")),
        5000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("collected")) {
          clearTimeout(timer);
          done();
        }
      });
    });
    guard = new DatabaseSync(path);
    assert.throws(
      () => guard?.exec("BEGIN EXCLUSIVE"),
      (error: unknown) =>
        error instanceof Error && "errcode" in error && [5, 6].includes(Number(error.errcode)),
    );
    child.kill("SIGKILL");
    await exited;
    guard.exec("BEGIN EXCLUSIVE");
    guard.exec("ROLLBACK");
    assert.equal((await lstat(path)).size, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    guard?.close();
    await rm(root, { recursive: true, force: true });
  }
});
