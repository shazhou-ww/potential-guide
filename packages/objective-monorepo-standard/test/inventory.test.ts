import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { captureFilesystemObservation } from "@potential-guide/objective-pilot";
import { observeRepository } from "../src/repository-observation.js";
import { Snapshot } from "../src/shared.js";

test("combining public manifests and package files preserves the total inventory bound", async () => {
  class WideSnapshot extends Snapshot {
    override async text() {
      return "packages: [packages/*]";
    }
    override async workspaceManifests() {
      return ["packages/one/package.json", "packages/two/package.json"];
    }
    override async files() {
      return Array.from({ length: 20000 }, (_, index) => `packages/one/file-${index}`);
    }
  }
  const facts = await observeRepository(new WideSnapshot(resolve(".")), "packages/one");
  assert.match(facts.failure ?? "", /Inventory exceeds 20,000 files/);
});

test("live explicit reads retain ignored-path compatibility while input views reject excluded paths", async () => {
  await mkdir(resolve(".cache"), { recursive: true });
  const directory = await mkdtemp(resolve(".cache", "snapshot-boundary-"));
  try {
    const root = await realpath(directory);
    await mkdir(resolve(root, ".cache"));
    await writeFile(resolve(root, ".cache", "explicit.txt"), "explicit input");
    const live = new Snapshot(root);
    assert.equal(await live.text(".cache/explicit.txt"), "explicit input");
    assert.equal(await live.exists(".cache/explicit.txt"), true);
    assert.deepEqual(await live.files(), []);
    const view = await captureFilesystemObservation(root, new AbortController().signal);
    assert.ok(view);
    const bounded = new Snapshot(root, view);
    await assert.rejects(
      bounded.text(".cache/explicit.txt"),
      /excluded by the input view contract/,
    );
    await assert.rejects(
      bounded.exists(".cache/explicit.txt"),
      /excluded by the input view contract/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
