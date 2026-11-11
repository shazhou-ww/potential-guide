import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildTask, readTaskArtifact } from "../src/index.js";

test("external builder outputs round-trip as a directory and CAR with CID guards", async () => {
  const cache = new URL("../../../.cache/", import.meta.url);
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(fileURLToPath(new URL("task-authoring-", cache)));
  try {
    await writeFile(join(root, "main.cjs"), "module.exports = () => {};");
    await writeFile(
      join(root, "contract.json"),
      JSON.stringify({
        input: { type: "object" },
        result: { type: "null" },
        message: { not: {} },
      }),
    );
    await writeFile(
      join(root, "task.build.yaml"),
      JSON.stringify({
        $schema:
          "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task-build/v1.json",
        name: "Integration",
        runtime: { minVersion: "22.13.0" },
        source: { entry: "main.cjs", contract: "contract.json", mode: "explicit" },
        outDirectory: "bundle",
      }),
    );
    const built = await buildTask(join(root, "task.build.yaml"));
    const car = await readTaskArtifact(built.car, built.cid);
    const directory = await readTaskArtifact(built.directory, built.cid);
    assert.deepEqual(car.files, directory.files);
    assert.ok(car.files.has("worker.cjs"));
    await assert.rejects(readTaskArtifact(built.car, "invalid"), /CID|cid|base/);
    await assert.rejects(readTaskArtifact(built.directory, "invalid"), /CID|cid|base/);
    await assert.rejects(buildTask(join(root, "missing.yaml")), /.+/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
