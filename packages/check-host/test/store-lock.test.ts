import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createPrivateDirectory, createPrivateFile } from "../dist/index.js";
import { withFileMutex } from "../dist/store-lock.js";

test("native SQLite mutex serializes independent processes without storing a database", async () => {
  const root = await createPrivateDirectory(resolve(".cache", "check-host-tests"), "store-lock-");
  const lock = join(root, "mutex.db");
  const counter = join(root, "counter");
  try {
    await createPrivateFile(root, "mutex.db", "");
    await writeFile(counter, "0");
    const script = `
import {readFile,writeFile} from "node:fs/promises";
const {withFileMutex}=await import(process.argv[1]);
for(let n=0;n<4;n++)await withFileMutex(process.argv[2],async()=>{
  const before=Number(await readFile(process.argv[3],"utf8"));
  await new Promise(done=>setTimeout(done,5));
  await writeFile(process.argv[3],String(before+1));
});`;
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        promisify(execFile)(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            script,
            new URL("../dist/store-lock.js", import.meta.url).href,
            lock,
            counter,
          ],
          { windowsHide: true, timeout: 15_000 },
        ),
      ),
    );
    for (const result of results) if (result.status === "rejected") throw result.reason;
    assert.equal(await readFile(counter, "utf8"), "16");
    assert.equal((await lstat(lock)).size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native mutex releases after a killed owner; a live owner is not stolen", async () => {
  const root = await createPrivateDirectory(resolve(".cache", "check-host-tests"), "store-crash-");
  const lock = join(root, "mutex.db");
  await createPrivateFile(root, "mutex.db", "");
  const inode = (await lstat(lock)).ino;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const {withFileMutex}=await import(process.argv[1]);
await withFileMutex(process.argv[2],async()=>{console.log("locked");await new Promise(()=>setInterval(()=>{},1000))});`,
      new URL("../dist/store-lock.js", import.meta.url).href,
      lock,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  let operation: Promise<unknown> | undefined;
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error("Owned lock holder not ready.")), 5000);
      child.stdout.once("data", () => {
        clearTimeout(timer);
        done();
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    let settled = false;
    operation = withFileMutex(lock, async () => "acquired").finally(() => {
      settled = true;
    });
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(settled, false);
    child.kill("SIGKILL");
    await closed;
    assert.equal(await operation, "acquired");
    assert.equal((await lstat(lock)).ino, inode);
    assert.equal((await lstat(lock)).size, 0);
    await assert.rejects(
      withFileMutex(lock, async () => {
        throw new Error("intentional operation failure");
      }),
      /intentional operation failure/,
    );
    assert.equal(await withFileMutex(lock, async () => "recovered"), "recovered");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
    await operation?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
