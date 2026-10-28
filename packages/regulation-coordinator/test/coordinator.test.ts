import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Effect,
  Exit,
  Fiber,
  Queue,
  Scope,
  Stream,
  SubscriptionRef,
} from "@potential-guide/effects";
import type {
  DependencyProblem,
  GitObjectiveSource,
  PilotSpec,
} from "@potential-guide/objective-pilot";
import type { RegulationInput, RegulationOutcome } from "@potential-guide/objective-regulator";
import { canonicalJson } from "../src/canonical-json.js";
import { Engine, type Message } from "../src/engine.js";
import { identityKey } from "../src/identity.js";
import {
  type AgentResource,
  type CoordinatorCommand,
  type CoordinatorEvent,
  type CoordinatorOptions,
  type ExecutionContext,
  type Regulation,
  regulationCoordinator,
} from "../src/index.js";
import { identity, supports, validateRegulation } from "../src/validation.js";

function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const delay = (ms = 3) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label = "fact") {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(`Timed out: ${label}`);
    await delay();
  }
}
function spec(id: string, version = "1".repeat(40)): PilotSpec {
  return {
    objectiveId: `git+https://example.test/rules.git#${id}/`,
    version,
    source: {
      kind: "git-tree",
      repository: "https://example.test/rules.git",
      directory: id,
      commit: "a".repeat(40),
      tree: version,
      repositoryTree: "b".repeat(40),
    },
    manifest: {
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
      subjectSchema: { type: "object", additionalProperties: false },
      levels: [
        { id: "available", checks: [] },
        { id: "ready", checks: [] },
      ],
      defaultLanguage: "en",
      languages: ["en"],
    },
    locales: {
      en: {
        "system/404": {
          id: "system/404",
          title: "Missing",
          description: "",
          references: [],
          content: "",
        },
      },
    },
  };
}
function regulation(id: string, overrides: Partial<Regulation> = {}): Regulation {
  return { id, objective: spec(id), subject: {}, targetLevel: "ready", priority: 3, ...overrides };
}

test("retirement preserves canonical persisted bytes, stable identity keys and JSON rejection", () => {
  const value = { z: [{ B: 2, a: 1 }], A: 3, a: 4, ä: 5 };
  assert.equal(canonicalJson(value), '{"a":4,"A":3,"ä":5,"z":[{"a":1,"B":2}]}');
  assert.equal(
    identityKey("fixture", value),
    "fixture:6ca03b8e198fdccbdeb832ecf30da61dcfd7b69b5a139049879b4bb2ffb6632c",
  );
  const goal = regulation("legacy", { subject: value });
  assert.equal(
    identity(goal),
    canonicalJson([
      goal.objective.objectiveId,
      goal.objective.version,
      goal.objective.source,
      value,
      "en",
    ]),
  );
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const invalid of [undefined, NaN, Infinity, { missing: undefined }, circular]) {
    assert.throws(() => canonicalJson(invalid), {
      name: "TypeError",
      message: "Expected finite JSON data.",
    });
  }
});

test("retirement retains strict legacy goal validation and capability matching", () => {
  validateRegulation(regulation("valid"));
  for (const changes of [
    { id: "" },
    { id: "$dependency:reserved" },
    { priority: -1 },
    { priority: 1.5 },
    { requirements: [""] },
    { requirements: [1] },
    { subject: [] },
    { sourceBindings: null },
    { sourceBindings: [] },
    { language: "unknown" },
    { targetLevel: "unknown" },
    { extra: true },
  ]) {
    assert.throws(
      () => validateRegulation({ ...regulation("invalid"), ...changes } as Regulation),
      TypeError,
    );
  }
  const resource: AgentResource = {
    id: "worker",
    binding: { id: "agent" },
    capacity: 1,
    capabilities: ["repair"],
  };
  assert.equal(supports(resource, {}), true);
  assert.equal(supports(resource, { requirements: ["repair"] }), true);
  assert.equal(supports(resource, { requirements: ["repair", "network"] }), false);
});
function result(
  objective: PilotSpec,
  stopReason: "target-reached" | "authorization-required" | "exhausted" = "target-reached",
): RegulationOutcome {
  return {
    stopReason,
    iterations: 1,
    stalledRuns: 0,
    latestObservation: {
      status: 200,
      message: "",
      payload: {
        current: {
          objectiveId: objective.objectiveId,
          levelId: stopReason === "target-reached" ? "ready" : "initial",
        },
        versions: { [objective.objectiveId]: objective.version },
        sources: { [objective.objectiveId]: objective.source as GitObjectiveSource },
        problems: [],
        gapSummary: "",
        observedAt: new Date().toISOString(),
      },
    },
  };
}
function handoff(
  consumer: PilotSpec,
  providers: readonly PilotSpec[],
  minimum = "ready",
): RegulationOutcome {
  const dependencies: DependencyProblem[] = providers.map((objective) => ({
    kind: "dependency",
    objectiveId: objective.objectiveId,
    subject: {},
    currentLevelId: "initial",
    expectedLevelId: minimum,
  }));
  assert.ok(dependencies.length > 0);
  return {
    stopReason: "dependency-required",
    iterations: 0,
    stalledRuns: 0,
    dependencies: dependencies as [DependencyProblem, ...DependencyProblem[]],
    latestObservation: {
      status: 200,
      message: "",
      payload: {
        current: { objectiveId: consumer.objectiveId, levelId: "initial" },
        versions: Object.fromEntries(
          [consumer, ...providers].map((objective) => [objective.objectiveId, objective.version]),
        ),
        sources: Object.fromEntries(
          [consumer, ...providers].map((objective) => [
            objective.objectiveId,
            objective.source as GitObjectiveSource,
          ]),
        ),
        problems: dependencies,
        gapSummary: "",
        observedAt: new Date().toISOString(),
      },
    },
  };
}
const resource: AgentResource = {
  id: "agent",
  binding: { id: "fixture" },
  capacity: 2,
  capabilities: ["edit"],
};
interface TestRun {
  readonly input: RegulationInput;
  readonly resource: AgentResource;
  readonly outcome: ReturnType<typeof deferred<RegulationOutcome>>;
  readonly killed: ReturnType<typeof deferred<void>>;
  readonly execution?: ExecutionContext;
  aborts: number;
  kills: number;
}
async function harness(
  overrides: Partial<CoordinatorOptions> = {},
  initialResources: readonly AgentResource[] = [resource],
  stream?: Stream.Stream<CoordinatorCommand, string>,
) {
  const scope = Effect.runSync(Scope.make());
  const commands = Effect.runSync(Queue.bounded<CoordinatorCommand>(32));
  const resources = Effect.runSync(SubscriptionRef.make(initialResources));
  const events: CoordinatorEvent[] = [];
  const runs: TestRun[] = [];
  const released: string[] = [];
  const catalog = new Map<string, PilotSpec>();
  const ready = deferred<void>();
  const options: CoordinatorOptions = {
    maxConcurrency: 2,
    abortGraceMs: 10,
    bufferSize: 4,
    quota: { timeoutMs: 100, maxAgentRuns: 2, maxStallRuns: 2 },
    agentExecutionLimits: { timeoutMs: 100 },
    permissions: { ceiling: [], grants: [] },
    budget: { maxStarts: 50, maxAgentRuns: 100, maxDurationMs: 5000 },
    runner: {
      start(input, selectedResource, execution) {
        const run: TestRun = {
          input,
          resource: selectedResource,
          outcome: deferred(),
          killed: deferred(),
          aborts: 0,
          kills: 0,
          execution,
        };
        runs.push(run);
        return {
          result: run.outcome.promise,
          abort() {
            run.aborts++;
          },
          kill() {
            run.kills++;
            return run.killed.promise;
          },
        };
      },
    },
    async resolveObjective(id, version, source) {
      const objective = catalog.get(id);
      assert.ok(objective);
      assert.equal(objective.version, version);
      assert.deepEqual(objective.source, source);
      return {
        spec: objective,
        release: async () => {
          released.push(id);
        },
      };
    },
    ...overrides,
  };
  const coordinator = await Effect.runPromise(
    regulationCoordinator(
      resources,
      Stream.unwrap(
        Effect.promise(async () => {
          await ready.promise;
          return stream ?? Stream.fromQueue(commands);
        }),
      ),
      options,
    ).pipe(Scope.provide(scope)),
  );
  const subscriber = Effect.runFork(
    coordinator.events.pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      ),
    ),
  );
  await delay();
  ready.resolve();
  const send = async (command: CoordinatorCommand) => {
    const before = events.length;
    await Effect.runPromise(Queue.offer(commands, command));
    await until(
      () =>
        events
          .slice(before)
          .some(
            (event) =>
              (event.type === "accepted" || event.type === "rejected") &&
              event.commandId === command.commandId,
          ),
      `command ${command.commandId}`,
    );
  };
  const add = async (value: Regulation) =>
    send({ type: "add", commandId: `add:${value.id}`, regulation: value });
  const setResources = async (value: readonly AgentResource[]) => {
    const before = events.length;
    await Effect.runPromise(SubscriptionRef.set(resources, value));
    await until(
      () =>
        events
          .slice(before)
          .some(
            (event) =>
              event.type === "resources-accepted" ||
              (event.type === "failure" && event.stage === "resources"),
          ),
      "resource snapshot acknowledgement",
    );
  };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    // Runner kill acknowledgement is an independent termination confirmation.
    for (const run of runs) run.killed.resolve();
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await Effect.runPromise(Fiber.interrupt(subscriber));
    await Effect.runPromise(Queue.shutdown(commands));
  };
  return {
    scope,
    commands,
    resources,
    coordinator,
    subscriber,
    events,
    runs,
    released,
    catalog,
    send,
    add,
    setResources,
    close,
  };
}

function multiLevelSpec(version = "1".repeat(40)): PilotSpec {
  const objective = spec("provider", version);
  return {
    ...objective,
    manifest: {
      ...objective.manifest,
      levels: [
        { id: "available", checks: [] },
        { id: "l1", checks: [] },
        { id: "l2", checks: [] },
        { id: "l3", checks: [] },
      ],
    },
  };
}

function atLevel(
  outcome: RegulationOutcome,
  levelId: string,
  observedAt?: string,
): RegulationOutcome {
  const payload = outcome.latestObservation.payload;
  assert.ok(payload);
  return {
    ...outcome,
    latestObservation: {
      status: 200,
      message: "",
      payload: {
        ...payload,
        current: { ...payload.current, levelId },
        observedAt: observedAt ?? payload.observedAt,
      },
    },
  };
}

async function sharedLevels(overrides: Partial<CoordinatorOptions> = {}) {
  const p = multiLevelSpec();
  const catalog = new Map([[p.objectiveId, p]]);
  const gate = deferred<void>();
  let resolutions = 0;
  const h = await harness(
    {
      ...overrides,
      maxConcurrency: 3,
      async resolveObjective(id) {
        resolutions++;
        await gate.promise;
        const objective = catalog.get(id);
        assert.ok(objective);
        return { spec: objective, async release() {} };
      },
    },
    [{ ...resource, capacity: 3 }],
  );
  try {
    await h.add(regulation("low"));
    await h.add(regulation("high"));
    await until(() => h.runs.length === 2);
    h.runs[0]?.outcome.resolve(handoff(spec("low"), [p], "l1"));
    h.runs[1]?.outcome.resolve(handoff(spec("high"), [p], "l3"));
    await until(() => resolutions === 2);
    await h.setResources([]);
    gate.resolve();
    await until(() => h.events.filter((event) => event.type === "dependencies").length === 2);
    await h.setResources([{ ...resource, capacity: 3 }]);
    await until(() => h.runs.length === 3);
    const provider = h.runs[2];
    assert.ok(provider?.execution);
    assert.equal(provider.input.spec.strategy.targetLevel, "l3");
    return { h, p, catalog, provider, context: provider.execution };
  } catch (error) {
    gate.resolve();
    await h.close();
    throw error;
  }
}

test("idle service, bounded live multicast, normal input end, and resource wakeup use one scheduler", async () => {
  const value = regulation("later");
  const h = await harness(
    {},
    [],
    Stream.make({ type: "add", commandId: "finite", regulation: value }),
  );
  const second: CoordinatorEvent[] = [];
  const subscriber = Effect.runFork(
    h.coordinator.events.pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          second.push(event);
        }),
      ),
    ),
  );
  try {
    await until(() => h.events.some((event) => event.type === "input-ended"));
    assert.equal(h.runs.length, 0);
    await h.setResources([resource]);
    await until(() => h.runs.length === 1);
    h.runs[0]?.outcome.resolve(result(value.objective));
    await until(() => second.some((event) => event.type === "result"));
    assert.equal(h.runs.length, 1);
    assert.deepEqual(
      h.events.filter((event) => event.type === "result"),
      second.filter((event) => event.type === "result"),
    );
    assert.ok(
      h.events.every(
        (event, index) => index === 0 || event.sequence > (h.events[index - 1]?.sequence ?? 0),
      ),
    );
  } finally {
    await Effect.runPromise(Fiber.interrupt(subscriber));
    await h.close();
  }
});

test("nonnegative priority, FIFO ties, mutable priority without new generation, and stale rejection", async () => {
  const h = await harness({ maxConcurrency: 1 }, []);
  try {
    await h.add(regulation("a", { priority: 2 }));
    await h.add(regulation("b", { priority: 2 }));
    await h.add(regulation("c", { priority: 4 }));
    await h.send({ type: "priority", commandId: "raise", id: "c", generation: 1, priority: 1 });
    await h.send({ type: "priority", commandId: "invalid", id: "a", generation: 1, priority: -1 });
    await h.send({ type: "cancel", commandId: "stale", id: "a", generation: 9 });
    await h.setResources([resource]);
    await until(() => h.runs.length === 1);
    assert.equal(h.runs[0]?.input.spec.objective.objectiveId, spec("c").objectiveId);
    h.runs[0]?.outcome.resolve(result(spec("c")));
    await until(() => h.runs.length === 2);
    assert.equal(h.runs[1]?.input.spec.objective.objectiveId, spec("a").objectiveId);
    h.runs[1]?.outcome.resolve(result(spec("a")));
    await until(() => h.runs.length === 3);
    assert.equal(h.runs[2]?.input.spec.objective.objectiveId, spec("b").objectiveId);
    const accepted = h.events.find(
      (event) => event.type === "accepted" && event.commandId === "raise",
    );
    assert.ok(accepted?.type === "accepted");
    assert.equal(accepted.work.generation, 1);
    assert.equal(h.events.filter((event) => event.type === "rejected").length, 2);
  } finally {
    await h.close();
  }
});

test("P0 waits for confirmed kill; abort and kill failures preserve occupied slot until settlement", async () => {
  const h = await harness({
    maxConcurrency: 1,
    runner: {
      start(input, selectedResource) {
        const run: TestRun = {
          input,
          resource: selectedResource,
          outcome: deferred(),
          killed: deferred(),
          aborts: 0,
          kills: 0,
        };
        tracked.push(run);
        return {
          result: run.outcome.promise,
          abort() {
            run.aborts++;
            throw new Error("abort failed");
          },
          async kill() {
            run.kills++;
            throw new Error("kill failed");
          },
        };
      },
    },
  });
  const tracked: TestRun[] = [];
  try {
    await h.add(regulation("ordinary"));
    await until(() => tracked.length === 1);
    await h.add(regulation("urgent", { priority: 0 }));
    await until(() => h.events.some((event) => event.type === "failure" && event.stage === "kill"));
    assert.equal(tracked.length, 1);
    assert.equal(tracked[0]?.aborts, 1);
    assert.equal(tracked[0]?.kills, 1);
    tracked[0]?.outcome.resolve(result(spec("ordinary")));
    await until(() => tracked.length === 2);
    assert.equal(tracked[1]?.input.spec.objective.objectiveId, spec("urgent").objectiveId);
    assert.ok(h.events.some((event) => event.type === "stale-result"));
    // Close must also wait for actual termination when kill fails.
    tracked[1]?.outcome.resolve(result(spec("urgent")));
    await until(() => h.events.some((event) => event.type === "result"));
  } finally {
    for (const run of tracked) run.outcome.resolve(result(run.input.spec.objective));
    await h.close();
  }
});

test("capacity shrink, capability revocation, invalid snapshots, binding changes and recovery", async () => {
  const h = await harness();
  try {
    await h.add(regulation("a", { requirements: ["edit"] }));
    await h.add(regulation("b", { requirements: ["edit"] }));
    await until(() => h.runs.length === 2);
    await h.setResources([{ ...resource, capacity: 1 }]);
    await until(() => h.runs.some((run) => run.aborts > 0));
    assert.equal(h.runs[0]?.aborts, 0);
    h.runs[1]?.killed.resolve();
    await until(() => h.events.some((event) => event.type === "terminated"));
    await h.setResources([{ ...resource, capabilities: [] }]);
    await until(() => (h.runs[0]?.aborts ?? 0) > 0);
    h.runs[0]?.killed.resolve();
    await h.setResources([{ ...resource, capacity: 0 }]);
    assert.ok(h.events.some((event) => event.type === "failure" && event.stage === "resources"));
    await h.setResources([
      { ...resource, binding: { id: "invalid", configuration: [] } },
    ] as unknown as readonly AgentResource[]);
    const count = h.runs.length;
    await h.add(regulation("c"));
    assert.equal(h.runs.length, count);
    await h.setResources([resource]);
    await until(() => h.runs.length > count);
    const active = h.runs.at(-1);
    await h.setResources([{ ...resource, binding: { id: "replacement" } }]);
    await until(() => (active?.aborts ?? 0) > 0);
    active?.killed.resolve();
    await h.setResources([]);
  } finally {
    await h.close();
  }
});

test("shared provider survives one cancellation; success only wakes consumer for re-observation", async () => {
  const h = await harness();
  const provider = spec("provider");
  h.catalog.set(provider.objectiveId, provider);
  try {
    await h.add(regulation("a"));
    await h.add(regulation("b"));
    await until(() => h.runs.length === 2);
    h.runs[0]?.outcome.resolve(handoff(spec("a"), [provider]));
    h.runs[1]?.outcome.resolve(handoff(spec("b"), [provider]));
    await until(() => h.events.filter((event) => event.type === "dependencies").length === 2);
    await until(() => h.runs.length === 3);
    assert.equal(h.runs[2]?.input.spec.objective.objectiveId, provider.objectiveId);
    assert.equal(h.released.length, 1, "duplicate acquisition released");
    await h.send({ type: "cancel", commandId: "cancel-a", id: "a", generation: 1 });
    assert.equal(h.runs[2]?.aborts, 0, "shared provider retained");
    h.runs[2]?.outcome.resolve(result(provider));
    await until(() => h.runs.length === 4);
    assert.equal(h.runs[3]?.input.spec.objective.objectiveId, spec("b").objectiveId);
    assert.equal(
      h.events.filter(
        (event) =>
          event.type === "result" &&
          event.work.id === "b" &&
          event.outcome.stopReason === "target-reached",
      ).length,
      0,
    );
    h.runs[3]?.outcome.resolve(result(spec("b"), "authorization-required"));
    await until(() =>
      h.events.some(
        (event) => event.type === "blocked" && event.reason === "authorization-required",
      ),
    );
    await h.send({ type: "cancel", commandId: "cancel-b", id: "b", generation: 1 });
    await until(() => h.released.length === 2);
    assert.equal(
      h.events.filter(
        (event) => event.type === "reclaimed" && event.work.id.startsWith("$dependency:"),
      ).length,
      1,
    );
  } finally {
    await h.close();
  }
});

test("last root replacement collects the whole derived chain and ignores the old run", async () => {
  const h = await harness();
  const b = spec("b"),
    c = spec("c");
  h.catalog.set(b.objectiveId, b);
  h.catalog.set(c.objectiveId, c);
  try {
    await h.add(regulation("a"));
    await until(() => h.runs.length === 1);
    h.runs[0]?.outcome.resolve(handoff(spec("a"), [b]));
    await until(() => h.runs.length === 2);
    h.runs[1]?.outcome.resolve(handoff(b, [c]));
    await until(() => h.runs.length === 3);
    await h.send({
      type: "replace",
      commandId: "replace",
      generation: 1,
      regulation: regulation("a", { objective: spec("new") }),
    });
    await until(() => (h.runs[2]?.aborts ?? 0) > 0);
    h.runs[2]?.outcome.resolve(handoff(c, [spec("unexpected")]));
    await until(() => h.released.length === 2);
    assert.ok(h.events.some((event) => event.type === "stale-result"));
    assert.ok(
      h.events.some(
        (event) =>
          event.type === "accepted" && event.work.id === "a" && event.work.generation === 2,
      ),
    );
    assert.ok(
      !h.events.some(
        (event) =>
          event.type === "dependencies" && event.work.id === "a" && event.work.generation === 2,
      ),
    );
  } finally {
    await h.close();
  }
});

test("self and transitive cycle candidates are atomically rejected; independent work continues", async () => {
  for (const transitive of [false, true]) {
    const h = await harness();
    const a = spec("a"),
      b = spec("b");
    h.catalog.set(a.objectiveId, a);
    h.catalog.set(b.objectiveId, b);
    try {
      await h.add(regulation("a"));
      await until(() => h.runs.length === 1);
      h.runs[0]?.outcome.resolve(handoff(a, [transitive ? b : a]));
      if (transitive) {
        await until(() => h.runs.length === 2);
        h.runs[1]?.outcome.resolve(handoff(b, [a]));
      }
      await until(() =>
        h.events.some((event) => event.type === "failure" && event.stage === "dependency"),
      );
      assert.ok(
        h.events.some((event) => event.type === "failure" && event.reason.includes("cycle")),
      );
      assert.equal(
        h.events.filter((event) => event.type === "dependencies").length,
        transitive ? 1 : 0,
      );
      await h.add(regulation("independent"));
      await until(() =>
        h.runs.some(
          (run) => run.input.spec.objective.objectiveId === spec("independent").objectiveId,
        ),
      );
    } finally {
      await h.close();
    }
  }
});

test("async resolver checks generation after await and releases stale acquisitions", async () => {
  const acquisition = deferred<{ spec: PilotSpec; release: () => Promise<void> }>();
  let signal: AbortSignal | undefined;
  let releases = 0;
  const h = await harness({
    resolveObjective: async (_id, _version, _source, inputSignal) => {
      signal = inputSignal;
      return acquisition.promise;
    },
  });
  try {
    await h.add(regulation("a"));
    await until(() => h.runs.length === 1);
    h.runs[0]?.outcome.resolve(handoff(spec("a"), [spec("b")]));
    await until(() => signal !== undefined);
    await h.send({
      type: "replace",
      commandId: "new",
      generation: 1,
      regulation: regulation("a", { objective: spec("new") }),
    });
    assert.ok(signal?.aborted);
    acquisition.resolve({
      spec: spec("b"),
      release: async () => {
        releases++;
      },
    });
    await until(() => releases === 1);
    assert.equal(h.events.filter((event) => event.type === "dependencies").length, 0);
    assert.ok(
      h.runs.some((run) => run.input.spec.objective.objectiveId === spec("new").objectiveId),
    );
  } finally {
    await h.close();
  }
});

test("old versions, mismatched problems, invalid source/subject/levels and imprecise resolver fail explicitly", async () => {
  const cases: ((outcome: RegulationOutcome) => RegulationOutcome)[] = [
    (outcome) => {
      assert.ok(outcome.latestObservation.payload);
      return {
        ...outcome,
        latestObservation: {
          ...outcome.latestObservation,
          payload: {
            ...outcome.latestObservation.payload,
            versions: { [spec("a").objectiveId]: "f".repeat(40) },
          },
        },
      };
    },
    (outcome) => {
      assert.ok(outcome.latestObservation.payload);
      return {
        ...outcome,
        latestObservation: {
          ...outcome.latestObservation,
          payload: { ...outcome.latestObservation.payload, problems: [] },
        },
      };
    },
    (outcome) => {
      assert.ok(outcome.latestObservation.payload);
      return {
        ...outcome,
        latestObservation: {
          ...outcome.latestObservation,
          payload: { ...outcome.latestObservation.payload, sources: {} },
        },
      };
    },
  ];
  for (const alter of cases) {
    const h = await harness();
    try {
      await h.add(regulation("a"));
      await until(() => h.runs.length === 1);
      h.runs[0]?.outcome.resolve(alter(handoff(spec("a"), [spec("b")])));
      await until(() =>
        h.events.some((event) => event.type === "failure" && event.stage === "evidence"),
      );
      await h.add(regulation("valid"));
      await until(() => h.runs.length === 2);
    } finally {
      await h.close();
    }
  }
  for (const mode of ["wrong-version", "invalid-subject", "invalid-level"]) {
    let releases = 0;
    const h = await harness({
      resolveObjective: async () => ({
        spec:
          mode === "wrong-version"
            ? spec("b", "2".repeat(40))
            : mode === "invalid-subject"
              ? {
                  ...spec("b"),
                  manifest: {
                    ...spec("b").manifest,
                    subjectSchema: { type: "object", required: ["path"] },
                  },
                }
              : spec("b"),
        release: async () => {
          releases++;
        },
      }),
    });
    try {
      await h.add(regulation("a"));
      await until(() => h.runs.length === 1);
      h.runs[0]?.outcome.resolve(
        handoff(spec("a"), [spec("b")], mode === "invalid-level" ? "unknown" : "ready"),
      );
      await until(() =>
        h.events.some((event) => event.type === "failure" && event.stage === "dependency"),
      );
      assert.equal(releases, 1);
      assert.equal(h.events.filter((event) => event.type === "dependencies").length, 0);
    } finally {
      await h.close();
    }
  }
});

test("command cannot inject permissions/quota; explicit retries and replacement cannot renew total budget", async () => {
  const h = await harness({ budget: { maxStarts: 2, maxAgentRuns: 4, maxDurationMs: 200 } });
  try {
    await h.send({
      type: "add",
      commandId: "injected",
      regulation: { ...regulation("bad"), permissions: { ceiling: [], grants: ["admin"] } },
    } as unknown as CoordinatorCommand);
    assert.ok(h.events.some((event) => event.type === "rejected"));
    await h.add(regulation("a"));
    await until(() => h.runs.length === 1);
    assert.deepEqual(h.runs[0]?.input.permissions, { ceiling: [], grants: [] });
    h.runs[0]?.outcome.resolve(result(spec("a"), "exhausted"));
    await until(() =>
      h.events.some(
        (event) => event.type === "blocked" && event.reason.includes("quota-exhausted"),
      ),
    );
    await delay(20);
    assert.equal(h.runs.length, 1, "no automatic continuation");
    await h.send({ type: "retry", commandId: "retry", id: "a", generation: 1 });
    await until(() => h.runs.length === 2);
    h.runs[1]?.outcome.resolve(result(spec("a"), "authorization-required"));
    await until(() =>
      h.events.some(
        (event) => event.type === "blocked" && event.reason === "authorization-required",
      ),
    );
    await h.send({
      type: "replace",
      commandId: "renew",
      generation: 1,
      regulation: regulation("a"),
    });
    await until(() =>
      h.events.some(
        (event) => event.type === "blocked" && event.reason === "trusted-budget-exhausted",
      ),
    );
    assert.equal(h.runs.length, 2);
  } finally {
    await h.close();
  }
});

test("start throws, result rejects, and command input failure are facts, not service exit", async () => {
  let starts = 0;
  const h = await harness({
    runner: {
      start(input) {
        starts++;
        if (starts === 1) throw new Error("start unavailable");
        return {
          result:
            starts === 2
              ? Promise.reject(new Error("worker failed"))
              : Promise.resolve(result(input.spec.objective)),
          abort() {},
          async kill() {},
        };
      },
    },
  });
  try {
    await h.add(regulation("a"));
    await until(() =>
      h.events.some((event) => event.type === "failure" && event.stage === "start"),
    );
    await h.send({ type: "retry", commandId: "retry-a", id: "a", generation: 1 });
    await until(() =>
      h.events.some((event) => event.type === "failure" && event.stage === "execution"),
    );
    await h.add(regulation("b"));
    await until(() => h.events.some((event) => event.type === "result" && event.work.id === "b"));
  } finally {
    await h.close();
  }
  const failed = await harness(
    {},
    [],
    Stream.concat(
      Stream.make({ type: "add", commandId: "before-failure", regulation: regulation("queued") }),
      Stream.fail("command source failed"),
    ),
  );
  try {
    await until(() =>
      failed.events.some((event) => event.type === "failure" && event.stage === "command-input"),
    );
    await failed.setResources([resource]);
    assert.ok(failed.events.some((event) => event.type === "resources-accepted"));
    await until(() => failed.runs.length === 1);
  } finally {
    await failed.close();
  }
});

test("bounded subscribers backpressure without dropping facts; late subscribers have no history", async () => {
  const h = await harness({ bufferSize: 2 }, []);
  const gate = deferred<void>();
  const slowEvents: CoordinatorEvent[] = [];
  const slow = Effect.runFork(
    h.coordinator.events.pipe(
      Stream.runForEach((event) =>
        Effect.promise(async () => {
          slowEvents.push(event);
          if (slowEvents.length === 1) await gate.promise;
        }),
      ),
    ),
  );
  await delay();
  try {
    // More than the subscriber and mailbox capacities; offer itself must eventually wait.
    const offers = Array.from({ length: 12 }, (_, index) =>
      Effect.runPromise(
        Queue.offer(h.commands, {
          type: "add",
          commandId: `bulk:${index}`,
          regulation: regulation(`bulk-${index}`),
        }),
      ),
    );
    await Promise.all(offers);
    await until(() => slowEvents.length === 1);
    await delay(20);
    assert.ok(h.events.filter((event) => event.type === "accepted").length < 12);
    gate.resolve();
    await until(() => slowEvents.filter((event) => event.type === "accepted").length === 12);
    const late: CoordinatorEvent[] = [];
    const listener = Effect.runFork(
      h.coordinator.events.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            late.push(event);
          }),
        ),
      ),
    );
    await delay();
    assert.equal(late.length, 0);
    await h.add(regulation("late"));
    await until(() => late.some((event) => event.type === "accepted"));
    await Effect.runPromise(Fiber.interrupt(listener));
    const sequences = slowEvents.map((event) => event.sequence);
    assert.equal(new Set(sequences).size, sequences.length);
    assert.ok(
      sequences.every((value, index) => index === 0 || value === (sequences[index - 1] ?? 0) + 1),
    );
  } finally {
    gate.resolve();
    await Effect.runPromise(Fiber.interrupt(slow));
    await h.close();
  }
});

test("scope close aborts, waits for kill confirmation and releases owned source handles", async () => {
  const h = await harness();
  const b = spec("b");
  h.catalog.set(b.objectiveId, b);
  await h.add(regulation("a"));
  await until(() => h.runs.length === 1);
  h.runs[0]?.outcome.resolve(handoff(spec("a"), [b]));
  await until(() => h.runs.length === 2);
  let closed = false;
  const closing = Effect.runPromise(Scope.close(h.scope, Exit.void)).then(() => {
    closed = true;
  });
  await until(() => (h.runs[1]?.aborts ?? 0) === 1);
  await delay(20);
  assert.equal(closed, false);
  assert.equal(h.released.length, 0);
  h.runs[1]?.killed.resolve();
  await closing;
  assert.equal(h.released.length, 1);
  await h.close();
});

test("provider demand aggregates strongest level, capabilities and priority without duplicate execution", async () => {
  const h = await harness({}, [{ ...resource, capacity: 3, capabilities: ["read", "edit"] }]);
  const base = spec("provider");
  const provider: PilotSpec = {
    ...base,
    manifest: {
      ...base.manifest,
      levels: [...base.manifest.levels, { id: "complete", checks: [] }],
    },
  };
  h.catalog.set(provider.objectiveId, provider);
  try {
    await h.add(regulation("a", { requirements: ["read"], priority: 5 }));
    await h.add(regulation("b", { requirements: ["edit"], priority: 1 }));
    await until(() => h.runs.length === 2);
    h.runs[0]?.outcome.resolve(handoff(spec("a"), [provider]));
    await until(() => h.runs.length === 3);
    h.runs[1]?.outcome.resolve(handoff(spec("b"), [provider], "terminal"));
    await until(() => (h.runs[2]?.aborts ?? 0) === 1);
    assert.equal(h.runs.length, 3, "strengthened run does not overlap stopping run");
    h.runs[2]?.killed.resolve();
    await until(() => h.runs.length === 4);
    assert.equal(h.runs[3]?.input.spec.strategy.targetLevel, "terminal");
    const start = h.events.filter((event) => event.type === "started").at(-1);
    assert.ok(start?.type === "started");
    assert.equal(start.priority, 1);
    assert.equal(start.targetLevel, "terminal");
    assert.deepEqual([...start.requirements].sort(), ["edit", "read"]);
    const providers = h.events
      .filter((event) => event.type === "dependencies")
      .flatMap((event) => event.providers.map((entry) => entry.id));
    assert.equal(new Set(providers).size, 1);
  } finally {
    await h.close();
  }
});

test("a provider that is itself a root is retained after consumer cancellation", async () => {
  const h = await harness();
  const provider = spec("provider");
  h.catalog.set(provider.objectiveId, provider);
  try {
    await h.add(regulation("provider", { objective: provider }));
    await h.add(regulation("consumer"));
    await until(() => h.runs.length === 2);
    h.runs[1]?.outcome.resolve(handoff(spec("consumer"), [provider]));
    await until(() => h.events.some((event) => event.type === "dependencies"));
    assert.equal(h.runs.length, 2);
    await h.send({ type: "cancel", commandId: "cancel-consumer", id: "consumer", generation: 1 });
    assert.equal(h.runs[0]?.aborts, 0);
    assert.ok(
      !h.events.some((event) => event.type === "reclaimed" && event.work.id === "provider"),
    );
    assert.deepEqual(
      h.released,
      [provider.objectiveId],
      "temporary resolver lease released, root stays host-owned",
    );
  } finally {
    await h.close();
  }
});

test("a blocked derived provider can be explicitly retried without replacing or granting authority", async () => {
  const h = await harness();
  const b = spec("b");
  h.catalog.set(b.objectiveId, b);
  try {
    await h.add(regulation("a"));
    await until(() => h.runs.length === 1);
    h.runs[0]?.outcome.resolve(handoff(spec("a"), [b]));
    await until(() => h.runs.length === 2);
    h.runs[1]?.outcome.reject(new Error("provider unavailable"));
    await until(() =>
      h.events.some(
        (event) => event.type === "blocked" && event.work.id.startsWith("$dependency:"),
      ),
    );
    const blocked = h.events.find(
      (event) => event.type === "blocked" && event.work.id.startsWith("$dependency:"),
    );
    assert.ok(blocked?.type === "blocked");
    await h.send({ type: "retry", commandId: "provider-retry", ...blocked.work });
    await until(() => h.runs.length === 3);
    h.runs[2]?.outcome.resolve(result(b));
    await until(() => h.runs.length === 4);
    assert.equal(h.runs[3]?.input.spec.objective.objectiveId, spec("a").objectiveId);
  } finally {
    await h.close();
  }
});

test("replacement isolates late root results, add after idle succeeds, cancel/re-add advances generation", async () => {
  const h = await harness();
  try {
    await h.add(regulation("a"));
    await until(() => h.runs.length === 1);
    await h.send({
      type: "replace",
      commandId: "replace-running",
      generation: 1,
      regulation: regulation("a", { objective: spec("new") }),
    });
    await until(() => h.runs.length === 2);
    h.runs[0]?.outcome.resolve(result(spec("a")));
    await until(() => h.events.some((event) => event.type === "stale-result"));
    assert.ok(!h.events.some((event) => event.type === "result" && event.work.generation === 2));
    h.runs[1]?.outcome.resolve(result(spec("new")));
    await until(() =>
      h.events.some((event) => event.type === "result" && event.work.generation === 2),
    );
    await h.send({ type: "cancel", commandId: "cancel-new", id: "a", generation: 2 });
    await h.add(regulation("a"));
    await until(() => h.runs.length === 3);
    assert.ok(
      h.events.some(
        (event) =>
          event.type === "accepted" && event.work.id === "a" && event.work.generation === 3,
      ),
    );
    await h.add(regulation("after-idle"));
    await until(() => h.runs.length === 4);
  } finally {
    await h.close();
  }
});

test("resolution cancellation releases handles and does not strand a provider that remains reachable", async () => {
  const blockedResolution = deferred<{ spec: PilotSpec; release: () => Promise<void> }>();
  const provider = spec("provider");
  let releases = 0;
  const h = await harness({
    resolveObjective: async (id) =>
      id === provider.objectiveId
        ? {
            spec: provider,
            release: async () => {
              releases++;
            },
          }
        : blockedResolution.promise,
  });
  try {
    await h.add(regulation("provider"));
    await h.add(regulation("consumer"));
    await until(() => h.runs.length === 2);
    h.runs[1]?.outcome.resolve(handoff(spec("consumer"), [provider]));
    await until(() => h.events.some((event) => event.type === "dependencies"));
    h.runs[0]?.outcome.resolve(handoff(provider, [spec("leaf")]));
    await until(() => h.events.filter((event) => event.type === "result").length === 2);
    await h.send({ type: "cancel", commandId: "demote-provider", id: "provider", generation: 1 });
    blockedResolution.resolve({
      spec: spec("leaf"),
      release: async () => {
        releases++;
      },
    });
    await until(() => h.runs.length === 3);
    assert.equal(h.runs[2]?.input.spec.objective.objectiveId, provider.objectiveId);
    assert.equal(releases, 2);
    assert.equal(h.events.filter((event) => event.type === "dependencies").length, 1);
  } finally {
    await h.close();
  }
});

test("same Objective and subject at different exact versions never share a provider", async () => {
  const old = spec("provider"),
    newer = spec("provider", "2".repeat(40));
  const h = await harness({
    resolveObjective: async (_id, version) => ({
      spec: version === old.version ? old : newer,
      release: async () => {},
    }),
  });
  try {
    await h.add(regulation("a"));
    await h.add(regulation("b"));
    await until(() => h.runs.length === 2);
    h.runs[0]?.outcome.resolve(handoff(spec("a"), [old]));
    h.runs[1]?.outcome.resolve(handoff(spec("b"), [newer]));
    await until(() => h.events.filter((event) => event.type === "dependencies").length === 2);
    const providers = h.events
      .filter((event) => event.type === "dependencies")
      .flatMap((event) => event.providers.map((entry) => entry.id));
    assert.equal(new Set(providers).size, 2);
    await until(() => h.runs.length === 4);
    assert.notEqual(
      h.runs[2]?.input.spec.objective.version,
      h.runs[3]?.input.spec.objective.version,
    );
  } finally {
    await h.close();
  }
});

test("release failures are reported and closed does not claim clean source cleanup", async () => {
  const h = await harness({
    resolveObjective: async () => ({
      spec: spec("b"),
      release: async () => {
        throw new Error("release failed");
      },
    }),
  });
  try {
    await h.add(regulation("a"));
    await until(() => h.runs.length === 1);
    h.runs[0]?.outcome.resolve(handoff(spec("a"), [spec("b")]));
    await until(() => h.runs.length === 2);
    h.runs[1]?.killed.resolve();
    await h.close();
    assert.ok(h.events.some((event) => event.type === "failure" && event.stage === "release"));
    const closed = h.events.find((event) => event.type === "closed");
    assert.ok(closed?.type === "closed");
    assert.equal(closed.cleanupFailures, 1);
  } finally {
    await h.close();
  }
});

test("candidate cycle rejection releases every acquisition without installing a partial provider graph", async () => {
  const h = await harness();
  const a = spec("a"),
    b = spec("b");
  h.catalog.set(a.objectiveId, a);
  h.catalog.set(b.objectiveId, b);
  try {
    await h.add(regulation("a"));
    await until(() => h.runs.length === 1);
    h.runs[0]?.outcome.resolve(handoff(a, [b, a]));
    await until(() =>
      h.events.some((event) => event.type === "failure" && event.stage === "dependency"),
    );
    assert.equal(h.released.length, 2);
    assert.equal(h.runs.length, 1);
    assert.equal(h.events.filter((event) => event.type === "dependencies").length, 0);
    await h.add(regulation("independent"));
    await until(() => h.runs.length === 2);
  } finally {
    await h.close();
  }
});

test("conflicting source domains cannot share or corrupt an existing provider", async () => {
  const h = await harness();
  const p = spec("provider"),
    sideOld = spec("side"),
    sideNew = spec("side", "2".repeat(40));
  h.catalog.set(p.objectiveId, p);
  const evidence = (root: PilotSpec, side: PilotSpec): RegulationOutcome => {
    const outcome = handoff(root, [p]);
    assert.ok(outcome.latestObservation.payload);
    return {
      ...outcome,
      latestObservation: {
        ...outcome.latestObservation,
        payload: {
          ...outcome.latestObservation.payload,
          versions: {
            ...outcome.latestObservation.payload.versions,
            [side.objectiveId]: side.version,
          },
          sources: {
            ...outcome.latestObservation.payload.sources,
            [side.objectiveId]: side.source as GitObjectiveSource,
          },
        },
      },
    };
  };
  try {
    await h.add(
      regulation("a", {
        sourceBindings: { [sideOld.objectiveId]: sideOld.source as GitObjectiveSource },
      }),
    );
    await h.add(
      regulation("b", {
        sourceBindings: { [sideNew.objectiveId]: sideNew.source as GitObjectiveSource },
      }),
    );
    await until(() => h.runs.length === 2);
    h.runs[0]?.outcome.resolve(evidence(spec("a"), sideOld));
    await until(() => h.runs.length === 3);
    h.runs[1]?.outcome.resolve(evidence(spec("b"), sideNew));
    await until(() =>
      h.events.some((event) => event.type === "failure" && event.stage === "dependency"),
    );
    assert.equal(h.events.filter((event) => event.type === "dependencies").length, 1);
    assert.equal(h.runs[2]?.aborts, 0);
    assert.equal(h.released.length, 1);
  } finally {
    await h.close();
  }
});

test("resource-input failure revokes allocation until a valid resource message restores scheduling", async () => {
  const messages: Message[] = [];
  const facts: Omit<CoordinatorEvent, "sequence">[] = [];
  let starts = 0;
  const engine = new Engine(
    {
      maxConcurrency: 1,
      abortGraceMs: 10,
      permissions: { ceiling: [], grants: [] },
      quota: { timeoutMs: 100, maxAgentRuns: 1, maxStallRuns: 1 },
      agentExecutionLimits: { timeoutMs: 100 },
      budget: { maxStarts: 3, maxAgentRuns: 3, maxDurationMs: 300 },
      resolveObjective: async () => {
        throw new Error("not needed");
      },
      runner: {
        start(input) {
          starts++;
          return {
            result: Promise.resolve(result(input.spec.objective)),
            abort() {},
            async kill() {},
          };
        },
      },
    },
    async (fact) => {
      facts.push(fact);
    },
    async (message) => {
      messages.push(message);
    },
  );
  await engine.handle({ type: "resources", resources: [resource] });
  await engine.handle({
    type: "input-failure",
    input: "resources",
    error: new Error("resource stream failed"),
  });
  await engine.handle({
    type: "command",
    command: { type: "add", commandId: "queued", regulation: regulation("queued") },
  });
  assert.equal(starts, 0);
  assert.ok(facts.some((fact) => fact.type === "failure"));
  await engine.handle({ type: "resources", resources: [resource] });
  assert.equal(starts, 1);
  await delay();
  for (const message of messages.splice(0)) await engine.handle(message);
  await engine.handle({ type: "close" });
  await engine.drained;
});

test("close drains subscribed facts rather than dropping buffered cleanup events", async () => {
  const h = await harness({ bufferSize: 2 }, []);
  const gate = deferred<void>();
  const seen: CoordinatorEvent[] = [];
  const slow = Effect.runFork(
    h.coordinator.events.pipe(
      Stream.runForEach((event) =>
        Effect.promise(async () => {
          seen.push(event);
          if (seen.length === 1) await gate.promise;
        }),
      ),
    ),
  );
  await delay();
  try {
    await h.add(regulation("a"));
    let closed = false;
    const closing = h.close().then(() => {
      closed = true;
    });
    await delay(20);
    assert.equal(closed, false);
    gate.resolve();
    await closing;
    assert.ok(seen.some((event) => event.type === "reclaimed"));
    assert.ok(seen.some((event) => event.type === "closed"));
    assert.ok(
      seen.every(
        (event, index) => index === 0 || event.sequence === (seen[index - 1]?.sequence ?? 0) + 1,
      ),
    );
  } finally {
    gate.resolve();
    await Effect.runPromise(Fiber.interrupt(slow));
    await h.close();
  }
});

test("runner requests carry execution IDs, are serialized as facts, and cannot grant authority", async () => {
  const contexts: ExecutionContext[] = [];
  const h = await harness({
    runner: {
      start(_input, _resource, context) {
        contexts.push(context);
        return {
          result: new Promise<RegulationOutcome>(() => {}),
          abort() {},
          async kill() {},
        };
      },
    },
  });

  try {
    await h.add(regulation("a"));
    await until(() => contexts.length === 1);
    const context = contexts[0];
    assert.ok(context);
    await context.report({
      type: "capability-request",
      capability: "edit",
      reason: "Need editing",
    });
    await context.report({
      type: "authorization-request",
      request: {
        id: "ask",
        operation: "edit",
        resources: ["D:\\fixture"],
        reason: "Need permission",
      },
    });
    await until(() => h.events.some((event) => event.type === "authorization-request"));
    const request = h.events.find((event) => event.type === "capability-request");
    assert.ok(request?.type === "capability-request");
    assert.equal(request.runId, context.runId);
    assert.deepEqual(request.work, context.work);
    assert.ok(Object.isFrozen(request));
    assert.ok(Object.isFrozen(request.work));
    await h.send({ type: "cancel", commandId: "cancel", id: "a", generation: 1 });
    await context.report({ type: "capability-request", capability: "admin", reason: "late" });
    await until(() =>
      h.events.some(
        (event) => event.type === "stale-result" && event.reason === "obsolete-execution-feedback",
      ),
    );
    assert.ok(
      !h.events.some(
        (event) => event.type === "capability-request" && event.capability === "admin",
      ),
    );
  } finally {
    await h.close();
  }
});

test("current-run L1 progress wakes only the L1 consumer while the shared L3 provider continues", async () => {
  const { h, p, provider, context } = await sharedLevels();
  try {
    await context.report({
      type: "observation",
      observation: atLevel(result(p), "l1").latestObservation,
    });
    await until(() => h.runs.length === 4);
    assert.equal(h.runs[3]?.input.spec.objective.objectiveId, spec("low").objectiveId);
    assert.equal(provider.aborts, 0);
    assert.equal(provider.kills, 0);
    assert.equal(
      h.events.filter((event) => event.type === "started" && event.work.id === "high").length,
      1,
    );
    assert.ok(!h.events.some((event) => event.type === "result" && event.runId === context.runId));
    const progress = h.events.find((event) => event.type === "observation");
    assert.ok(progress?.type === "observation");
    assert.equal(progress.runId, context.runId);
    assert.deepEqual(progress.work, context.work);
    await context.report({
      type: "observation",
      observation: atLevel(result(p), "l3").latestObservation,
    });
    await until(() => h.runs.length === 5);
    assert.equal(h.runs[4]?.input.spec.objective.objectiveId, spec("high").objectiveId);
    assert.equal(provider.aborts, 0);
  } finally {
    await h.close();
  }
});

test("verified exhausted, authorization-required and dependency-required L1 outcomes release only L1 waits", async () => {
  for (const stopReason of [
    "exhausted",
    "authorization-required",
    "dependency-required",
  ] as const) {
    const { h, p, catalog, provider, context } = await sharedLevels();
    const leaf = spec("leaf");
    catalog.set(leaf.objectiveId, leaf);
    try {
      const outcome =
        stopReason === "dependency-required" ? handoff(p, [leaf]) : result(p, stopReason);
      provider.outcome.resolve(atLevel(outcome, "l1"));
      await until(() =>
        h.runs.some(
          (run, index) =>
            index > 2 && run.input.spec.objective.objectiveId === spec("low").objectiveId,
        ),
      );
      const low = h.runs.find(
        (run, index) =>
          index > 2 && run.input.spec.objective.objectiveId === spec("low").objectiveId,
      );
      assert.ok(low);
      assert.deepEqual(low.input.permissions, { ceiling: [], grants: [] });
      assert.equal(
        h.events.filter((event) => event.type === "started" && event.work.id === "high").length,
        1,
      );
      assert.equal(
        h.events.filter((event) => event.type === "started" && event.work.id === context.work.id)
          .length,
        1,
      );
      low.outcome.resolve(result(spec("low"), "authorization-required"));
      await until(() =>
        h.events.some(
          (event) =>
            event.type === "blocked" &&
            event.work.id === "low" &&
            event.reason === "authorization-required",
        ),
      );
      assert.ok(
        !h.events.some(
          (event) =>
            event.type === "result" &&
            event.work.id === "low" &&
            event.outcome.stopReason === "target-reached",
        ),
      );
      if (stopReason === "authorization-required")
        assert.ok(
          h.events.some(
            (event) =>
              event.type === "blocked" &&
              event.work.id === context.work.id &&
              event.reason === "authorization-required",
          ),
        );
    } finally {
      await h.close();
    }
  }
});

test("partial provider evidence cannot bypass the L1 consumer's exhausted lifetime budget", async () => {
  const { h, p, provider } = await sharedLevels({
    budget: { maxStarts: 3, maxAgentRuns: 6, maxDurationMs: 300 },
  });
  try {
    provider.outcome.resolve(atLevel(result(p, "authorization-required"), "l1"));
    await until(() =>
      h.events.some(
        (event) =>
          event.type === "blocked" &&
          event.work.id === "low" &&
          event.reason === "trusted-budget-exhausted",
      ),
    );
    assert.equal(h.runs.length, 3);
    assert.ok(
      !h.events.some(
        (event) =>
          event.type === "blocked" &&
          event.work.id === "high" &&
          event.reason === "trusted-budget-exhausted",
      ),
    );
  } finally {
    await h.close();
  }
});

test("invalid progress envelopes, sources, versions, levels and timestamps never release waits", async () => {
  const { h, p, context } = await sharedLevels();
  try {
    const valid = atLevel(result(p), "l1").latestObservation;
    assert.ok(valid.payload);
    assert.ok(p.source?.kind === "git-tree");
    const invalid = [
      { status: 500, payload: null, message: "unavailable" },
      { ...valid, payload: { ...valid.payload, sources: {} } },
      { ...valid, payload: { ...valid.payload, versions: { [p.objectiveId]: "2".repeat(40) } } },
      {
        ...valid,
        payload: {
          ...valid.payload,
          current: { objectiveId: p.objectiveId, levelId: "unknown" },
        },
      },
      {
        ...valid,
        payload: {
          ...valid.payload,
          current: { objectiveId: p.objectiveId, levelId: "terminal" },
        },
      },
      { ...valid, payload: { ...valid.payload, observedAt: "not-a-time" } },
      {
        ...valid,
        payload: {
          ...valid.payload,
          problems: [
            {
              kind: "dependency",
              objectiveId: spec("unbound").objectiveId,
              subject: {},
              currentLevelId: "initial",
              expectedLevelId: "ready",
            },
          ],
        },
      },
      {
        ...valid,
        payload: {
          ...valid.payload,
          sources: { [p.objectiveId]: { ...p.source, commit: "f".repeat(40) } },
        },
      },
    ] as const;
    for (const observation of invalid) await context.report({ type: "observation", observation });
    await until(
      () =>
        h.events.filter((event) => event.type === "failure" && event.stage === "feedback")
          .length === invalid.length,
    );
    assert.equal(h.runs.length, 3);
    assert.ok(!h.events.some((event) => event.type === "observation"));
    await context.report({ type: "observation", observation: valid });
    await until(() => h.runs.length === 4);
  } finally {
    await h.close();
  }
});

test("a newer downgrade retracts unscheduled L1 wakeups and rejects delayed higher evidence", async () => {
  const { h, p, context } = await sharedLevels();
  const time = Date.now();
  try {
    await h.setResources([{ ...resource, capacity: 1 }]);
    await context.report({
      type: "observation",
      observation: atLevel(result(p), "l1", new Date(time).toISOString()).latestObservation,
    });
    await until(() =>
      h.events.some(
        (event) =>
          event.type === "blocked" &&
          event.work.id === "low" &&
          event.reason === "capacity-unavailable",
      ),
    );
    await context.report({
      type: "observation",
      observation: atLevel(result(p), "initial", new Date(time + 1).toISOString())
        .latestObservation,
    });
    await until(() => h.events.filter((event) => event.type === "observation").length === 2);
    await context.report({
      type: "observation",
      observation: atLevel(result(p), "l3", new Date(time).toISOString()).latestObservation,
    });
    await until(() =>
      h.events.some(
        (event) =>
          event.type === "failure" &&
          event.stage === "feedback" &&
          event.reason.includes("newer evidence"),
      ),
    );
    await h.setResources([{ ...resource, capacity: 3 }]);
    assert.equal(h.runs.length, 3, "old high-water evidence is not cached");
    await context.report({
      type: "observation",
      observation: atLevel(result(p), "l1", new Date(time + 2).toISOString()).latestObservation,
    });
    await until(() => h.runs.length === 4);
    assert.equal(h.runs[3]?.input.spec.objective.objectiveId, spec("low").objectiveId);
  } finally {
    await h.close();
  }
});

test("old run progress and mismatched source cannot wake consumers of a replacement generation", async () => {
  const old = multiLevelSpec(),
    current = multiLevelSpec("2".repeat(40));
  const h = await harness({ maxConcurrency: 3 }, [{ ...resource, capacity: 3 }]);
  h.catalog.set(current.objectiveId, current);
  try {
    await h.add(regulation("provider-root", { objective: old, targetLevel: "l3" }));
    await until(() => h.runs.length === 1);
    const oldContext = h.runs[0]?.execution;
    assert.ok(oldContext);
    await oldContext.report({
      type: "observation",
      observation: atLevel(result(old), "l3").latestObservation,
    });
    await until(() => h.events.some((event) => event.type === "observation"));
    await h.send({
      type: "replace",
      commandId: "new-provider",
      generation: 1,
      regulation: regulation("provider-root", { objective: current, targetLevel: "l3" }),
    });
    await until(() => h.runs.length === 2);
    const currentContext = h.runs[1]?.execution;
    assert.ok(currentContext);
    h.runs[0]?.killed.resolve();
    await h.add(regulation("low"));
    await until(() => h.runs.length === 3);
    h.runs[2]?.outcome.resolve(handoff(spec("low"), [current], "l1"));
    await until(() => h.events.some((event) => event.type === "dependencies"));
    await oldContext.report({
      type: "observation",
      observation: atLevel(result(old), "l3").latestObservation,
    });
    await currentContext.report({
      type: "observation",
      observation: atLevel(result(old), "l3").latestObservation,
    });
    await until(() =>
      h.events.some((event) => event.type === "stale-result" && event.runId === oldContext.runId),
    );
    await until(() =>
      h.events.some(
        (event) =>
          event.type === "failure" &&
          event.stage === "feedback" &&
          event.runId === currentContext.runId,
      ),
    );
    assert.equal(h.runs.length, 3);
    await currentContext.report({
      type: "observation",
      observation: atLevel(result(current), "l1").latestObservation,
    });
    await until(() => h.runs.length === 4);
    assert.equal(h.runs[3]?.input.spec.objective.version, spec("low").version);
    assert.equal(currentContext.work.generation, 2);
  } finally {
    await h.close();
  }
});

test("target-reached below the started L3 target is rejected even after aggregate target weakens", async () => {
  const { h, p, provider } = await sharedLevels();
  try {
    await h.send({ type: "cancel", commandId: "remove-L3", id: "high", generation: 1 });
    provider.outcome.resolve(atLevel(result(p), "l1"));
    await until(() =>
      h.events.some(
        (event) =>
          event.type === "failure" &&
          event.stage === "evidence" &&
          event.reason.includes("below the requested level"),
      ),
    );
    assert.equal(h.runs.length, 3);
    assert.ok(
      !h.events.some(
        (event) => event.type === "result" && event.work.id.startsWith("$dependency:"),
      ),
    );
  } finally {
    await h.close();
  }
});

test("same Effect.scoped subscriber is interrupted before service cleanup under bounded backpressure", async () => {
  const order: string[] = [];
  const started = deferred<void>();
  const options: CoordinatorOptions = {
    maxConcurrency: 1,
    abortGraceMs: 1,
    bufferSize: 1,
    permissions: { ceiling: [], grants: [] },
    quota: { timeoutMs: 100, maxAgentRuns: 1, maxStallRuns: 1 },
    agentExecutionLimits: { timeoutMs: 100 },
    budget: { maxStarts: 10, maxAgentRuns: 10, maxDurationMs: 1000 },
    resolveObjective: async () => {
      throw new Error("not needed");
    },
    runner: {
      start() {
        return {
          result: new Promise<RegulationOutcome>(() => {}),
          abort() {
            order.push("abort");
          },
          async kill() {
            order.push("kill-confirmed");
          },
        };
      },
    },
  };
  let reader: Fiber.Fiber<unknown> | undefined;
  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    if (reader) Effect.runFork(Fiber.interrupt(reader));
  }, 2000);
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const resources = yield* SubscriptionRef.make<readonly AgentResource[]>([resource]);
          const commands = yield* Queue.bounded<CoordinatorCommand>(8);
          const service = yield* regulationCoordinator(
            resources,
            Stream.fromQueue(commands),
            options,
          );
          reader = yield* service.events.pipe(
            Stream.runForEach((event) =>
              event.type === "started"
                ? Effect.sync(() => started.resolve()).pipe(Effect.andThen(Effect.never))
                : Effect.void,
            ),
            Effect.ensuring(
              Effect.sync(() => {
                order.push("subscriber-released");
              }),
            ),
            Effect.forkScoped({ startImmediately: true }),
          );
          yield* Queue.offer(commands, {
            type: "add",
            commandId: "active",
            regulation: regulation("active"),
          });
          yield* Effect.promise(() => started.promise);
          for (let index = 0; index < 4; index++)
            yield* Queue.offer(commands, {
              type: "add",
              commandId: `pending:${index}`,
              regulation: regulation(`pending-${index}`),
            });
          yield* Effect.sleep("10 millis");
        }),
      ),
    );
    order.push("scope-closed");
    assert.equal(timedOut, false, "scope cleanup must not need external subscriber interruption");
    assert.ok(order.indexOf("subscriber-released") < order.indexOf("abort"));
    assert.ok(order.indexOf("abort") < order.indexOf("kill-confirmed"));
    assert.equal(order.at(-1), "scope-closed");
  } finally {
    clearTimeout(watchdog);
  }
});

test("fresh handoff downgrade invalidates cached progress but a delayed handoff cannot overwrite newer progress", async () => {
  for (const delayed of [false, true]) {
    const p = multiLevelSpec();
    const gate = deferred<void>();
    const h = await harness(
      {
        maxConcurrency: 3,
        async resolveObjective() {
          await gate.promise;
          return { spec: p, async release() {} };
        },
      },
      [{ ...resource, capacity: 3 }],
    );
    const time = Date.now();
    try {
      await h.add(regulation("provider-root", { objective: p, targetLevel: "l3" }));
      await until(() => h.runs.length === 1);
      const context = h.runs[0]?.execution;
      assert.ok(context);
      if (!delayed) {
        await context.report({
          type: "observation",
          observation: atLevel(result(p), "l3", new Date(time + 1).toISOString()).latestObservation,
        });
        await until(() => h.events.some((event) => event.type === "observation"));
      }
      await h.add(regulation("low"));
      await until(() => h.runs.length === 2);
      h.runs[1]?.outcome.resolve(
        atLevel(
          handoff(spec("low"), [p], "l1"),
          "initial",
          new Date(time + (delayed ? 1 : 2)).toISOString(),
        ),
      );
      await until(() =>
        h.events.some((event) => event.type === "result" && event.work.id === "low"),
      );
      if (delayed) {
        await context.report({
          type: "observation",
          observation: atLevel(result(p), "l3", new Date(time + 2).toISOString()).latestObservation,
        });
        await until(() => h.events.some((event) => event.type === "observation"));
      }
      gate.resolve();
      await until(() => h.events.some((event) => event.type === "dependencies"));
      if (!delayed) {
        assert.equal(h.runs.length, 2);
        await context.report({
          type: "observation",
          observation: atLevel(result(p), "l1", new Date(time + 3).toISOString()).latestObservation,
        });
      }
      await until(() => h.runs.length === 3);
      assert.equal(h.runs[2]?.input.spec.objective.objectiveId, spec("low").objectiveId);
    } finally {
      gate.resolve();
      await h.close();
    }
  }
});
