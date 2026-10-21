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
import { Engine, type Message } from "../src/engine.js";
import {
  type AgentResource,
  type CoordinatorCommand,
  type CoordinatorEvent,
  type CoordinatorOptions,
  type ExecutionContext,
  type Regulation,
  regulationCoordinator,
} from "../src/index.js";

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
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json",
      subjectSchema: { type: "object", additionalProperties: false },
      levels: [
        { id: "initial", checks: [] },
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
      start(input, selectedResource) {
        const run: TestRun = {
          input,
          resource: selectedResource,
          outcome: deferred(),
          killed: deferred(),
          aborts: 0,
          kills: 0,
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
    await Effect.runPromise(SubscriptionRef.set(resources, value));
    await delay(12);
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
  const provider = spec("provider");
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
