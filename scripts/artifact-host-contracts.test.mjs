import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkerSchemaUri, objectiveSchemaUri } from "../packages/check-artifacts/dist/index.js";
import {
  writeContractArtifact,
  packContractArtifact,
} from "../packages/check-artifacts/dist/build.js";
import {
  CheckerMaterializer,
  CheckerService,
  CheckKernel,
  ContractStore,
} from "../packages/check-host/dist/index.js";
import { ObjectiveService } from "../packages/objective-host/dist/index.js";
import { bindObjectiveService, observe, readPage } from "../packages/objective-pilot/dist/index.js";
import { Effect } from "../packages/effects/dist/index.js";
import { makeRegulatorSpec, regulate } from "../packages/objective-regulator/dist/index.js";
import {
  CoordinatorModel as M,
  RequestModel as R,
  openCoordinatorStore,
} from "../packages/regulation-coordinator/dist/index.js";

test("new author archives feed Pilot/regulator and durable Coordinator without fabricating legacy identities", async () => {
  const directory = resolve(".cache", `artifact-contracts-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const archives = new Map();
  const store = new ContractStore(["https://example.test"], undefined, async (url) => {
    const bytes = archives.get(url);
    if (!bytes) throw new Error("Missing archive.");
    return bytes;
  });
  const kernel = await CheckKernel.create(join(directory, "snapshots"));
  const checks = new CheckerService(
    store,
    new CheckerMaterializer(join(directory, "capsules")),
    kernel,
    ["en"],
  );
  const service = new ObjectiveService(store, checks, ["en"]);
  try {
    const page = (title) => Buffer.from(`---\ntitle: ${title}\ndescription: Guidance\n---\nBody\n`);
    const checker = await writeContractArtifact(
      new Map([
        [
          "checker.yaml",
          Buffer.from(
            JSON.stringify({
              $schema: checkerSchemaUri,
              runtime: { type: "node", minVersion: "22.13.0" },
              entry: "checker.cjs",
              subjectSchema: { type: "object" },
              languages: ["en"],
              problems: [],
            }),
          ),
        ],
        [
          "checker.cjs",
          Buffer.from(
            "exports.execute=async()=>({status:200,message:'',payload:{ok:true,problems:[]}});",
          ),
        ],
        ["references/en/checker.md", page("Checker")],
      ]),
      join(directory, "checker"),
    );
    const checkerArchive = await packContractArtifact(
      checker.directory,
      join(directory, "checker.tgz"),
    );
    archives.set("https://example.test/checker/1.tgz", await readFile(checkerArchive.archive));
    const objective = await writeContractArtifact(
      new Map([
        [
          "objective.yaml",
          Buffer.from(
            JSON.stringify({
              $schema: objectiveSchemaUri,
              subjectSchema: { type: "object" },
              languages: ["en"],
              levels: [{ id: "ready", checks: ["pass"] }],
              checkers: {
                pass: {
                  url: "https://example.test/checker/1.tgz",
                  digest: checker.digest,
                  subjectMapping: "$",
                },
              },
            }),
          ),
        ],
        ["references/en/objective.md", page("Objective")],
        ["references/en/levels/ready.md", page("Ready")],
      ]),
      join(directory, "objective"),
    );
    const objectiveArchive = await packContractArtifact(
      objective.directory,
      join(directory, "objective.tgz"),
    );
    const url = "https://example.test/objective/1.tgz";
    archives.set(url, await readFile(objectiveArchive.archive));
    assert.notEqual(objective.digest, objectiveArchive.transportDigest);
    const { spec, runtime } = await bindObjectiveService(service, { url }, { scope: "test" });
    assert.equal(spec.objectiveId, `objective:${url}`);
    assert.equal(spec.source.kind, "artifact-service-v1");
    assert.equal(spec.source.digest, objective.digest);
    assert.equal(readPage(spec, "objective").id, "objective");
    assert.throws(() => readPage(spec, "system/404"), /reference_not_found/);
    const envelope = await Effect.runPromise(observe({ spec, subject: {} }, runtime));
    assert.equal(envelope.payload.current.levelId, "ready");
    assert.equal(
      envelope.payload.executionEvidence.checks[0].snapshot.evidence.runtime.version,
      process.versions.node,
    );
    const regulation = await Effect.runPromise(
      regulate(
        {
          spec: makeRegulatorSpec(
            spec,
            {
              targetLevel: "terminal",
              quota: { timeoutMs: 5000, maxAgentRuns: 1, maxStallRuns: 1 },
              agentExecutionLimits: { timeoutMs: 1000 },
            },
            { id: "unused-agent" },
          ),
          subject: {},
        },
        {
          pilot: runtime,
          executeAgent: () => {
            throw new Error("A satisfied Objective must not call an Agent.");
          },
        },
      ),
    );
    assert.equal(regulation.stopReason, "target-reached");
    const command = {
      type: "request",
      requestRef: "service-request",
      objective: spec,
      subject: {},
      desiredLevel: "terminal",
      priority: 1,
      origin: { kind: "external" },
    };
    const requests = R.reduceRegulationRequests(command, R.createRegulationRequests());
    assert.equal(requests.schemaVersion, 3);
    assert.deepEqual(requests.objectives[0].source, { url });
    assert.equal(requests.objectiveRevisions[0].artifactDigest, objective.digest);
    assert.deepEqual(R.restoreRegulationRequests(JSON.parse(JSON.stringify(requests))), requests);
    let state = M.reduceCoordinatorState(
      { revision: 1, occurredAt: "2026-10-28T00:00:00Z", fact: { type: "request", command } },
      M.createCoordinatorState("service-host"),
    );
    const binding = { id: "unused-agent" };
    const append = (fact) => {
      state = M.reduceCoordinatorState(
        { revision: state.revision + 1, occurredAt: new Date().toISOString(), fact },
        state,
      );
    };
    append({
      type: "resources",
      allocation: { kind: "configured", bindings: [{ binding, capacity: 1 }] },
    });
    append({
      type: "run-start",
      run: {
        id: "service-run",
        requestRef: "service-request",
        resourceRevision: 2,
        hostBindingRevisionId: M.bindingRevisionId("service-host", binding),
        limits: { timeoutMs: 5000, maxAgentRuns: 1, maxStallRuns: 1 },
      },
    });
    append({ type: "run-phase", runId: "service-run", phase: "running" });
    append({ type: "observation", runId: "service-run", observation: envelope });
    append({ type: "run-end", runId: "service-run", outcome: { kind: "target-reached" } });
    const directoryStore = join(directory, "coordinator");
    const durable = await openCoordinatorStore(directoryStore);
    try {
      await durable.save(state);
    } finally {
      await durable.close();
    }
    const restored = await openCoordinatorStore(directoryStore);
    try {
      const replay = await restored.load();
      assert.deepEqual(replay, state);
      assert.deepEqual(
        M.runViews(replay)[0].observation.executionEvidence,
        envelope.payload.executionEvidence,
      );
      const rebound = R.commandForRequest(replay.requests, "service-request");
      assert.equal(rebound.objective.source.digest, objective.digest);
      const recovered = await bindObjectiveService(
        service,
        { url },
        { scope: "test", source: rebound.objective.source },
      );
      assert.equal(recovered.spec.version, objective.digest);
      await assert.rejects(
        () =>
          bindObjectiveService(
            service,
            { url },
            {
              scope: "test",
              source: {
                ...rebound.objective.source,
                environment: { ...rebound.objective.source.environment, version: "999.0.0" },
              },
            },
          ),
        /environment/,
      );
    } finally {
      await restored.close();
    }
    await assert.rejects(() => store.artifact(objective.digest, "other-scope"), /authorized/);
    const alias = "https://example.test/another-location/1.tgz";
    archives.set(alias, archives.get(url));
    await store.resolve(
      { kind: "objective", url: alias },
      "other-scope",
      new AbortController().signal,
    );
    assert.equal((await store.artifact(objective.digest, "test")).metadata.source, url);
    assert.equal((await store.artifact(objective.digest, "other-scope")).metadata.source, alias);
    assert.equal(
      (
        await store.resolve(
          { kind: "objective", url, digest: objective.digest },
          "test",
          new AbortController().signal,
        )
      ).metadata.source,
      url,
    );
  } finally {
    await service.close();
    await checks.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
