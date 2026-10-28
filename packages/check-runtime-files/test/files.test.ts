import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  closePrivateFileBackend,
  createPrivateDirectory,
  ensurePrivateDirectory,
  readArtifact,
  snapshotArtifact,
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
