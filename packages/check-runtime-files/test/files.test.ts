import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  closePrivateFileBackend,
  createPrivateDirectory,
  ensurePrivateDirectory,
  readArtifact,
  snapshotArtifact,
  createPrivateFile,
  publishPrivateFile,
  readPrivateFile,
} from "../dist/index.js";

test("shared private primitives preserve verified complete trees and immutable snapshot bytes", async () => {
  const directory = await createPrivateDirectory(resolve(".cache", "runtime-files-tests"), "case-");
  try {
    await ensurePrivateDirectory(directory);
    const source = join(directory, "source");
    await mkdir(join(source, "resources"), { recursive: true });
    await writeFile(join(source, "worker.cjs"), "exports.execute=()=>({ok:true});");
    await writeFile(join(source, "resources", "data.txt"), "V2");
    const old = await readArtifact(source);
    assert.equal(old.files.size, 2);
    const snapshot = await snapshotArtifact(old, join(directory, "snapshots"));
    assert.equal((await readArtifact(snapshot)).revision, old.revision);
    await writeFile(join(source, "resources", "data.txt"), "V3");
    assert.notEqual((await readArtifact(source)).revision, old.revision);
    assert.equal(await readFile(join(snapshot, "resources", "data.txt"), "utf8"), "V2");
    await chmod(join(snapshot, "resources", "data.txt"), 0o600);
    await writeFile(join(snapshot, "resources", "data.txt"), "changed");
    assert.notEqual((await readArtifact(snapshot)).revision, old.revision);
  } finally {
    await closePrivateFileBackend();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows private publication waits for a verified reader without relaxing owner or ACL checks", {
  skip: process.platform !== "win32",
}, async () => {
  const directory = await createPrivateDirectory(
    resolve(".cache", "runtime-files-tests"),
    "reader-",
  );
  await createPrivateFile(directory, "host.json", '{"version":1}');
  const child = spawn(
    join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      '$ErrorActionPreference="Stop";$path=([Console]::ReadLine()|ConvertFrom-Json).path;$file=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{[Console]::WriteLine("held");[Console]::ReadLine()|Out-Null}finally{$file.Dispose()}',
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Owned reader exited ${code}.`)),
    );
  });
  const timeout = setTimeout(() => child.kill(), 10_000);
  try {
    const held = new Promise<void>((resolve, reject) => {
      child.stdout.once("data", (bytes) =>
        String(bytes).trim() === "held" ? resolve() : reject(new Error("Reader handshake failed.")),
      );
    });
    child.stdin.write(`${JSON.stringify({ path: join(directory, "host.json") })}\n`);
    await Promise.race([
      held,
      exited.then(() => {
        throw new Error("Reader exited before its handshake.");
      }),
    ]);
    const deniedAt = performance.now();
    await assert.rejects(
      publishPrivateFile(directory, "host.json", '{"version":2}', '{"version":1}'),
      (error) => error instanceof Error && "code" in error && error.code === "EPRIVATE",
    );
    const denialMs = performance.now() - deniedAt;
    assert.ok(
      denialMs >= 900 && denialMs < 8000,
      `private rename denial must remain bounded: ${denialMs}ms`,
    );
    assert.equal(await readPrivateFile(directory, "host.json"), '{"version":1}');
    const publishing = publishPrivateFile(
      directory,
      "host.json",
      '{"version":2}',
      '{"version":1}',
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    assert.equal(await Promise.race([publishing, delay(150).then(() => null)]), null);
    child.stdin.end("release\n");
    const outcome = await publishing;
    if ("error" in outcome) throw outcome.error;
    assert.equal(outcome.value, true);
    await exited;
    assert.equal(await readPrivateFile(directory, "host.json"), '{"version":2}');
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill();
    await exited.catch(() => {});
    await closePrivateFileBackend();
    await rm(directory, { recursive: true, force: true });
  }
});
