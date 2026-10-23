import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Stream, SubscriptionRef } from "@potential-guide/effects";
import {
  coordinator,
  coordinatorViews,
  CoordinatorModel as M,
  openCoordinatorStore,
  regulationCoordinator,
  RequestModel as R,
} from "@potential-guide/regulation-coordinator";

const [phase, profile] = process.argv.slice(2);
assert.ok(["first", "resume", "unknown"].includes(phase));
assert.ok(profile);
const resolutions = {};
for (const name of ["@potential-guide/effects", "@potential-guide/regulation-coordinator"]) {
  const location = relative(process.cwd(), await realpath(fileURLToPath(import.meta.resolve(name))));
  assert.ok(!isAbsolute(location) && !location.startsWith(".."), `${name} escaped consumer`);
  resolutions[name] = location;
}
const source = {
  kind: "git-tree", repository: "https://example.test/consumer.git", directory: "rules",
  commit: "a".repeat(40), tree: "b".repeat(40), repositoryTree: "c".repeat(40),
};
const spec = {
  objectiveId: "git+https://example.test/consumer.git#rules/", version: source.tree, source,
  manifest: {
    $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
    subjectSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    levels: [{ id: "ready", checks: [] }], languages: ["en"], defaultLanguage: "en",
  },
  locales: { en: { "system/404": { id: "system/404", title: "Missing", description: "", content: "", references: [] } } },
};
const request = (ref, name, desiredLevel = "ready") => ({
  type: "request", requestRef: ref, objective: spec, subject: { name }, desiredLevel, priority: 0, origin: { kind: "external" },
});
const limits = { timeoutMs: 5000, maxAgentRuns: 1, maxStallRuns: 1 };
const allocation = {
  kind: "configured", bindings: [{ binding: { id: "fixture", configuration: { identity: "local-test-only" } }, capacity: 1 }],
};
let input = R.createRegulationRequests();
input = R.reduceRegulationRequests(request("initial", "initial", "initial"), input);
input = R.reduceRegulationRequests(request("work", "work"), input);
input = R.reduceRegulationRequests(request("denied", "denied"), input);
const store = await openCoordinatorStore(profile);
const before = await store.load();
if (phase === "unknown") {
  assert.equal(before, null);
  let seed = M.createCoordinatorState("consumer-host");
  const append = (fact) => {
    seed = M.reduceCoordinatorState({ revision: seed.revision + 1, occurredAt: new Date().toISOString(), fact }, seed);
  };
  append({ type: "request", command: request("work", "work") });
  append({ type: "resources", allocation });
  append({
    type: "run-start",
    run: {
      id: "unverified-fixture", requestRef: "work", resourceRevision: 2,
      hostBindingRevisionId: M.bindingRevisionId("consumer-host", allocation.bindings[0].binding), limits,
    },
  });
  append({ type: "run-phase", runId: "unverified-fixture", phase: "running" });
  await store.save(seed);
  input = R.reduceRegulationRequests(request("work", "work"), R.createRegulationRequests());
}
let starts = 0;
let childStarts = 0;
let childExits = 0;
let recoveries = 0;
const errors = [];
const live = new Set();
let final;
async function until(check) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Consumer did not reach expected state.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const resources = yield* SubscriptionRef.make(phase === "first" ? { kind: "no-resource" } : allocation);
  const requests = yield* SubscriptionRef.make(input);
  const service = yield* coordinator(resources, requests, {
    hostId: "consumer-host", store, limits, maxAttemptsPerRequest: 2, maxDependencyRequests: 4, abortGraceMs: 100,
    onError: (error) => errors.push(String(error)),
    runner: {
      start(context) {
        starts++;
        if (context.run.requestRef === "denied") throw new Error("EACCES: fixture resource denied.");
        assert.equal(phase, "first", "Restore attempted to repeat execution.");
        const child = spawn(process.execPath, ["-e", "process.stdout.write('completed')"], { stdio: ["ignore", "pipe", "pipe"] });
        live.add(child);
        childStarts++;
        const exit = new Promise((resolve, reject) => {
          let output = "";
          child.stdout.on("data", (data) => { output += data; });
          child.stderr.resume();
          child.once("error", reject);
          child.once("close", (code) => {
            live.delete(child);
            childExits++;
            if (code !== 0) reject(new Error(`Child exited ${code}`));
            else { assert.equal(output, "completed"); resolve(); }
          });
        });
        const result = exit.then(() => ({
          outcome: { kind: "target-reached" },
          observation: {
            status: 200, message: "", payload: {
              current: { objectiveId: spec.objectiveId, levelId: "ready" },
              observedAt: new Date().toISOString(), problems: [], gapSummary: "",
              versions: { [spec.objectiveId]: spec.version }, sources: { [spec.objectiveId]: source },
            },
          },
        }));
        return {
          result,
          abort: async () => { child.kill(); },
          kill: async () => { child.kill(); await exit; },
        };
      },
      recover: async () => { recoveries++; return { kind: "unknown" }; },
    },
  });
  if (phase === "first") {
    assert.equal(starts, 0);
    assert.ok(M.requestClosed(service.snapshot(), "initial"));
    yield* SubscriptionRef.set(resources, allocation);
  }
  yield* Effect.promise(async () => {
    if (phase === "unknown") {
      assert.equal(starts, 0);
      assert.equal(recoveries, 1);
      assert.equal(M.runViews(service.snapshot())[0].phase, "unverified");
      assert.equal(coordinatorViews([service.snapshot()]).hosts[0].occupancy, 1);
    } else {
      await until(() => M.requestClosed(service.snapshot(), "work") && M.requestClosed(service.snapshot(), "denied"));
      await service.flush();
      assert.equal(M.runViews(service.snapshot()).length, 2);
      assert.equal(M.runViews(service.snapshot()).find(({ run }) => run.requestRef === "work").outcome.kind, "target-reached");
      assert.equal(M.runViews(service.snapshot()).find(({ run }) => run.requestRef === "denied").outcome.kind, "error");
      assert.equal(coordinatorViews([service.snapshot()]).hosts[0].occupancy, 0);
    }
    final = service.snapshot();
    assert.deepEqual(M.restoreCoordinatorState(JSON.parse(JSON.stringify(final))), final);
    assert.deepEqual(coordinatorViews([M.restoreCoordinatorState(final)]), coordinatorViews([final]));
    assert.ok(coordinatorViews([final]).requests.every(({ satisfaction }) => satisfaction === "undetermined"));
  });
})));
assert.equal(live.size, 0);
await assert.rejects(store.load(), /closed/);
if (phase === "first") {
  assert.equal(starts, 2);
  assert.equal(childStarts, 1);
  assert.equal(childExits, 1);
  assert.equal(recoveries, 0);
  assert.ok(errors.some((error) => error.includes("EACCES")));
} else if (phase === "resume") {
  assert.ok(before);
  assert.equal(starts, 0);
  assert.equal(recoveries, 0);
  assert.deepEqual(final, before);
}
await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const resources = yield* SubscriptionRef.make([]);
  yield* regulationCoordinator(resources, Stream.empty, {
    maxConcurrency: 1, abortGraceMs: 10,
    budget: { maxStarts: 1, maxAgentRuns: 1, maxDurationMs: 1000 },
    quota: { timeoutMs: 1000, maxAgentRuns: 1, maxStallRuns: 1 },
    agentExecutionLimits: { timeoutMs: 1000 }, permissions: { ceiling: [], grants: [] },
    runner: { start: () => { throw new Error("Legacy idle smoke unexpectedly started."); } },
    resolveObjective: async () => { throw new Error("Legacy idle smoke unexpectedly resolved."); },
  });
})));
console.log(JSON.stringify({
  phase, starts, childStarts, childExits, recoveries, errors,
  revision: final.revision, runCount: M.runViews(final).length,
  occupied: coordinatorViews([final]).hosts[0].occupancy,
  legacyScopeClosed: true, storeClosed: true, resolutions,
}));
