import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, SubscriptionRef } from "@potential-guide/effects";
import type { Envelope, PilotObservation, PilotSpec } from "@potential-guide/objective-pilot";
import {
  type RegulationInput,
  type RegulationOutcome,
  type RegulationPermissions,
  regulate,
} from "@potential-guide/objective-regulator";
import {
  type AgentResource,
  type CoordinatorEvent,
  createPortfolioCoordinator,
  createPortfolioPlanner,
  type ObjectiveGoal,
  objectiveKey,
  type PriorityQueueSnapshot,
  type QueueDemand,
} from "../src/index.js";

const delay = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined, "Expected a value to be present.");
  return value;
}
async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 2000;
  while (!(await predicate())) {
    if (Date.now() > deadline) assert.fail("Timed out waiting for supervisor state.");
    await delay();
  }
}
const read = <A>(ref: SubscriptionRef.SubscriptionRef<A>) =>
  Effect.runPromise(SubscriptionRef.get(ref));
function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function pilot(id: string): PilotSpec {
  return {
    objectiveId: `git+file:///fixture.git#${id}/pilot.yaml`,
    version: "1".repeat(40),
    manifest: {
      schemaVersion: 1,
      domainSchema: { type: "object" },
      levels: [
        { id: "initial", advancement: { checks: [{ id: "check", problems: ["missing"] }] } },
        { id: "ready", advancement: { checks: [] } },
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
function goal(id: string, overrides: Partial<ObjectiveGoal> = {}): ObjectiveGoal {
  return {
    id,
    pilot: pilot(id),
    subject: {},
    targetLevel: "terminal",
    priority: 3,
    observationIntervalMs: 60_000,
    ...overrides,
  };
}
function demand(id: string, priority = 3, overrides: Partial<QueueDemand> = {}): QueueDemand {
  return { ...goal(id), revision: 1, priority, ...overrides };
}
function observed(spec: PilotSpec, levelId = "initial"): Envelope<PilotObservation> {
  return {
    status: 200,
    message: "",
    payload: {
      current: { objectiveId: spec.objectiveId, levelId },
      problems: [],
      gapSummary: "",
      observedAt: new Date().toISOString(),
      versions: { [spec.objectiveId]: spec.version },
    },
  };
}
function outcome(
  input: RegulationInput,
  stopReason: RegulationOutcome["stopReason"] = "target-reached",
  stalledRuns = 0,
): RegulationOutcome {
  return {
    stopReason,
    iterations: 1,
    stalledRuns,
    latestObservation: observed(
      input.spec.pilot,
      stopReason === "target-reached" ? "terminal" : "initial",
    ),
  };
}
const resource: AgentResource = {
  id: "one",
  binding: { id: "worker" },
  capacity: 1,
  capabilities: ["code"],
};
const authorizationRequest = {
  id: "denied-1",
  operation: "execute",
  resources: [],
  reason: "Command is not granted.",
} as const;
const permissionPolicy: RegulationPermissions = {
  ceiling: [{ id: "repair", operation: "execute", command: "node repair.js" }],
  grants: [],
};
async function harness(
  demands: readonly QueueDemand[],
  options: {
    maxConcurrency?: number;
    resources?: readonly AgentResource[];
    abortGraceMs?: number;
    kill?: () => Promise<void>;
    onEvent?: (event: CoordinatorEvent) => Promise<void>;
    permissions?: RegulationPermissions;
    permissionUpdates?: SubscriptionRef.SubscriptionRef<RegulationPermissions | undefined>;
  } = {},
) {
  const queue = await Effect.runPromise(
    SubscriptionRef.make<PriorityQueueSnapshot>({ revision: 1, demands }),
  );
  const resources = await Effect.runPromise(
    SubscriptionRef.make<readonly AgentResource[]>(options.resources ?? [resource]),
  );
  const executions: {
    input: RegulationInput;
    resource: AgentResource;
    completion: ReturnType<typeof deferred<RegulationOutcome>>;
    aborted: boolean;
    killed: boolean;
  }[] = [];
  const events: CoordinatorEvent[] = [];
  const coordinator = await createPortfolioCoordinator({
    queue,
    resources,
    maxConcurrency: options.maxConcurrency ?? 1,
    abortGraceMs: options.abortGraceMs ?? 5,
    quota: { timeoutMs: 1000, maxAgentRuns: 2, maxStallRuns: 2 },
    agentExecutionLimits: { timeoutMs: 100 },
    ...(options.permissions ? { permissions: options.permissions } : {}),
    ...(options.permissionUpdates ? { permissionUpdates: options.permissionUpdates } : {}),
    onEvent: (event) => {
      events.push(event);
      return options.onEvent?.(event);
    },
    runner: {
      start(input, selected) {
        const execution = {
          input,
          resource: selected,
          completion: deferred<RegulationOutcome>(),
          aborted: false,
          killed: false,
        };
        executions.push(execution);
        return {
          result: execution.completion.promise,
          abort() {
            execution.aborted = true;
          },
          async kill() {
            execution.killed = true;
            await options.kill?.();
          },
        };
      },
    },
  });
  let revision = 1;
  return {
    coordinator,
    executions,
    events,
    resources,
    update: (next: readonly QueueDemand[]) =>
      Effect.runPromise(SubscriptionRef.set(queue, { revision: ++revision, demands: next })),
  };
}

test("authorization block survives priority, revision, resource identity and equivalent grant updates", async () => {
  const policy = { ...permissionPolicy, grants: ["repair"] };
  const permissionUpdates = await Effect.runPromise(
    SubscriptionRef.make<RegulationPermissions | undefined>(policy),
  );
  const h = await harness([demand("a")], { permissionUpdates });
  try {
    await until(() => h.executions.length === 1);
    const first = required(h.executions[0]);
    assert.deepEqual(first.input.permissions, policy);
    // Irrelevant revisions arriving during a run must not discard its blocked signature.
    await h.update([demand("a", 0, { revision: 2 })]);
    first.completion.resolve({
      ...outcome(first.input, "authorization-required"),
      authorizationRequests: [authorizationRequest],
    });
    await until(async () => (await read(h.coordinator.state)).runs.length === 0);
    await h.update([demand("a", 1, { revision: 3 })]);
    await Effect.runPromise(
      SubscriptionRef.set(h.resources, [
        { ...resource, id: "replacement", binding: { id: "other" } },
      ]),
    );
    await Effect.runPromise(
      SubscriptionRef.set(permissionUpdates, {
        ceiling: [
          { id: "unused", operation: "read", resources: ["/workspace/file"] },
          { id: "renamed", operation: "execute", command: "node repair.js" },
        ],
        grants: ["renamed"],
      }),
    );
    await delay(30);
    assert.equal(h.executions.length, 1);
    assert.equal((await read(h.coordinator.state)).error, undefined);
    await h.update([demand("a", 1, { revision: 4, subject: { changed: true } })]);
    await until(() => h.executions.length === 2);
  } finally {
    await h.coordinator.close();
  }
});

test("effective permission changes retry blocked demand with a new frozen policy, never the old snapshot", async () => {
  const permissionUpdates = await Effect.runPromise(
    SubscriptionRef.make<RegulationPermissions | undefined>(permissionPolicy),
  );
  const h = await harness([demand("a")], { permissionUpdates });
  try {
    await until(() => h.executions.length === 1);
    const first = required(h.executions[0]);
    first.completion.resolve({
      ...outcome(first.input, "authorization-required"),
      authorizationRequests: [authorizationRequest],
    });
    await until(async () => (await read(h.coordinator.state)).runs.length === 0);
    await Effect.runPromise(
      SubscriptionRef.set(permissionUpdates, { ...permissionPolicy, grants: ["repair"] }),
    );
    await until(() => h.executions.length === 2);
    assert.deepEqual(first.input.permissions?.grants, []);
    assert.deepEqual(required(h.executions[1]).input.permissions?.grants, ["repair"]);
    assert.ok(Object.isFrozen(required(h.executions[1]).input.permissions));
  } finally {
    await h.coordinator.close();
  }
});

test("removing live permission policy cancels old authority and ignores its late result", async () => {
  const granted = { ...permissionPolicy, grants: ["repair"] };
  const permissionUpdates = await Effect.runPromise(
    SubscriptionRef.make<RegulationPermissions | undefined>(granted),
  );
  const h = await harness([demand("a")], {
    permissions: granted,
    permissionUpdates,
    abortGraceMs: 5,
  });
  try {
    await until(() => h.executions.length === 1);
    const first = required(h.executions[0]);
    await Effect.runPromise(SubscriptionRef.set(permissionUpdates, undefined));
    await until(() => first.aborted && h.executions.length === 2);
    assert.deepEqual(required(h.executions[1]).input.permissions, { ceiling: [], grants: [] });
    first.completion.resolve(outcome(first.input));
    await delay(20);
    assert.equal(h.events.filter((event) => event.type === "result").length, 0);
    assert.deepEqual(first.input.permissions, granted);
  } finally {
    await h.coordinator.close();
  }
});

test("quota-exhausted unresolved authorization does not create an automatic continuation loop", async () => {
  const h = await harness([demand("a")]);
  try {
    await until(() => h.executions.length === 1);
    required(h.executions[0]).completion.resolve({
      ...outcome(required(h.executions[0]).input, "exhausted"),
      exhaustedBy: "agent-runs",
      authorizationRequests: [authorizationRequest],
    });
    await until(async () => (await read(h.coordinator.state)).runs.length === 0);
    await h.update([demand("a", 0, { revision: 2 })]);
    await delay(30);
    assert.equal(h.executions.length, 1);
    await h.update([demand("a", 0, { revision: 3, targetLevel: "ready" })]);
    await until(() => h.executions.length === 2);
  } finally {
    await h.coordinator.close();
  }
});

test("authorization feedback reaches planner without grants and cannot self-authorize", async () => {
  const received: CoordinatorEvent[] = [];
  let selfGrant = false;
  const planner = await createPortfolioPlanner({
    goals: [goal("a")],
    periodic: false,
    observe: async (entry) => observed(entry.pilot),
    policy: async (input) => {
      received.push(...input.events);
      assert.equal(JSON.stringify(input).includes('"ceiling"'), false);
      return {
        directives: input.candidates.map((entry) => ({
          goalId: entry.id,
          priority: entry.priority,
          ...(selfGrant ? { permissions: { ceiling: [], grants: ["repair"] } } : {}),
        })),
      };
    },
  });
  const h = await harness((await read(planner.queue)).demands, {
    permissions: permissionPolicy,
    onEvent: (event) => planner.feedback(event),
  });
  try {
    await until(() => h.executions.length === 1);
    const first = required(h.executions[0]);
    h.coordinator.reportAuthorizationRequest(first.input, authorizationRequest);
    h.coordinator.reportAuthorizationRequest(first.input, authorizationRequest);
    await until(() => received.some((event) => event.type === "authorization-request"));
    assert.equal(received.filter((event) => event.type === "authorization-request").length, 1);
    first.completion.resolve({
      ...outcome(first.input, "authorization-required"),
      authorizationRequests: [authorizationRequest],
    });
    await until(() => received.some((event) => event.type === "result"));
    assert.equal((await read(planner.queue)).demands.length, 1);
    h.coordinator.reportAuthorizationRequest(first.input, {
      ...authorizationRequest,
      id: "late",
    });
    await delay(10);
    assert.equal(received.filter((event) => event.type === "authorization-request").length, 1);
    selfGrant = true;
    await assert.rejects(planner.refresh(), /Unsupported planner directive fields/);
    assert.deepEqual(first.input.permissions?.grants, []);
  } finally {
    await h.coordinator.close();
    await planner.close();
  }
});

test("queue goals cannot smuggle permission policy and malformed initial policy cannot launch", async () => {
  await assert.rejects(
    harness([{ ...demand("a"), permissions: permissionPolicy } as QueueDemand]),
    /Invalid objective goal/,
  );
  await assert.rejects(
    harness([demand("a")], { permissions: { ...permissionPolicy, grants: ["self-granted"] } }),
    /existing ceiling IDs/,
  );
});

test("malformed live grant selection stops active work and suspends launches until repaired", async () => {
  const permissionUpdates = await Effect.runPromise(
    SubscriptionRef.make<RegulationPermissions | undefined>({
      ...permissionPolicy,
      grants: ["repair"],
    }),
  );
  const h = await harness([demand("a")], { permissionUpdates });
  try {
    await until(() => h.executions.length === 1);
    await Effect.runPromise(
      SubscriptionRef.set(permissionUpdates, { ceiling: [], grants: ["outside-ceiling"] }),
    );
    await until(() => required(h.executions[0]).aborted && required(h.executions[0]).killed);
    await delay(20);
    assert.equal(h.executions.length, 1);
    assert.ok((await read(h.coordinator.state)).error);
    await Effect.runPromise(SubscriptionRef.set(permissionUpdates, undefined));
    await until(() => h.executions.length === 2);
    assert.deepEqual(required(h.executions[1]).input.permissions, { ceiling: [], grants: [] });
  } finally {
    await h.coordinator.close();
  }
});
test("resource capacity two and live load enforce global/per-resource ceilings", async () => {
  const h = await harness([demand("a"), demand("b"), demand("c")], {
    maxConcurrency: 3,
    resources: [{ ...resource, capacity: 2 }],
  });
  try {
    await until(async () => {
      const state = await read(h.coordinator.state);
      if (state.error) throw state.error;
      const failure = state.events.find((event) => event.type === "failed");
      if (failure?.type === "failed") throw failure.error;
      return h.executions.length === 2;
    });
    await delay(20);
    assert.equal(h.executions.length, 2);
    required(h.executions[0]).completion.resolve(outcome(required(h.executions[0]).input));
    await until(() => h.executions.length === 3);
    assert.equal((await read(h.coordinator.state)).runs.length, 2);
  } finally {
    await h.coordinator.close();
  }
});

test("ordinary priority changes do not preempt; completion is suppressed on stale Behavior", async () => {
  const h = await harness([demand("a", 1), demand("b", 2)]);
  try {
    await until(() => h.executions.length === 1);
    await h.update([demand("b", 1), demand("a", 9)]);
    await delay(20);
    assert.equal(required(h.executions[0]).aborted, false);
    required(h.executions[0]).completion.resolve(outcome(required(h.executions[0]).input));
    await until(() => h.executions.length === 2);
    required(h.executions[1]).completion.resolve(outcome(required(h.executions[1]).input));
    await until(async () => (await read(h.coordinator.state)).runs.length === 0);
    await h.update([demand("a"), demand("b")]);
    await delay(20);
    assert.equal(h.executions.length, 2);
    await h.update([demand("a", 3, { revision: 2 })]);
    await until(() => h.executions.length === 3);
  } finally {
    await h.coordinator.close();
  }
});

test("P0 waits for abort grace and confirmed kill, retains FIFO and deduplicates notices", async () => {
  const gate = deferred<void>();
  const h = await harness([demand("a")], { abortGraceMs: 20, kill: () => gate.promise });
  try {
    await until(() => h.executions.length === 1);
    await h.update([demand("a"), demand("first", 0), demand("second", 0)]);
    await until(() => required(h.executions[0]).aborted);
    assert.equal(required(h.executions[0]).killed, false);
    await until(() => required(h.executions[0]).killed);
    assert.equal(h.executions.length, 1);
    assert.equal(required((await read(h.coordinator.state)).runs[0]).status, "stopping");
    await h.update([demand("second", 0), demand("first", 0), demand("a")]);
    await delay(10);
    assert.equal(
      h.events.filter((event) => event.type === "p0-queued" && event.demand.id === "first").length,
      1,
    );
    gate.resolve();
    await until(() => h.executions.length === 2);
    assert.equal(
      required(h.executions[1]).input.spec.pilot.objectiveId,
      pilot("first").objectiveId,
    );
    required(h.executions[1]).completion.resolve(outcome(required(h.executions[1]).input));
    await until(() => h.executions.length === 3);
    assert.equal(
      required(h.executions[2]).input.spec.pilot.objectiveId,
      pilot("second").objectiveId,
    );
  } finally {
    gate.resolve();
    await h.coordinator.close();
  }
});

test("P0 preempts only one necessary lower run and never an equal-priority run", async () => {
  const h = await harness([demand("a"), demand("b")], {
    maxConcurrency: 2,
    resources: [{ ...resource, capacity: 2 }],
  });
  try {
    await until(() => h.executions.length === 2);
    await h.update([demand("urgent", 0), demand("a"), demand("b")]);
    await until(() => h.executions.length === 3);
    assert.equal(h.executions.slice(0, 2).filter((entry) => entry.aborted).length, 1);
    await h.update([demand("next", 0), demand("urgent", 0)]);
    await until(() => h.executions.length === 4);
    assert.equal(required(h.executions[2]).aborted, false);
  } finally {
    await h.coordinator.close();
  }
});

test("exhausted demand yields and resumes with retained stalls/latest resource snapshot", async () => {
  const h = await harness([demand("a")]);
  try {
    await until(() => h.executions.length === 1);
    const newer = { ...resource, id: "two", binding: { id: "new-worker" } };
    await Effect.runPromise(SubscriptionRef.set(h.resources, [newer]));
    required(h.executions[0]).completion.resolve(
      outcome(required(h.executions[0]).input, "exhausted", 4),
    );
    assert.equal(h.executions.length, 1);
    await until(() => h.executions.length === 2);
    assert.equal(required(h.executions[1]).input.history?.stalledRuns, 4);
    assert.equal(required(h.executions[1]).resource.id, "two");
  } finally {
    await h.coordinator.close();
  }
});

test("stale completion cannot complete a superseding specification", async () => {
  const h = await harness([demand("a")]);
  try {
    await until(() => h.executions.length === 1);
    const changed = demand("a", 3, {
      revision: 2,
      pilot: { ...pilot("a"), version: "2".repeat(40) },
    });
    await h.update([changed]);
    await until(() => h.executions.length === 2);
    required(h.executions[0]).completion.resolve(outcome(required(h.executions[0]).input));
    await delay(10);
    assert.equal(required((await read(h.coordinator.state)).runs[0]).demand.revision, 2);
    assert.equal(h.events.filter((event) => event.type === "result").length, 0);
  } finally {
    await h.coordinator.close();
  }
});

test("canonical subjects serialize and deduplicate equivalent objective demands", async () => {
  const a = demand("a", 2, { pilot: pilot("same"), subject: { a: 1, b: { c: 2, d: 3 } } });
  const b = demand("b", 1, { pilot: pilot("same"), subject: { b: { d: 3, c: 2 }, a: 1 } });
  assert.equal(objectiveKey(a), objectiveKey(b));
  const h = await harness([a, b], { maxConcurrency: 2, resources: [{ ...resource, capacity: 2 }] });
  try {
    await until(() => h.executions.length === 1);
    required(h.executions[0]).completion.resolve(outcome(required(h.executions[0]).input));
    await delay(30);
    assert.equal(h.executions.length, 1);
  } finally {
    await h.coordinator.close();
  }
});

test("capability requests are deduplicated and new resources unblock work", async () => {
  const h = await harness([demand("a", 3, { requirements: ["special"] })]);
  try {
    await until(() => h.events.some((event) => event.type === "capability-request"));
    await h.update([demand("a", 3, { requirements: ["special"] })]);
    await delay(10);
    assert.equal(h.events.filter((event) => event.type === "capability-request").length, 1);
    await Effect.runPromise(
      SubscriptionRef.set(h.resources, [{ ...resource, capabilities: ["special"] }]),
    );
    await until(() => h.executions.length === 1);
  } finally {
    await h.coordinator.close();
  }
});

test("failed kill retains occupied resources and surfaces error", async () => {
  const h = await harness([demand("a")], {
    kill: async () => {
      throw new Error("kill failed");
    },
  });
  await until(() => h.executions.length === 1);
  await h.update([demand("a"), demand("urgent", 0)]);
  await until(async () => (await read(h.coordinator.state)).error !== undefined);
  assert.equal(h.executions.length, 1);
  assert.equal((await read(h.coordinator.state)).runs.length, 1);
  required(h.executions[0]).completion.resolve(outcome(required(h.executions[0]).input));
  await assert.rejects(h.coordinator.close(), /kill failed/);
});

test("planner observes successful goals at cadence and queues only later regression/spec changes", async () => {
  let level = "terminal";
  let count = 0;
  const root = goal("root", { observationIntervalMs: 20 });
  const planner = await createPortfolioPlanner({
    goals: [root],
    observe: async (entry) => {
      count++;
      return observed(entry.pilot, level);
    },
  });
  try {
    assert.equal((await read(planner.queue)).demands.length, 0);
    await until(() => count >= 2);
    level = "initial";
    await until(async () => (await read(planner.queue)).demands.length === 1);
    const old = required((await read(planner.queue)).demands[0]);
    level = "terminal";
    await planner.feedback({
      type: "result",
      demand: old,
      outcome: {
        stopReason: "target-reached",
        iterations: 1,
        stalledRuns: 0,
        latestObservation: observed(root.pilot, "terminal"),
      },
    });
    assert.equal((await read(planner.queue)).demands.length, 0);
    level = "initial";
    await planner.updateGoals([{ ...root, pilot: { ...root.pilot, version: "2" } }]);
    const next = required((await read(planner.queue)).demands[0]);
    assert.ok(next.revision > old.revision);
    await planner.feedback({
      type: "result",
      demand: old,
      outcome: {
        stopReason: "target-reached",
        iterations: 1,
        stalledRuns: 0,
        latestObservation: observed(root.pilot, "terminal"),
      },
    });
    assert.equal(required((await read(planner.queue)).demands[0]).revision, next.revision);
  } finally {
    await planner.close();
  }
});

test("planner deduplicates canonical registrations and priority-only updates preserve demand revision", async () => {
  const one = goal("one", { pilot: pilot("same"), subject: { x: 1, y: 2 } });
  const planner = await createPortfolioPlanner({
    goals: [one, { ...one, id: "two", subject: { y: 2, x: 1 }, priority: 1 }],
    periodic: false,
    observe: async (entry) => observed(entry.pilot),
  });
  try {
    const initial = (await read(planner.queue)).demands;
    assert.equal(initial.length, 1);
    assert.equal(required(initial[0]).priority, 1);
    await planner.updateGoals([{ ...one, priority: 0 }]);
    assert.equal(
      required((await read(planner.queue)).demands[0]).revision,
      required(initial[0]).revision,
    );
  } finally {
    await planner.close();
  }
});

test("two roots merge known shared direct prerequisite at highest target then re-observe roots", async () => {
  const child = pilot("shared");
  const root = (id: string) => {
    const spec = pilot(id);
    return goal(id, {
      subject: { shared: "common", root: id },
      pilot: {
        ...spec,
        prerequisite: child,
        manifest: {
          ...spec.manifest,
          prerequisite: {
            manifestUri: "shared",
            subject: '{"key": shared}',
            minimumLevelId: "ready",
          },
        },
      },
    });
  };
  let childReady = false;
  const planner = await createPortfolioPlanner({
    goals: [root("a"), root("b")],
    periodic: false,
    observe: async (entry) =>
      observed(
        entry.pilot,
        childReady && entry.id.startsWith("prerequisite:") ? "terminal" : "initial",
      ),
  });
  try {
    const [a, b] = (await read(planner.queue)).demands;
    const dependency = (entry: QueueDemand, minimumLevelId: string): CoordinatorEvent => ({
      type: "result",
      demand: entry,
      outcome: {
        stopReason: "prerequisite-unmet",
        iterations: 0,
        stalledRuns: 0,
        latestObservation: observed(child),
        prerequisite: { spec: child, subject: { key: "common" }, minimumLevelId },
      },
    });
    await planner.feedback(dependency(required(a), "ready"));
    await planner.feedback(dependency(required(b), "terminal"));
    const demands = (await read(planner.queue)).demands;
    assert.equal(demands.length, 1);
    assert.equal(required(demands[0]).pilot.objectiveId, child.objectiveId);
    assert.equal(required(demands[0]).targetLevel, "terminal");
    childReady = true;
    await planner.feedback({
      type: "result",
      demand: required(demands[0]),
      outcome: {
        stopReason: "target-reached",
        iterations: 1,
        stalledRuns: 0,
        latestObservation: observed(child, "terminal"),
      },
    });
    assert.deepEqual((await read(planner.queue)).demands.map((entry) => entry.id).sort(), [
      "a",
      "b",
    ]);
  } finally {
    await planner.close();
  }
});

test("malformed/rejected policies surface errors, never silently use a fallback", async () => {
  await assert.rejects(
    createPortfolioPlanner({
      goals: [goal("a")],
      periodic: false,
      observe: async (entry) => observed(entry.pilot),
      policy: async () => ({ directives: [{ goalId: "unknown", priority: 0 }] }),
    }),
    /unique eligible goal/,
  );
  await assert.rejects(
    createPortfolioPlanner({
      goals: [goal("a")],
      periodic: false,
      observe: async (entry) => observed(entry.pilot),
      policy: async () => {
        throw new Error("policy rejected");
      },
    }),
    /policy rejected/,
  );
});

test("all queued P0 demands notify immediately and a running promotion is not preempted", async () => {
  const h = await harness([demand("a", 2)]);
  try {
    await until(() => h.executions.length === 1);
    await h.update([demand("a", 0), demand("first", 0), demand("second", 0)]);
    await until(() => h.events.filter((event) => event.type === "p0-queued").length === 2);
    await delay(15);
    assert.equal(required(h.executions[0]).aborted, false);
    assert.deepEqual(
      h.events.filter((event) => event.type === "p0-queued").map((event) => event.demand.id),
      ["first", "second"],
    );
  } finally {
    await h.coordinator.close();
  }
});

test("confirmed abort completion releases before grace without calling kill", async () => {
  const h = await harness([demand("a")], { abortGraceMs: 100 });
  try {
    await until(() => h.executions.length === 1);
    await h.update([demand("a"), demand("urgent", 0)]);
    await until(() => required(h.executions[0]).aborted);
    required(h.executions[0]).completion.reject(new Error("aborted and process exited"));
    await until(() => h.executions.length === 2);
    assert.equal(required(h.executions[0]).killed, false);
    required(h.executions[1]).completion.resolve(outcome(required(h.executions[1]).input));
    await h.update([]);
  } finally {
    await h.coordinator.close();
  }
});

test("runner capability notifications bind to exact live input and ignore stale runs", async () => {
  const h = await harness([demand("a")]);
  try {
    await until(() => h.executions.length === 1);
    const original = required(h.executions[0]).input;
    const request = { capability: "publish", reason: "deployment approval needed" };
    h.coordinator.reportCapabilityRequest(original, request);
    h.coordinator.reportCapabilityRequest(original, request);
    await until(() => h.events.some((event) => event.type === "capability-request"));
    assert.equal(h.events.filter((event) => event.type === "capability-request").length, 1);
    await h.update([
      demand("a", 3, { revision: 2, pilot: { ...pilot("a"), version: "2".repeat(40) } }),
    ]);
    await until(() => h.executions.length === 2);
    h.coordinator.reportCapabilityRequest(original, { ...request, capability: "other" });
    assert.equal(h.events.filter((event) => event.type === "capability-request").length, 1);
  } finally {
    await h.coordinator.close();
  }
});

test("exhausted retry reconsiders priority instead of immediately reclaiming its slot", async () => {
  const h = await harness([demand("a", 1), demand("b", 2)]);
  try {
    await until(() => h.executions.length === 1);
    await h.update([demand("a", 3), demand("b", 1)]);
    required(h.executions[0]).completion.resolve(
      outcome(required(h.executions[0]).input, "exhausted", 7),
    );
    await until(() => h.executions.length === 2);
    assert.equal(required(h.executions[1]).input.spec.pilot.objectiveId, pilot("b").objectiveId);
  } finally {
    await h.coordinator.close();
  }
});

test("quota exhaustion before an observation remains normal eligible planner demand", async () => {
  const planner = await createPortfolioPlanner({
    goals: [goal("a")],
    periodic: false,
    observe: async (entry) => observed(entry.pilot),
  });
  try {
    const active = required((await read(planner.queue)).demands[0]);
    await planner.feedback({
      type: "result",
      demand: active,
      outcome: {
        stopReason: "exhausted",
        exhaustedBy: "time",
        iterations: 0,
        stalledRuns: 3,
        latestObservation: { status: 408, payload: null, message: "deadline before observation" },
      },
    });
    assert.equal(required((await read(planner.queue)).demands[0]).revision, active.revision);
    assert.equal((await read(planner.state)).error, undefined);
  } finally {
    await planner.close();
  }
});

test("observed prerequisite satisfaction renews blocked root without requiring a child run result", async () => {
  const child = pilot("child");
  const root = goal("root");
  const registered = {
    ...root,
    pilot: {
      ...root.pilot,
      prerequisite: child,
      manifest: {
        ...root.pilot.manifest,
        prerequisite: { manifestUri: child.objectiveId, subject: "$", minimumLevelId: "ready" },
      },
    },
  };
  let childLevel = "initial";
  const planner = await createPortfolioPlanner({
    goals: [registered],
    periodic: false,
    observe: async (entry) =>
      observed(entry.pilot, entry.pilot.objectiveId === child.objectiveId ? childLevel : "initial"),
  });

  try {
    const active = required((await read(planner.queue)).demands[0]);
    await planner.feedback({
      type: "result",
      demand: active,
      outcome: {
        stopReason: "prerequisite-unmet",
        iterations: 0,
        stalledRuns: 0,
        latestObservation: observed(child),
        prerequisite: { spec: child, subject: {}, minimumLevelId: "ready" },
      },
    });
    assert.equal(
      required((await read(planner.queue)).demands[0]).pilot.objectiveId,
      child.objectiveId,
    );
    childLevel = "ready";
    await planner.refresh();
    const renewed = (await read(planner.queue)).demands;
    assert.equal(renewed.length, 1);
    assert.equal(required(renewed[0]).id, root.id);
    assert.ok(required(renewed[0]).revision > active.revision);
  } finally {
    await planner.close();
  }
});

test("target update with a canonically equal subject preserves serialization but isolates old completion", async () => {
  const h = await harness([demand("a", 3, { targetLevel: "ready", subject: { x: 1, y: 2 } })]);
  try {
    await until(() => h.executions.length === 1);
    await h.update([
      demand("a", 3, { revision: 2, targetLevel: "terminal", subject: { y: 2, x: 1 } }),
    ]);
    await delay(15);
    assert.equal(h.executions.length, 1);
    assert.equal(required(h.executions[0]).aborted, false);
    required(h.executions[0]).completion.resolve({
      ...outcome(required(h.executions[0]).input),
      latestObservation: observed(required(h.executions[0]).input.spec.pilot, "ready"),
    });
    await until(() => h.executions.length === 2);
    assert.equal(required(h.executions[1]).input.spec.strategy.targetLevel, "terminal");
    assert.equal(h.events.filter((event) => event.type === "result").length, 0);
  } finally {
    await h.coordinator.close();
  }
});

test("prerequisite-blocked revisions never auto retry, even when only the queue snapshot changes", async () => {
  const h = await harness([demand("a")]);
  try {
    await until(() => h.executions.length === 1);
    required(h.executions[0]).completion.resolve({
      ...outcome(required(h.executions[0]).input, "prerequisite-unmet"),
      prerequisite: { spec: pilot("child"), subject: {}, minimumLevelId: "ready" },
    });
    await until(async () => (await read(h.coordinator.state)).runs.length === 0);
    await delay(20);
    await h.update([demand("a", 0)]);
    await delay(20);
    assert.equal(h.executions.length, 1);
    await h.update([demand("a", 0, { revision: 2 })]);
    await until(() => h.executions.length === 2);
  } finally {
    await h.coordinator.close();
  }
});

test("planner goal removal publishes an empty queue and late feedback cannot resurrect it", async () => {
  const planner = await createPortfolioPlanner({
    goals: [goal("a")],
    periodic: false,
    observe: async (entry) => observed(entry.pilot),
  });
  try {
    const before = await read(planner.queue);
    const active = required(before.demands[0]);
    await planner.updateGoals([]);
    const removed = await read(planner.queue);
    assert.ok(removed.revision > before.revision);
    assert.deepEqual(removed.demands, []);
    await planner.feedback({
      type: "result",
      demand: active,
      outcome: {
        stopReason: "exhausted",
        exhaustedBy: "stall",
        iterations: 1,
        stalledRuns: 4,
        latestObservation: observed(active.pilot),
      },
    });
    assert.deepEqual((await read(planner.queue)).demands, []);
  } finally {
    await planner.close();
  }
});

test("live worker capability requests reach the replaceable planner policy without provisioning", async () => {
  const received: CoordinatorEvent[] = [];
  const planner = await createPortfolioPlanner({
    goals: [goal("a")],
    periodic: false,
    observe: async (entry) => observed(entry.pilot),
    policy: async (input) => {
      received.push(...input.events);
      return {
        directives: input.candidates.map((entry) => ({
          goalId: entry.id,
          priority: entry.priority,
        })),
      };
    },
  });
  const h = await harness((await read(planner.queue)).demands, {
    onEvent: (event) => planner.feedback(event),
  });
  try {
    await until(() => h.executions.length === 1);
    h.coordinator.reportCapabilityRequest(required(h.executions[0]).input, {
      capability: "approval",
      reason: "requires human authorization",
    });
    await until(() => received.some((event) => event.type === "capability-request"));
    const request = received.find((event) => event.type === "capability-request");
    assert.equal(request?.type, "capability-request");
    if (request?.type === "capability-request") {
      assert.deepEqual(request.requirements, ["approval"]);
      assert.equal(request.reason, "requires human authorization");
    }
    assert.deepEqual(await read(h.resources), [resource]);
    assert.equal(h.executions.length, 1);
  } finally {
    await h.coordinator.close();
    await planner.close();
  }
});

test("automatic exhausted continuation grants another actual Agent round despite carried stalls", async () => {
  const queue = await Effect.runPromise(
    SubscriptionRef.make<PriorityQueueSnapshot>({ revision: 1, demands: [demand("a")] }),
  );
  const resources = await Effect.runPromise(
    SubscriptionRef.make<readonly AgentResource[]>([resource]),
  );
  let agentCalls = 0;
  const inputs: RegulationInput[] = [];
  const results: RegulationOutcome[] = [];
  const coordinator = await createPortfolioCoordinator({
    queue,
    resources,
    maxConcurrency: 1,
    abortGraceMs: 10,
    quota: { timeoutMs: 1000, maxAgentRuns: 5, maxStallRuns: 1 },
    agentExecutionLimits: { timeoutMs: 100 },
    onEvent: async (event) => {
      if (event.type === "result") {
        results.push(event.outcome);
        if (results.length === 2)
          await Effect.runPromise(SubscriptionRef.set(queue, { revision: 2, demands: [] }));
      }
    },
    runner: {
      start(input) {
        inputs.push(input);
        const controller = new AbortController();
        const result = Effect.runPromise(
          regulate(input, {
            pilot: {
              resolveCheck: () => async () => ({
                status: 200,
                payload: { ok: false, problems: [{ id: "missing", parameters: {} }] },
                message: "",
              }),
            },
            executeAgent: async () => {
              agentCalls++;
              return { status: "completed", summary: "no progress" };
            },
          }),
          { signal: controller.signal },
        );
        return {
          result,
          abort: () => controller.abort(),
          kill: async () => {
            controller.abort();
            await result.catch(() => undefined);
          },
        };
      },
    },
  });
  try {
    await until(() => results.length === 2);
    assert.equal(agentCalls, 2);
    assert.equal(required(results[0]).iterations, 1);
    assert.equal(required(results[1]).iterations, 1);
    assert.equal(required(inputs[1]).history?.stalledRuns, 1);
    assert.equal(required(results[1]).stalledRuns, 2);
  } finally {
    await coordinator.close();
  }
});
