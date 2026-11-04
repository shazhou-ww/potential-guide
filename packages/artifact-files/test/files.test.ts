import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { link, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import {
  ArtifactTreeError,
  assertRuntime,
  parseArtifactYaml,
  readArtifactFiles,
  readArtifactTree,
  safeComponent,
  safePath,
} from "../src/index.js";

async function fixture(t: TestContext) {
  const directory = resolve(".test-artifact-files", randomUUID());
  await mkdir(directory, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("strict YAML accepts finite JSON and rejects alternate YAML data models", () => {
  assert.deepEqual(parseArtifactYaml(Buffer.from("name: example\nitems: [1, true, null]\n")), {
    name: "example",
    items: [1, true, null],
  });
  for (const text of [
    "a: &a [1]\nb: *a",
    "a: !!str value",
    "!custom value",
    "%YAML 1.2\n---\na: 1",
    "a: 1\na: 2",
    "1: value",
    "a: .inf",
    "a: .nan",
    "---\na: 1\n---\na: 2",
  ])
    assert.throws(() => parseArtifactYaml(Buffer.from(text)), text);
  assert.throws(() => parseArtifactYaml(Buffer.from([0xff])));
  assert.throws(() => parseArtifactYaml(Buffer.alloc(65_537, 32)), /bounds/);
});

test("portable paths and runtime policy retain the shared safety rules", () => {
  assert.ok(safePath("resources/example.json"));
  for (const name of ["", ".", "..", "node_modules", "CON.txt", "a:", "a\\b", "a ", "e\u0301"])
    assert.equal(safeComponent(name), false, name);
  assert.equal(safePath("../outside"), false);
  assert.equal(safePath("a/Node_Modules/file"), false);
  assertRuntime({ runtime: { type: "node", minVersion: "22.13.0" } });
  assert.throws(
    () =>
      assertRuntime(
        { runtime: { type: "node", minVersion: "22.13.0" } },
        { type: "node", version: "22.12.0" },
      ),
    /support policy/,
  );
  assert.throws(
    () =>
      assertRuntime(
        { runtime: { type: "node", minVersion: "999.0.0" } },
        { type: "node", version: "22.13.0" },
      ),
    /unavailable/,
  );
});

test("portable reader preserves bytes and rejects empty directories", async (t) => {
  const directory = await fixture(t);
  await mkdir(join(directory, "resources"));
  await writeFile(join(directory, "resources", "data.bin"), Buffer.from([0, 255, 17]));
  const files = await readArtifactFiles(directory);
  assert.deepEqual([...files], [["resources/data.bin", Buffer.from([0, 255, 17])]]);
  await mkdir(join(directory, "empty"));
  await assert.rejects(readArtifactFiles(directory), /empty directory/);
});

test("portable reader rejects case-colliding paths", {
  skip: process.platform === "win32",
}, async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, "resource"), "a");
  await writeFile(join(directory, "RESOURCE"), "b");
  await assert.rejects(readArtifactFiles(directory), /ambiguous/);
});

test("readers reject hard links, directory links and noncanonical roots", async (t) => {
  const directory = await fixture(t);
  const source = join(directory, "source");
  await writeFile(source, "bytes");
  await link(source, join(directory, "hardlink"));
  await assert.rejects(readArtifactFiles(directory), /hard-link/);
  await rm(join(directory, "hardlink"));
  const target = await fixture(t);
  await symlink(
    target,
    join(directory, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(readArtifactFiles(directory), /links/);
  await assert.rejects(readArtifactFiles(join(directory, "linked")), /canonical/);
});

test("tree budgets retain typed status errors for host adapters", async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, "a"), "12");
  await writeFile(join(directory, "b"), "34");
  for (const limits of [{ bytes: 3 }, { fileBytes: 1 }, { files: 1 }, { paths: 1 }])
    await assert.rejects(
      readArtifactTree(directory, limits),
      (error: unknown) => error instanceof ArtifactTreeError && error.status === 413,
    );
  for (const limits of [{ bytes: 0 }, { fileBytes: Number.NaN }, { files: 1.5 }])
    await assert.rejects(
      readArtifactTree(directory, limits),
      (error: unknown) => error instanceof ArtifactTreeError && error.status === 400,
    );
  await assert.rejects(readArtifactTree("relative"), /absolute/);
  assert.equal((await readArtifactTree(directory)).files.size, 2);
});
