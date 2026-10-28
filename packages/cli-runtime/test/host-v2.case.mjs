import assert from "node:assert/strict";
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join } from "node:path";
import test from "node:test";
import { inspectCheckArtifact } from "@potential-guide/check-artifacts";
import { packCheckArtifact } from "@potential-guide/check-artifacts/build";
import { closePrivateFileBackend } from "@potential-guide/check-host";
import { Effect } from "@potential-guide/effects";
import { observe, readPage } from "@potential-guide/objective-pilot";
import { makeRegulatorSpec, regulate } from "../../objective-regulator/dist/index.js";
import { createWorkerHost } from "../../../scripts/worker-test-helpers.mjs";
import { buildExample } from "../examples/objective-artifact/build.mjs";
import { inspectObjectiveArtifact, objectiveArtifactLocation, withPilot } from "../dist/index.js";

const directory = process.env.V2_BUSINESS_DIRECTORY;
if (!directory) throw new Error("Run host-v2.test.mjs to establish TLS trust.");
test("real HTTP fixed Objective source, inherited References, evidence, regulator and offline-source recovery", async () => {
  const built = await buildExample(join(directory, "delivery"));
  const archives = new Map(),
    bindings = new Map();
  for (const id of ["value", "dependency"]) {
    const source = join(directory, "delivery", id);
    const archive = join(directory, `${id}.tgz`);
    const packed = await packCheckArtifact(source, archive);
    archives.set(`/${id}`, await readFile(archive));
    bindings.set(id, {
      digest: (await inspectCheckArtifact(source)).digest,
      transportDigest: packed.transportDigest,
    });
  }
  const https = createServer(
    {
      cert: await readFile(join(directory, "cert.pem")),
      key: await readFile(join(directory, "key.pem")),
    },
    (req, res) => {
      const bytes = archives.get(req.url);
      res.writeHead(bytes ? 200 : 503);
      res.end(bytes);
    },
  );
  await new Promise((resolve) => https.listen(0, "127.0.0.1", resolve));
  const origin = `https://127.0.0.1:${https.address().port}`;
  for (const name of ["prerequisite", "objective"]) {
    const path = join(directory, "delivery", name, "objective.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    for (const check of Object.values(manifest.checks)) {
      const id = check.source.directory.endsWith("dependency") ? "dependency" : "value";
      check.source = { kind: "https", url: `${origin}/${id}`, ...bindings.get(id) };
    }
    if (name === "objective") {
      const prerequisite = await inspectObjectiveArtifact(
        join(directory, "delivery", "prerequisite"),
      );
      manifest.dependencies["objective:composition-prerequisite"].digest = prerequisite.digest;
    }
    await writeFile(path, JSON.stringify(manifest));
  }
  const objective = await inspectObjectiveArtifact(built.directory);
  const location = objectiveArtifactLocation(built.directory, objective.digest);
  const host = await createWorkerHost(join(directory, "host"), { allowedOrigins: [origin] });
  const cacheDirectory = join(directory, "client-cache"),
    reports = join(directory, "reports");
  const options = { cacheDirectory, reports: { enabled: true, directory: reports } };
  let frozen;
  try {
    await withPilot(
      location,
      directory,
      undefined,
      async (spec, runtime) => {
        frozen = Object.fromEntries(
          runtime.boundObjectives().map((bound) => [bound.objectiveId, bound.source]),
        );
        assert.equal(spec.source.checks.first.digest, bindings.get("value").digest);
        const base = readPage(spec, "pages/base-second-not-ready");
        assert.equal(base.origin.artifactDigest, bindings.get("value").digest);
        assert.match(base.resourceBase, /\/v2\/artifacts\/.+\/references\//);
        assert.match(base.content, /Uncovered references/);
        const failing = await Effect.runPromise(
          observe(
            {
              spec,
              subject: { first: false, second: true, dependencyReady: true },
            },
            runtime,
          ),
        );
        assert.equal(failing.status, 200);
        assert.equal(failing.payload.current.levelId, "initial");
        const strategy = {
          targetLevel: "complete",
          agentExecutionLimits: { timeoutMs: 1000 },
          quota: { timeoutMs: 20_000, maxAgentRuns: 1, maxStallRuns: 1 },
        };
        const outcome = await Effect.runPromise(
          regulate(
            {
              spec: makeRegulatorSpec(spec, strategy, { id: "unused" }),
              subject: { first: true, second: true, dependencyReady: true },
            },
            {
              pilot: runtime,
              executeAgent: async () => {
                throw new Error("No remediation required.");
              },
            },
          ),
        );
        assert.equal(outcome.stopReason, "target-reached");
        assert.equal(outcome.latestObservation.payload.current.levelId, "complete");
      },
      options,
    );
    assert.deepEqual(
      await readdir(join(cacheDirectory, "objective-artifacts")),
      ["objectives"],
      "HTTPS Check materialization belongs to Host, never the Pilot client",
    );
    const run = (await readdir(reports))[0];
    const events = (await readFile(join(reports, run, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    const observations = events.filter((event) => event.event === "check.host-observation");
    assert.ok(observations.length >= 4);
    assert.ok(
      observations.every(
        (event) => event.data.taskId && event.data.executionId && event.data.artifact.digest,
      ),
    );
    assert.ok(observations.every((event) => /^[a-f0-9]{64}$/.test(event.data.artifact.revision)));
    assert.ok(!JSON.stringify(observations).includes("artifactDirectory"));

    // Same URL now serves different content. Frozen Objective must retain its old exact binding.
    const changed = join(directory, "changed");
    await cp(join(directory, "delivery", "value"), changed, { recursive: true });
    await writeFile(join(changed, "references", "check.md"), "# V3 metadata\n");
    const changedArchive = join(directory, "changed.tgz");
    await packCheckArtifact(changed, changedArchive);
    archives.set("/value", await readFile(changedArchive));
    await withPilot(
      "objective:composition",
      directory,
      undefined,
      async (spec, runtime) => {
        assert.equal(spec.source.checks.first.digest, frozen[spec.objectiveId].checks.first.digest);
        const observed = await Effect.runPromise(
          observe(
            {
              spec,
              subject: { first: true, second: true, dependencyReady: true },
            },
            runtime,
          ),
        );
        assert.equal(observed.payload.current.levelId, "complete");
      },
      { cacheDirectory, reports: { enabled: false }, sources: frozen },
    );
    console.log(
      JSON.stringify({
        objective: objective.digest,
        fixedCheck: bindings.get("value").digest,
        hostObservations: observations.length,
        executions: host.diagnostics().executions,
      }),
    );
  } finally {
    await host.close();
    https.closeAllConnections();
    await new Promise((resolve) => https.close(resolve));
    await closePrivateFileBackend();
  }
});
