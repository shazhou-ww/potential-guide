import assert from "node:assert/strict";
import { constants } from "node:fs";
import fs, { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test, { type TestContext } from "node:test";
import { readTaskArtifactFiles } from "../src/local-files.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "task-local-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("native Task directory reading accepts relative roots and read-only hard links without rewriting bytes", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "resources"));
  await writeFile(join(root, "resources", "data"), Buffer.from([0, 255, 17]));
  await link(join(root, "resources", "data"), join(root, "resources", "alias"));
  const files = await readTaskArtifactFiles(relative(process.cwd(), root));
  assert.deepEqual(files.get("resources/data"), Buffer.from([0, 255, 17]));
  assert.deepEqual(files.get("resources/alias"), files.get("resources/data"));
  assert.deepEqual(await readFile(join(root, "resources", "data")), files.get("resources/data"));
});

test("Task directory reading keeps protocol path and empty-directory rules at the author boundary", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "empty"));
  await assert.rejects(readTaskArtifactFiles(root), /empty directory/);
  await writeFile(join(root, "empty", "data"), "bytes");
  assert.equal((await readTaskArtifactFiles(root)).get("empty/data")?.toString(), "bytes");
  await mkdir(join(root, "node_modules"));
  await assert.rejects(readTaskArtifactFiles(root), /unsafe/);
});

test("Task directory reading rejects symbolic-directory and file links without following them", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await writeFile(join(outside, "private"), "outside");
  await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(readTaskArtifactFiles(root), /links/);
  await assert.rejects(readTaskArtifactFiles(join(root, "linked")), /links/);
});

test("Task file handles physically close after success, read errors and stream-creation errors", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "data"), "bytes");
  const handles: Awaited<ReturnType<typeof fs.open>>[] = [];
  const originalOpen = fs.open;
  let failure: "read" | "create" | undefined;
  const intercepted = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    assert.equal(args[1], constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const handle = await originalOpen(...args);
    handles.push(handle);
    const originalStream = handle.createReadStream.bind(handle);
    t.mock.method(
      handle,
      "createReadStream",
      (...options: Parameters<typeof handle.createReadStream>) => {
        assert.equal(options[0]?.autoClose, false);
        if (failure === "create") throw new Error("fixture stream creation failed");
        const stream = originalStream(...options);
        if (failure === "read")
          queueMicrotask(() => stream.destroy(new Error("fixture stream read failed")));
        return stream;
      },
    );
    return handle;
  });
  syncBuiltinESMExports();
  try {
    assert.equal((await readTaskArtifactFiles(root)).get("data")?.toString(), "bytes");
    assert.ok(handles.every((handle) => handle.fd === -1));
    failure = "read";
    await assert.rejects(readTaskArtifactFiles(root), /fixture stream read failed/);
    assert.ok(handles.every((handle) => handle.fd === -1));
    failure = "create";
    await assert.rejects(readTaskArtifactFiles(root), /fixture stream creation failed/);
    assert.equal(handles.length, 3);
    assert.ok(handles.every((handle) => handle.fd === -1));
  } finally {
    intercepted.mock.restore();
    syncBuiltinESMExports();
  }
});
