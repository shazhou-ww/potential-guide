import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Fiber, Queue, Scope, Stream, SubscriptionRef } from "@potential-guide/effects";
import { regulationCoordinator } from "@potential-guide/regulation-coordinator";
import { createPortfolioCoordinator, createPortfolioPlanner } from "@potential-guide/objective-portfolio-supervisor";

const totals = {
  starts: 0, terminated: 0, aborts: 0, kills: 0,
  acquisitions: 0, releases: 0, scopesOpened: 0, scopesClosed: 0,
  subscriptionsOpened: 0, subscriptionsClosed: 0,
};
const cases = [];
const read = (ref) => Effect.runPromise(SubscriptionRef.get(ref));
const pause = () => new Promise((resolve) => setTimeout(resolve, 2));
async function until(predicate) {
  const deadline = Date.now() + 4000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, "Timed out waiting for packed consumer fact");
    await pause();
  }
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function spec(id) {
  const version = "1".repeat(40);
  return {
    objectiveId: `git+https://example.test/deployment.git#${id}/`, version,
    source: {
      kind: "git-tree", repository: "https://example.test/deployment.git",
      directory: id, commit: "2".repeat(40), tree: version, repositoryTree: "3".repeat(40),
    },
    manifest: {
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json",
      subjectSchema: { type: "object", additionalProperties: false },
      levels: ["initial", "l1", "l2", "l3"].map((id) => ({ id, checks: [] })),
      defaultLanguage: "en", languages: ["en"],
    },
    locales: { en: { "system/404": { id: "system/404", title: "Missing", description: "", references: [], content: "" } } },
  };
}
const resource = { id: "fixture", binding: { id: "fixture" }, capacity: 3, capabilities: [] };
const regulation = (id) => ({ id, objective: spec(id), subject: {}, targetLevel: "l1", priority: 2 });
function observation(objective, levelId = "l1", providers = []) {
  const all = [objective, ...providers.map(({ objective }) => objective)];
  return {
    status: 200, message: "",
    payload: {
      current: { objectiveId: objective.objectiveId, levelId },
      problems: providers.map(({ objective, minimum }) => ({
        kind: "dependency", objectiveId: objective.objectiveId, subject: {},
        currentLevelId: "initial", expectedLevelId: minimum,
      })),
      gapSummary: "", observedAt: new Date().toISOString(),
      versions: Object.fromEntries(all.map((p) => [p.objectiveId, p.version])),
      sources: Object.fromEntries(all.map((p) => [p.objectiveId, p.source])),
    },
  };
}
function outcome(objective) {
  return { stopReason: "target-reached", iterations: 0, stalledRuns: 0, latestObservation: observation(objective) };
}
function handoff(objective, provider, minimum) {
  const latestObservation = observation(objective, "initial", [{ objective: provider, minimum }]);
  return {
    stopReason: "dependency-required", iterations: 0, stalledRuns: 0,
    dependencies: latestObservation.payload.problems, latestObservation,
  };
}

async function harness({ finite, resources: initial = [resource], budget, resolveGate } = {}) {
  const scope = Effect.runSync(Scope.make());
  totals.scopesOpened++;
  const commands = Effect.runSync(Queue.bounded(16));
  const resources = Effect.runSync(SubscriptionRef.make(initial));
  const ready = deferred();
  const runs = [], facts = [], subscriptions = [];
  let resolutionCalls = 0, closed = false;
  const options = {
    maxConcurrency: 3, abortGraceMs: 5, bufferSize: 2,
    permissions: { ceiling: [], grants: [] },
    quota: { timeoutMs: 100, maxAgentRuns: 1, maxStallRuns: 1 },
    agentExecutionLimits: { timeoutMs: 100 },
    budget: budget ?? { maxStarts: 20, maxAgentRuns: 20, maxDurationMs: 2000 },
    runner: {
      start(input, selectedResource, execution) {
        const result = deferred(), killed = deferred();
        const run = { input, selectedResource, execution, result, killed, aborts: 0, kills: 0, ended: false };
        runs.push(run);
        totals.starts++;
        const ended = () => { if (!run.ended) { run.ended = true; totals.terminated++; } };
        return {
          result: result.promise.finally(ended),
          abort() { run.aborts++; totals.aborts++; },
          async kill() { run.kills++; totals.kills++; await killed.promise; ended(); },
        };
      },
    },
    async resolveObjective(id, version, source, signal) {
      resolutionCalls++;
      if (resolveGate) await resolveGate.promise;
      assert.equal(signal.aborted, false);
      const provider = spec("provider");
      assert.equal(id, provider.objectiveId);
      assert.equal(version, provider.version);
      assert.deepEqual(source, provider.source);
      totals.acquisitions++;
      return { spec: provider, async release() { totals.releases++; } };
    },
  };
  const service = await Effect.runPromise(regulationCoordinator(
    resources,
    Stream.unwrap(Effect.promise(async () => {
      await ready.promise;
      return finite ?? Stream.fromQueue(commands);
    })),
    options,
  ).pipe(Scope.provide(scope)));
  function subscribe(target = facts) {
    totals.subscriptionsOpened++;
    const fiber = Effect.runFork(service.events.pipe(
      Stream.runForEach((fact) => Effect.sync(() => { target.push(fact); })),
      Effect.ensuring(Effect.sync(() => { totals.subscriptionsClosed++; })),
    ));
    subscriptions.push(fiber);
    return fiber;
  }
  subscribe();
  await pause();
  ready.resolve();
  const send = async (command) => {
    const before = facts.length;
    await Effect.runPromise(Queue.offer(commands, command));
    await until(() => facts.slice(before).some((fact) =>
      ["accepted", "rejected"].includes(fact.type) && fact.commandId === command.commandId));
  };
  const add = (value) => send({ type: "add", commandId: `add:${value.id}`, regulation: value });
  const setResources = async (value) => {
    const before = facts.length;
    await Effect.runPromise(SubscriptionRef.set(resources, value));
    await until(() => facts.slice(before).some((fact) =>
      fact.type === "resources-accepted" || (fact.type === "failure" && fact.stage === "resources")));
  };
  return {
    service, facts, runs, scope, options, subscribe, send, add, setResources,
    get resolutionCalls() { return resolutionCalls; },
    async close() {
      if (closed) return;
      closed = true;
      for (const run of runs) run.killed.resolve();
      await Effect.runPromise(Scope.close(scope, Exit.void));
      totals.scopesClosed++;
      for (const subscription of subscriptions) await Effect.runPromise(Fiber.interrupt(subscription));
      await Effect.runPromise(Queue.shutdown(commands));
      assert.ok(runs.every((run) => run.ended), "All fake executions must have termination confirmation");
    },
  };
}

test("finite commands remain resident, two public subscriptions share one scheduler", async () => {
  const root = regulation("finite");
  const h = await harness({ resources: [], finite: Stream.make({ type: "add", commandId: "finite", regulation: root }) });
  const second = [];
  h.subscribe(second);
  try {
    await until(() => h.facts.some((fact) => fact.type === "input-ended"));
    assert.equal(h.runs.length, 0);
    await h.setResources([resource]);
    await until(() => h.runs.length === 1);
    h.runs[0].result.resolve(outcome(root.objective));
    await until(() => second.some((fact) => fact.type === "result"));
    assert.equal(h.runs.length, 1);
    assert.deepEqual(h.facts.filter((fact) => fact.type === "result"), second.filter((fact) => fact.type === "result"));
    await h.setResources([]);
    assert.ok(h.facts.every((fact, index, all) => index === 0 || fact.sequence > all[index - 1].sequence));
    cases.push({ name: "residency-multicast", starts: 1, commandEndedBeforeResource: true });
  } finally { await h.close(); }
});

test("invalid requests/resources and execution failure recover; idle service accepts new work", async () => {
  const h = await harness();
  try {
    await h.send({ type: "add", commandId: "injection", regulation: { ...regulation("bad"), permissions: {} } });
    assert.ok(h.facts.some((fact) => fact.type === "rejected"));
    await h.add(regulation("failed"));
    await until(() => h.runs.length === 1);
    h.runs[0].result.reject(new Error("deterministic worker failure"));
    await until(() => h.facts.some((fact) => fact.type === "failure" && fact.stage === "execution"));
    await h.setResources([{ ...resource, capacity: 0 }]);
    await h.add(regulation("recovered"));
    assert.equal(h.runs.length, 1);
    await h.setResources([resource]);
    await until(() => h.runs.length === 2);
    h.runs[1].result.resolve(outcome(spec("recovered")));
    await until(() => h.facts.some((fact) => fact.type === "result" && fact.work.id === "recovered"));
    await h.add(regulation("after-idle"));
    await until(() => h.runs.length === 3);
    h.runs[2].result.resolve(outcome(spec("after-idle")));
    await until(() => h.facts.some((fact) => fact.type === "result" && fact.work.id === "after-idle"));
    cases.push({ name: "failure-recovery-idle", commandRejected: true, executionFailure: true, resourceRecovery: true });
  } finally { await h.close(); }
});

test("one shared provider releases independent minima and is reclaimed only after last reference and termination", async () => {
  const gate = deferred();
  const h = await harness({ resolveGate: gate });
  const p = spec("provider");
  const before = { acquisitions: totals.acquisitions, releases: totals.releases };
  try {
    await h.add(regulation("low"));
    await h.add(regulation("high"));
    await until(() => h.runs.length === 2);
    h.runs[0].result.resolve(handoff(spec("low"), p, "l1"));
    h.runs[1].result.resolve(handoff(spec("high"), p, "l3"));
    await until(() => h.resolutionCalls === 2);
    await h.setResources([]);
    gate.resolve();
    await until(() => h.facts.filter((fact) => fact.type === "dependencies").length === 2);
    await h.setResources([resource]);
    await until(() => h.runs.length === 3);
    const provider = h.runs[2];
    assert.equal(provider.input.spec.strategy.targetLevel, "l3");
    const invalid = observation(p, "l3");
    invalid.payload.sources[p.objectiveId] = { ...p.source, commit: "f".repeat(40) };
    await provider.execution.report({ type: "observation", observation: invalid });
    await until(() => h.facts.some((fact) => fact.type === "failure" && fact.stage === "feedback"));
    assert.equal(h.runs.length, 3);
    await provider.execution.report({ type: "observation", observation: observation(p, "l1") });
    await until(() => h.runs.length === 4);
    assert.equal(h.runs[3].input.spec.objective.objectiveId, spec("low").objectiveId);
    assert.equal(h.facts.filter((fact) => fact.type === "started" && fact.work.id === "high").length, 1);
    await h.send({ type: "cancel", commandId: "cancel-low", id: "low", generation: 1 });
    assert.equal(provider.aborts, 0, "High consumer retains the shared provider");
    h.runs[3].killed.resolve();
    await provider.execution.report({ type: "observation", observation: observation(p, "l3") });
    await until(() => h.runs.length === 5);
    assert.equal(h.runs[4].input.spec.objective.objectiveId, spec("high").objectiveId);
    h.runs[4].result.resolve(outcome(spec("high")));
    await until(() => provider.kills === 1);
    assert.equal(totals.acquisitions - before.acquisitions, 2);
    assert.equal(totals.releases - before.releases, 1, "Retained provider lease still owned while stopping");
    provider.killed.resolve();
    await until(() => h.facts.some((fact) => fact.type === "reclaimed" && fact.work.id.startsWith("$dependency:")));
    assert.equal(totals.releases - before.releases, 2);
    cases.push({ name: "minimum-sharing-reclamation", minima: ["l1", "l3"], sharedProviderStarts: 1, acquisitions: 2, releases: 2 });
  } finally { gate.resolve(); await h.close(); }
});

test("cancel keeps stopping slot until explicit kill confirmation", async () => {
  const h = await harness({ resources: [{ ...resource, capacity: 1 }] });
  try {
    await h.add(regulation("cancelled"));
    await until(() => h.runs.length === 1);
    await h.send({ type: "cancel", commandId: "cancel", id: "cancelled", generation: 1 });
    await until(() => h.runs[0].kills === 1);
    await h.add(regulation("next"));
    assert.equal(h.runs.length, 1);
    assert.ok(!h.facts.some((fact) => fact.type === "terminated"));
    h.runs[0].killed.resolve();
    await until(() => h.runs.length === 2);
    h.runs[1].result.resolve(outcome(spec("next")));
    await until(() => h.facts.some((fact) => fact.type === "result" && fact.work.id === "next"));
    cases.push({ name: "cancel-confirmation", startsBeforeConfirmation: 1, startsAfterConfirmation: 2 });
  } finally { await h.close(); }
});

test("trusted finite budget cannot be renewed by new work", async () => {
  const h = await harness({ budget: { maxStarts: 1, maxAgentRuns: 1, maxDurationMs: 100 } });
  try {
    await h.add(regulation("budget-first"));
    await until(() => h.runs.length === 1);
    h.runs[0].result.resolve(outcome(spec("budget-first")));
    await until(() => h.facts.some((fact) => fact.type === "result"));
    await h.add(regulation("budget-second"));
    await until(() => h.facts.some((fact) => fact.type === "blocked" && fact.reason === "trusted-budget-exhausted"));
    await h.send({ type: "retry", commandId: "budget-retry", id: "budget-second", generation: 1 });
    await h.send({ type: "replace", commandId: "budget-replace", generation: 1, regulation: regulation("budget-first") });
    await until(() => h.facts.some((fact) => fact.type === "blocked" && fact.work.id === "budget-first" && fact.work.generation === 2));
    assert.equal(h.runs.length, 1);
    cases.push({ name: "budget", maxStarts: 1, actualStarts: 1, retryAndReplacementDoNotRenew: true });
  } finally { await h.close(); }
});

test("same Effect scope interrupts a slow subscriber before service finalization", async () => {
  const order = [];
  const started = deferred();
  const h = await harness();
  await h.close();
  let reader, forced = false;
  const watchdog = setTimeout(() => {
    forced = true;
    if (reader) Effect.runFork(Fiber.interrupt(reader));
  }, 3000);
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      totals.scopesOpened++;
      yield* Effect.addFinalizer(() => Effect.sync(() => { totals.scopesClosed++; }));
      const resources = yield* SubscriptionRef.make([resource]);
      const commands = yield* Queue.bounded(8);
      const service = yield* regulationCoordinator(resources, Stream.fromQueue(commands), {
        ...h.options, maxConcurrency: 1, bufferSize: 1,
        runner: { start() {
          totals.starts++;
          return {
            result: new Promise(() => {}),
            abort() { totals.aborts++; order.push("abort"); },
            async kill() { totals.kills++; totals.terminated++; order.push("kill-confirmed"); },
          };
        } },
      });
      totals.subscriptionsOpened++;
      reader = yield* service.events.pipe(
        Stream.runForEach((fact) => fact.type === "started"
          ? Effect.sync(() => started.resolve()).pipe(Effect.andThen(Effect.never))
          : Effect.void),
        Effect.ensuring(Effect.sync(() => { totals.subscriptionsClosed++; order.push("subscriber-released"); })),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* Queue.offer(commands, { type: "add", commandId: "scoped", regulation: regulation("scoped") });
      yield* Effect.promise(() => started.promise);
      for (let i = 0; i < 4; i++)
        yield* Queue.offer(commands, { type: "add", commandId: `pending:${i}`, regulation: regulation(`pending-${i}`) });
      yield* Effect.sleep("10 millis");
    })));
    assert.equal(forced, false);
    assert.deepEqual(order, ["subscriber-released", "abort", "kill-confirmed"]);
    cases.push({ name: "same-scope-cleanup", order, forcedInterruption: false });
  } finally { clearTimeout(watchdog); }
});

test("legacy Planner and Coordinator compose through the same installed package boundary", async () => {
  const objective = spec("legacy");
  const goal = { ...regulation("legacy"), objective, observationIntervalMs: 10000 };
  const planner = await createPortfolioPlanner({
    goals: [goal], periodic: false,
    observe: async () => observation(objective, "initial"),
  });
  let coordinator, starts = 0, plannerClosed = false, coordinatorClosed = false;
  const events = [];
  try {
    const resources = Effect.runSync(SubscriptionRef.make([resource]));
    coordinator = await createPortfolioCoordinator({
      queue: planner.queue, resources, maxConcurrency: 1,
      quota: { timeoutMs: 100, maxAgentRuns: 1, maxStallRuns: 1 },
      agentExecutionLimits: { timeoutMs: 100 }, abortGraceMs: 5,
      runner: { start() {
        starts++;
        return { result: Promise.resolve(outcome(objective)), abort() {}, async kill() {} };
      } },
      async onEvent(event) { events.push(event); await planner.feedback(event); },
    });
    await until(async () => events.some((event) => event.type === "result") &&
      (await read(planner.queue)).demands.length === 0 &&
      (await read(coordinator.state)).runs.length === 0);
    assert.equal(starts, 1);
    assert.equal((await read(coordinator.state)).runs.length, 0);
  } finally {
    if (coordinator) { await coordinator.close(); coordinatorClosed = true; }
    await planner.close(); plannerClosed = true;
  }
  cases.push({ name: "legacy-supervisor", starts, plannerClosed, coordinatorClosed });
});

after(async () => {
  const resolvedEntrypoints = [];
  for (const name of ["@potential-guide/effects", "@potential-guide/regulation-coordinator", "@potential-guide/objective-portfolio-supervisor"]) {
    const path = fileURLToPath(import.meta.resolve(name));
    const location = relative(process.cwd(), path);
    assert.ok(!isAbsolute(location) && location !== ".." && !location.startsWith(`..${sep}`));
    assert.ok(!location.split(sep).includes("src"), "Consumer must resolve packed dist, not workspace source");
    resolvedEntrypoints.push({ name, path: location, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
  }
  assert.equal(totals.starts, totals.terminated);
  assert.equal(totals.acquisitions, totals.releases);
  assert.equal(totals.scopesOpened, totals.scopesClosed);
  assert.equal(totals.subscriptionsOpened, totals.subscriptionsClosed);
  assert.equal(cases.length, 7);
  await writeFile("runtime-evidence.json", `${JSON.stringify({
    runnerKind: "deterministic-in-process", realAgentProcessIntegration: false,
    cases, totals, resolvedEntrypoints, activeExecutions: totals.starts - totals.terminated,
  }, null, 2)}\n`);
});
