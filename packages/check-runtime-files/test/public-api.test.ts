import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import * as files from "../dist/index.js";

test("runtime file public API retains file, snapshot, lock and confined access without Checker execution", async () => {
  for (const [name, value] of Object.entries({
    readArtifactTree: files.readArtifactTree,
    readArtifact: files.readArtifact,
    snapshotArtifact: files.snapshotArtifact,
    publishArtifact: files.publishArtifact,
    ensurePrivateDirectory: files.ensurePrivateDirectory,
    createPrivateFile: files.createPrivateFile,
    readPrivateFile: files.readPrivateFile,
    closePrivateFileBackend: files.closePrivateFileBackend,
    readConfinedFile: files.readConfinedFile,
    normalizeFileRoots: files.normalizeFileRoots,
    filePathAllowed: files.filePathAllowed,
    withFileMutex: files.withFileMutex,
  }))
    assert.equal(typeof value, "function", name);
  assert.equal("checkerWorkerSource" in files, false);
  assert.equal("checkerRuntimeRevision" in files, false);
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  assert.equal(manifest.scripts.build, "tsc -b");
  assert.equal(manifest.dependencies, undefined);
});

test("retired Checker Worker subpaths and generated source artifacts cannot be resolved or shipped", async () => {
  for (const name of ["worker", "worker-json"]) {
    const specifier = `@potential-guide/check-runtime-files/${name}`;
    assert.throws(() => import.meta.resolve(specifier), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    await assert.rejects(import(specifier), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  }
  for (const name of [
    "worker",
    "worker-json",
    "worker-types",
    "worker-source",
    "runtime-identity",
  ]) {
    await assert.rejects(access(new URL(`../src/${name}.ts`, import.meta.url)), { code: "ENOENT" });
    for (const extension of ["js", "d.ts", "js.map", "d.ts.map"])
      await assert.rejects(access(new URL(`../dist/${name}.${extension}`, import.meta.url)), {
        code: "ENOENT",
      });
  }
});
