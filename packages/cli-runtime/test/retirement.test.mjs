import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { CliError } from "@potential-guide/cli-core";
import { buildExample } from "../examples/objective-artifact/build.mjs";
import {
  inspectObjectiveArtifact,
  objectiveArtifactLocation,
  parseObjectiveArtifactLocation,
  withPilot,
} from "../dist/index.js";

test("retired Pilot sources reject without callback execution, source IO or reports", async (t) => {
  const scratch = resolve("../../.cache");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "pilot-retirement-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  for (const source of [
    "@fixture/legacy",
    "git+https://example.invalid/legacy.git#objective/",
    "objective:https://example.invalid/objective.tgz",
    "artifact+file:///nonexistent?digest=invalid",
  ]) {
    await assert.rejects(
      withPilot(
        source,
        directory,
        undefined,
        async () => {
          calls++;
        },
        {
          reports: { enabled: true, directory: join(directory, "reports") },
          cacheDirectory: join(directory, "cache"),
        },
      ),
      (error) =>
        error instanceof CliError &&
        error.exitCode === 2 &&
        error.status === "pilot-error" &&
        /Legacy Pilot execution is retired/.test(error.message),
    );
  }
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(directory), []);
});

test("an already cancelled Pilot call retains its explicit cancellation reason", async () => {
  const controller = new AbortController();
  const reason = new Error("caller-cancelled");
  controller.abort(reason);
  await assert.rejects(
    withPilot(
      "unused",
      process.cwd(),
      undefined,
      async () => {
        assert.fail("Callback must not execute");
      },
      { signal: controller.signal },
    ),
    (error) => error === reason,
  );
});

test("local Objective artifact inspection and exact reference codecs remain usable without a Host", async (t) => {
  const scratch = resolve("../../.cache");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "artifact-static-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const built = await buildExample(join(directory, "delivery"));
  const inspected = await inspectObjectiveArtifact(built.directory);
  assert.equal(inspected.digest, built.digest);
  assert.equal(inspected.manifest.id, "objective:composition");
  const reference = objectiveArtifactLocation(built.directory, built.digest);
  assert.deepEqual(parseObjectiveArtifactLocation(reference), {
    directory: built.directory,
    digest: built.digest,
  });
});
