import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { withPilot } from "../packages/cli-runtime/dist/index.js";
import { buildExample } from "../packages/cli-runtime/examples/objective-artifact/build.mjs";
import { Effect, SubscriptionRef } from "../packages/effects/dist/index.js";
import { observe } from "../packages/objective-pilot/dist/index.js";
import {
  CoordinatorModel as M,
  RequestModel as R,
  openCoordinatorStore,
  coordinator,
} from "../packages/regulation-coordinator/dist/index.js";
import { createWorkerHost } from "./worker-test-helpers.mjs";

const root = resolve(import.meta.dirname, "..");
const execute = promisify(execFile);
test("public declaration, probe, guidance, regulation/continue and durable Coordinator replay consume the same Objective closure", async () => {
  const scratch = join(root, ".cache", "objective-public-tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "case-"));
  const host = await createWorkerHost(join(directory, "host"));
  const cliEnvironment = {
    ...process.env,
    APPDATA: join(directory, "user-config"),
    XDG_CONFIG_HOME: join(directory, "user-config"),
    HOME: join(directory, "user-home"),
  };
  try {
    const artifact = await buildExample(join(directory, "delivery"));
    const stateDirectory = join(directory, "state");
    await mkdir(join(directory, ".pguide"));
    await writeFile(
      join(directory, ".pguide", "config.jsonc"),
      JSON.stringify({
        "cli-core.stateDirectory": stateDirectory,
        "agents.defaultAgent": "never",
        "pilot.reportsEnabled": false,
      }),
    );
    await writeFile(
      join(directory, ".pguide", "agents.yaml"),
      JSON.stringify({
        $schema: "https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json",
        agents: {
          never: {
            type: "acp",
            connection: { protocolVersion: "1" },
            transport: {
              type: "stdio",
              command: process.execPath,
              args: ["-e", "throw Error('Pilot must not call Agent')"],
            },
          },
        },
      }),
    );
    const input = join(directory, "input.json");
    await writeFile(input, JSON.stringify({ first: true, second: false, dependencyReady: true }));
    await writeFile(
      join(directory, "objectives.yaml"),
      JSON.stringify({
        $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json",
        objectives: {
          composition: {
            description: "Exact composite",
            objective: artifact.location,
            subject: "input",
            inputSchema: { type: "object" },
          },
        },
      }),
    );
    async function cli(command, args) {
      const workspace =
        command === "regulate" || command === "continue" ? "pguide-regulate" : "pguide-pilot";
      const { stdout } = await execute(
        process.execPath,
        [
          join(root, "packages", workspace, "dist", "bin", `${command}.js`),
          ...args,
          "--cwd",
          directory,
          "--format",
          "json",
        ],
        {
          cwd: root,
          windowsHide: true,
          timeout: 30_000,
          env: cliEnvironment,
        },
      );
      return JSON.parse(stdout);
    }
    const validated = await cli("validate", ["artifact", artifact.directory]);
    assert.equal(validated.artifactDigest, artifact.digest);
    const observed = await cli("probe", [
      "--objective",
      "composition",
      "--scope",
      "directory",
      "--input-file",
      input,
    ]);
    assert.equal(observed.payload.current.levelId, "ready");
    assert.equal(observed.payload.problems[0].ref.checkId, "second");
    assert.equal(
      observed.payload.sources["objective:composition"].checks.first.digest,
      observed.payload.sources["objective:composition"].checks.second.digest,
    );
    const markdown = await execute(
      process.execPath,
      [
        join(root, "packages", "pguide-pilot", "dist", "bin", "probe.js"),
        "--pilot",
        artifact.directory,
        "--revision",
        artifact.digest,
        "--subject-file",
        input,
        "--cwd",
        directory,
        "--language",
        "zh-CN",
        "--format",
        "markdown",
      ],
      { cwd: root, env: cliEnvironment, timeout: 30_000, windowsHide: true },
    );
    assert.match(markdown.stdout, /第二输入场景/);
    assert.match(markdown.stdout, /levels\/complete\/checks\/second\/problems\/not-ready/);
    await writeFile(input, JSON.stringify({ first: true, second: true, dependencyReady: true }));
    const result = await cli("regulate", [
      "--pilot",
      artifact.location,
      "--subject-file",
      input,
      "--target",
      "terminal",
    ]);
    assert.equal(result.status, "target-reached");
    assert.equal(result.outcome.iterations, 0);
    assert.equal(result.outcome.latestObservation.payload.current.levelId, "complete");
    const record = JSON.parse(
      await readFile(
        join(stateDirectory, "regulations", result.regulationId, "regulation.json"),
        "utf8",
      ),
    );
    assert.equal(record.schemaVersion, 6);
    assert.equal(record.objectiveArtifactDigest, artifact.digest);
    assert.equal(record.objectiveCommit, undefined);
    assert.equal(record.objectivePackageDigest, undefined);
    assert.equal(Object.keys(record.sourceBindings).length, 2);

    await withPilot(
      "objective:composition",
      directory,
      undefined,
      async (spec) => {
        const command = {
          type: "request",
          requestRef: "timed-artifact",
          objective: spec,
          subject: { first: true, second: true, dependencyReady: true },
          desiredLevel: "terminal",
          priority: 1,
          origin: { kind: "external" },
          eligibleAt: "2026-10-28T00:00:00Z",
          recurrence: { intervalMs: 1000 },
        };
        const requestState = R.reduceRegulationRequests(command, R.createRegulationRequests());
        assert.equal(requestState.schemaVersion, 2);
        assert.equal(requestState.objectives[0].source.objectiveId, spec.objectiveId);
        assert.equal(requestState.objectiveRevisions[0].artifactDigest, artifact.digest);
        assert.equal(requestState.objectiveRevisions[0].commit, undefined);
        assert.equal(requestState.objectiveRevisions[0].packageDigest, undefined);
        const persistedPage = requestState.objectiveRevisions[0].spec.locales.en["checks/first"];
        assert.deepEqual(persistedPage.origin, spec.locales.en["checks/first"].origin);
        assert.equal(persistedPage.resourceBase, undefined);
        await withPilot(
          "objective:composition",
          directory,
          undefined,
          async (relocated) => {
            assert.notEqual(
              relocated.locales.en["checks/first"].resourceBase,
              spec.locales.en["checks/first"].resourceBase,
            );
            const admitted = R.reduceRegulationRequests(
              {
                ...command,
                requestRef: "same-content-another-cache",
                objective: relocated,
              },
              requestState,
            );
            assert.equal(admitted.objectiveRevisions.length, 1);
            assert.equal(admitted.targets.length, 1);
          },
          {
            sources: record.sourceBindings,
            cacheDirectory: join(directory, "relocated-cache"),
            reports: { enabled: false },
          },
        );
        assert.deepEqual(
          R.restoreRegulationRequests(JSON.parse(JSON.stringify(requestState))),
          requestState,
        );
        const event = {
          revision: 1,
          occurredAt: "2026-10-27T00:00:00Z",
          fact: { type: "request", command },
        };
        const modelState = M.reduceCoordinatorState(
          event,
          M.createCoordinatorState("artifact-host"),
        );
        assert.equal(
          M.requestSchedule(modelState, "timed-artifact", "2026-10-27T00:00:00Z"),
          "ineligible",
        );
        assert.equal(
          M.requestSchedule(modelState, "timed-artifact", "2026-10-28T00:00:00Z"),
          "eligible",
        );
        assert.deepEqual(
          M.restoreCoordinatorState(JSON.parse(JSON.stringify(modelState))),
          modelState,
        );
        const storeDirectory = join(directory, "coordinator");
        const store = await openCoordinatorStore(storeDirectory);
        try {
          await store.save(modelState);
        } finally {
          await store.close();
        }
        const restored = await openCoordinatorStore(storeDirectory);
        try {
          const snapshot = await restored.load();
          assert.deepEqual(snapshot, modelState);
          const rebound = R.commandForRequest(snapshot.requests, "timed-artifact");
          assert.equal(rebound.objective.source.artifactDigest, artifact.digest);
          assert.deepEqual(rebound.objective.source.checks, spec.source.checks);
        } finally {
          await restored.close();
        }
        const scheduledDirectory = join(directory, "scheduled-coordinator");
        const errors = [];
        const { recurrence: _recurrence, ...oneShot } = command;
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const resources = yield* SubscriptionRef.make({
                kind: "configured",
                bindings: [{ binding: { id: "observe-only" }, capacity: 1 }],
              });
              const requests = yield* SubscriptionRef.make(
                R.reduceRegulationRequests(
                  {
                    ...oneShot,
                    requestRef: "scheduled-artifact",
                    eligibleAt: "2026-01-01T00:00:00Z",
                  },
                  R.createRegulationRequests(),
                ),
              );
              const store = yield* Effect.promise(() => openCoordinatorStore(scheduledDirectory));
              const service = yield* coordinator(resources, requests, {
                hostId: "scheduled-artifact-host",
                store,
                limits: { timeoutMs: 10_000, maxAgentRuns: 1, maxStallRuns: 1 },
                maxAttemptsPerRequest: 1,
                maxDependencyRequests: 4,
                abortGraceMs: 100,
                onError: (error) => errors.push(error),
                runner: {
                  start(context) {
                    const controller = new AbortController();
                    const objective = context.details.objectiveRevision.spec;
                    const result = withPilot(
                      objective.objectiveId,
                      directory,
                      undefined,
                      async (bound, runtime) => ({
                        observation: await Effect.runPromise(
                          observe(
                            {
                              spec: bound,
                              subject: context.details.target.subject,
                            },
                            runtime,
                          ),
                        ),
                        outcome: { kind: "target-reached" },
                      }),
                      {
                        sources: record.sourceBindings,
                        signal: controller.signal,
                        reports: { enabled: false },
                      },
                    );
                    return {
                      result,
                      abort: async () => controller.abort(),
                      kill: async () => {
                        controller.abort();
                        await result.catch(() => {});
                      },
                    };
                  },
                  recover: async () => ({ kind: "unknown" }),
                },
              });
              yield* Effect.promise(async () => {
                const deadline = Date.now() + 10_000;
                while (!M.runViews(service.snapshot()).some((view) => view.phase === "ended")) {
                  if (Date.now() > deadline) assert.fail("Artifact scheduler did not finish.");
                  await new Promise((resolve) => setTimeout(resolve, 10));
                }
                await service.flush();
                const view = M.runViews(service.snapshot())[0];
                assert.equal(view.outcome.kind, "target-reached");
                assert.equal(view.observation.current.levelId, "complete");
                assert.equal(
                  view.observation.sources["objective:composition"].artifactDigest,
                  artifact.digest,
                );
              });
            }),
          ),
        );
        assert.deepEqual(errors, []);
        const scheduledStore = await openCoordinatorStore(scheduledDirectory);
        try {
          const replayed = await scheduledStore.load();
          assert.equal(M.runViews(replayed)[0].outcome.kind, "target-reached");
          assert.equal(
            R.commandForRequest(replayed.requests, "scheduled-artifact").objective.source
              .artifactDigest,
            artifact.digest,
          );
        } finally {
          await scheduledStore.close();
        }
      },
      { sources: record.sourceBindings, reports: { enabled: false } },
    );

    await rm(join(directory, "delivery"), { recursive: true, force: true });
    const resumed = await cli("continue", [result.regulationId]);
    assert.equal(resumed.status, "target-reached");
    assert.equal(
      resumed.outcome.latestObservation.payload.sources["objective:composition"].artifactDigest,
      artifact.digest,
    );
    assert.deepEqual(
      resumed.outcome.latestObservation.payload.sources["objective:composition"].checks,
      record.objectiveSource.checks,
    );
    assert.equal(resumed.outcome.latestObservation.payload.current.levelId, "complete");
  } finally {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
