import assert from "node:assert/strict";
import { promises as filesystem } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { publishArtifact, readArtifact } from "../dist/index.js";

async function fixture() {
  const parent = resolve(".cache", "check-host-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "publication-"));
  const source = join(root, "source");
  const published = join(root, "published");
  const destination = join(published, "stable");
  await mkdir(source);
  await writeFile(join(source, "worker.cjs"), "exports.execute=()=>({version:1});");
  const old = await publishArtifact(source, destination);
  await writeFile(join(source, "worker.cjs"), "exports.execute=()=>({version:2});");
  return { root, source, published, destination, old };
}

test("publication preparation failure releases its lock and preserves the prior artifact", async (t) => {
  const f = await fixture();
  const original = filesystem.writeFile;
  try {
    t.mock.method(
      filesystem,
      "writeFile",
      async (...args: Parameters<typeof filesystem.writeFile>) => {
        if (String(args[0]).startsWith(f.published))
          throw new Error("Injected snapshot write failure.");
        return original(...args);
      },
    );
    syncBuiltinESMExports();
    await assert.rejects(publishArtifact(f.source, f.destination), /Injected snapshot/);
    assert.equal((await readArtifact(f.destination)).revision, f.old);
    await assert.rejects(stat(`${f.destination}.lock`), { code: "ENOENT" });
    t.mock.restoreAll();
    syncBuiltinESMExports();
    assert.notEqual(await publishArtifact(f.source, f.destination), f.old);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("failed installation and rollback retain the last good artifact instead of deleting it", async (t) => {
  const f = await fixture();
  const original = filesystem.rename;
  let previous = "";
  try {
    t.mock.method(filesystem, "rename", async (...args: Parameters<typeof filesystem.rename>) => {
      if (String(args[1]) === f.destination)
        throw new Error("Injected installation and rollback failure.");
      if (String(args[0]) === f.destination) previous = String(args[1]);
      return original(...args);
    });
    syncBuiltinESMExports();
    await assert.rejects(publishArtifact(f.source, f.destination), /previous artifact retained/);
    assert.ok(previous.startsWith(`${f.destination}.`));
    assert.equal((await readArtifact(previous)).revision, f.old);
    assert.deepEqual(await readdir(f.published), [basename(previous)]);
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await rename(previous, f.destination);
    assert.notEqual(await publishArtifact(f.source, f.destination), f.old);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await rm(f.root, { recursive: true, force: true });
  }
});
