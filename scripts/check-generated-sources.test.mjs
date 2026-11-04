import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generatedSources, guardGeneratedSources } from "./check-generated-sources.mjs";

async function fixture(t) {
  const cache = fileURLToPath(new URL("../.cache/", import.meta.url));
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(join(cache, "generated-source-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = generatedSources.map((file) => join(root, "packages", file));
  for (const path of files) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "original\r\n");
  }
  return { root, files };
}

test("generated-source guards detect overwritten drift and preserve every original byte", async (t) => {
  const { root, files } = await fixture(t);
  for (const path of files) {
    await assert.rejects(
      guardGeneratedSources(root, () => writeFile(path, "regenerated\n")),
      /Generated source drift/,
    );
    for (const file of files) assert.equal(await readFile(file, "utf8"), "original\r\n");
  }
});

test("failed builds restore source snapshots and propagate the failure", async (t) => {
  const { root, files } = await fixture(t);
  await assert.rejects(
    guardGeneratedSources(root, async () => {
      await writeFile(files[0], "partial build");
      throw new Error("owned build failure");
    }),
    /owned build failure/,
  );
  assert.equal(await readFile(files[0], "utf8"), "original\r\n");
});

test("guards allow identical generated content with platform line endings", async (t) => {
  const { root, files } = await fixture(t);
  await guardGeneratedSources(root, () => writeFile(files[0], "original\n"));
  assert.equal(await readFile(files[0], "utf8"), "original\r\n");
});
