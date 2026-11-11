import assert from "node:assert/strict";
import fs, { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stageCheck } from "../packages/check-environment/build.mjs";
import { prepareCheck } from "../packages/check-sdk/dist/authoring.js";
import { readTaskArtifact } from "../packages/task-authoring/dist/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
test("environment candidate writes the validated snapshot after source path replacement", async (t) => {
  const source = join(root, "packages/check-environment");
  await mkdir(join(root, ".cache"), { recursive: true });
  const scratch = await mkdtemp(join(root, ".cache", "environment-snapshot-"));
  const originalWrite = fs.writeFile;
  try {
    const prepared = await prepareCheck(join(source, "tools.check.build.yaml"));
    const references = JSON.parse(
      await readFile(join(source, "dist/bundles/references.json"), "utf8"),
    );
    const built = {
      directory: join(scratch, "source"),
      car: join(scratch, "source.car"),
      cid: references.tools.cid,
    };
    await cp(join(source, "dist/bundles/tools"), built.directory, { recursive: true });
    await cp(join(source, "dist/bundles/tools.car"), built.car);
    const candidate = join(scratch, "candidate");
    let replaced = false;
    t.mock.method(fs, "writeFile", async (path, ...args) => {
      if (!replaced && String(path).startsWith(candidate)) {
        replaced = true;
        await originalWrite(built.car, "replacement after validation");
        await originalWrite(join(built.directory, "worker.cjs"), "replacement after validation");
      }
      return originalWrite(path, ...args);
    });
    syncBuiltinESMExports();
    const reference = await stageCheck(prepared, built, candidate);
    assert.ok(replaced);
    assert.equal(reference.cid, built.cid);
    assert.equal(
      (await readTaskArtifact(join(candidate, reference.car), built.cid)).cid,
      built.cid,
    );
    assert.equal(
      (await readTaskArtifact(join(candidate, reference.directory), built.cid)).cid,
      built.cid,
    );
    const accepted = await readFile(join(candidate, reference.car));
    await assert.rejects(stageCheck(prepared, built, candidate));
    assert.deepEqual(await readFile(join(candidate, reference.car)), accepted);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await rm(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
});
