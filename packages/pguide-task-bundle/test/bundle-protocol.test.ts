import assert from "node:assert/strict";
import test from "node:test";
import { readTaskBundle, taskSchemaUri } from "@potential-guide/task-protocol";
import { inspectTaskArtifact } from "../src/artifact.js";
import { computeContentCid } from "../src/car.js";

function files(runtime = "22.13.0") {
  return new Map([
    [
      "task.yaml",
      Buffer.from(
        JSON.stringify({
          $schema: taskSchemaUri,
          name: "Author Bundle protocol",
          runtime: { type: "node", minVersion: runtime },
          entry: "worker.cjs",
          binary: [],
          include: ["task.yaml", "worker.cjs"],
          inputSchema: { type: "object" },
          resultSchema: true,
          messageSchema: false,
        }),
      ),
    ],
    ["worker.cjs", Buffer.from("throw Error('Worker must not execute during inspection');")],
  ]);
}

test("author inspection reuses protocol structure and retains deterministic content identity", async () => {
  const bundle = files();
  const expected = readTaskBundle(bundle);
  const inspected = await inspectTaskArtifact(bundle);
  assert.deepEqual(inspected.declaration, expected.declaration);
  assert.deepEqual(inspected.resolved, expected.resolved);
  assert.deepEqual(inspected.files, [...bundle.keys()].sort());
  assert.equal(inspected.cid, await computeContentCid(bundle));
});

test("author inspection rejects malformed structure before content import and keeps runtime policy local", async () => {
  const extra = files();
  extra.set("resources/undeclared", Buffer.from("extra"));
  await assert.rejects(inspectTaskArtifact(extra), { code: "invalid_bundle" });
  const invalidWorker = files();
  invalidWorker.set("worker.cjs", Buffer.from([0xff]));
  await assert.rejects(inspectTaskArtifact(invalidWorker), { code: "invalid_bundle" });
  const future = files("999.0.0");
  assert.equal(readTaskBundle(future).declaration.runtime.minVersion, "999.0.0");
  await assert.rejects(inspectTaskArtifact(future), /minimum runtime is unavailable/);
});
