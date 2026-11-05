import assert from "node:assert/strict";
import { constants } from "node:fs";
import fs, { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test, { type TestContext } from "node:test";
import { readArtifact, readArtifactTree, snapshotArtifact } from "../src/artifact.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "runtime-tree-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("native runtime tree accepts relative roots and hard links while snapshots retain observed bytes", async (t) => {
  const root = await fixture(t);
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "worker.cjs"), "module.exports = {};");
  await writeFile(join(source, "data"), "old");
  await link(join(source, "data"), join(source, "alias"));
  const artifact = await readArtifact(relative(process.cwd(), source));
  assert.deepEqual(artifact.files.get("alias"), artifact.files.get("data"));
  const snapshot = await snapshotArtifact(artifact, join(root, "snapshots"));
  assert.equal((await readArtifact(snapshot)).revision, artifact.revision);
  await writeFile(join(source, "data"), "new");
  assert.equal(await readFile(join(snapshot, "data"), "utf8"), "old");
  assert.notEqual((await readArtifact(source)).revision, artifact.revision);
});

test("native runtime file streams enforce inclusive byte, file and path budgets", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "a"), "12");
  await writeFile(join(root, "b"), "34");
  const handles: Awaited<ReturnType<typeof fs.open>>[] = [];
  const originalOpen = fs.open;
  const intercepted = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    assert.equal(args[1], constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const handle = await originalOpen(...args);
    handles.push(handle);
    return handle;
  });
  syncBuiltinESMExports();
  try {
    assert.equal(
      (await readArtifactTree(root, { bytes: 4, fileBytes: 2, files: 2, paths: 2 })).files.size,
      2,
    );
    for (const limits of [{ bytes: 3 }, { fileBytes: 1 }, { files: 1 }, { paths: 1 }])
      await assert.rejects(readArtifactTree(root, limits), { status: 413 });
    for (const limits of [{ bytes: 0 }, { fileBytes: NaN }, { files: 1.5 }])
      await assert.rejects(readArtifactTree(root, limits), { status: 400 });
    assert.ok(handles.length > 0);
    assert.ok(handles.every((handle) => handle.fd === -1));
  } finally {
    intercepted.mock.restore();
    syncBuiltinESMExports();
  }
});

test("runtime file handles physically close on read-stream and stream-creation errors", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "data"), "bytes");
  const handles: Awaited<ReturnType<typeof fs.open>>[] = [];
  const originalOpen = fs.open;
  let failCreation = false;
  const intercepted = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    handles.push(handle);
    const originalStream = handle.createReadStream.bind(handle);
    t.mock.method(
      handle,
      "createReadStream",
      (...options: Parameters<typeof handle.createReadStream>) => {
        assert.equal(options[0]?.autoClose, false);
        if (failCreation) throw new Error("fixture stream creation failed");
        const stream = originalStream(...options);
        queueMicrotask(() => stream.destroy(new Error("fixture stream read failed")));
        return stream;
      },
    );
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(readArtifactTree(root), /fixture stream read failed/);
    assert.ok(handles.every((handle) => handle.fd === -1));
    failCreation = true;
    await assert.rejects(readArtifactTree(root), /fixture stream creation failed/);
    assert.equal(handles.length, 2);
    assert.ok(handles.every((handle) => handle.fd === -1));
  } finally {
    intercepted.mock.restore();
    syncBuiltinESMExports();
  }
});

test("native runtime tree rejects links but leaves portable naming and empty directories to consumers", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "empty"));
  const tree = await readArtifactTree(root);
  assert.deepEqual(tree.directories, ["empty"]);
  assert.equal(tree.files.size, 0);
  const outside = await fixture(t);
  await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(readArtifactTree(root), { status: 400 });
  await assert.rejects(readArtifactTree(join(root, "linked")), { status: 400 });
});
