import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Exit, SubscriptionRef } from "@potential-guide/effects";
import type { Envelope, PilotObservation, PilotSpec } from "@potential-guide/objective-pilot";
import {
  type BehaviorCoordinatorOptions,
  type CoordinatorStore,
  coordinator,
  coordinatorViews,
  CoordinatorModel as M,
  openCoordinatorStore,
  RequestModel as R,
  type RunnerContext,
  type RunResult,
} from "../src/index.js";

const limits = { timeoutMs: 1000, maxAgentRuns: 3, maxStallRuns: 2 };
const available: M.ResourceAllocation = {
  kind: "configured",
  bindings: [{ binding: { id: "agent", configuration: { model: "fixture" } }, capacity: 1 }],
};
function command(ref: string, subject = "subject"): R.RequestCommand {
  const source = {
    kind: "git-tree" as const,
    repository: "https://example.test/model.git",
    directory: "rules",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    repositoryTree: "c".repeat(40),
  };
  const spec: PilotSpec = {
    objectiveId: "git+https://example.test/model.git#rules/",
    version: source.tree,
    source,
    manifest: {
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
      subjectSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
      levels: [{ id: "ready", checks: [] }],
      languages: ["en"],
      defaultLanguage: "en",
    },
    locales: {
      en: {
        "system/404": {
          id: "system/404",
          title: "Missing",
          description: "",
          content: "",
          references: [],
        },
      },
    },
  };
  return {
    type: "request",
    requestRef: ref,
    subject: { name: subject },
    objective: spec,
    desiredLevel: "ready",
    priority: 0,
    origin: { kind: "external" },
  };
}
function observation(context: RunnerContext): Envelope<PilotObservation> {
  const spec = context.details.objectiveRevision.spec;
  assert.ok(spec.source);
  return {
    status: 200,
    message: "",
    payload: {
      current: { objectiveId: spec.objectiveId, levelId: "ready" },
      observedAt: "2026-10-23T12:00:00.000Z",
      problems: [],
      gapSummary: "",
      versions: { [spec.objectiveId]: spec.version },
      sources: { [spec.objectiveId]: spec.source },
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
function present<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > end) assert.fail("Timed out waiting for Coordinator.");
    await tick();
  }
}
function fixture(saved: M.CoordinatorState | null = null) {
  let snapshot = saved;
  const writes: M.CoordinatorState[] = [];
  let failSave = false;
  const errors: unknown[] = [];
  const starts: {
    context: RunnerContext;
    end: ReturnType<typeof deferred<RunResult>>;
    aborts: number;
    kills: number;
  }[] = [];
  let closes = 0;
  const store: CoordinatorStore = {
    load: async () => snapshot,
    save: async (state) => {
      if (failSave) throw new Error("Persistence unavailable.");
      snapshot = structuredClone(state);
      writes.push(snapshot);
    },
    close: async () => {
      closes++;
    },
  };
  const options: BehaviorCoordinatorOptions = {
    hostId: "host-a",
    store,
    limits,
    maxAttemptsPerRequest: 3,
    maxDependencyRequests: 16,
    abortGraceMs: 10,
    onError: (error) => {
      errors.push(error);
    },
    runner: {
      start: (context) => {
        const item = { context, end: deferred<RunResult>(), aborts: 0, kills: 0 };
        starts.push(item);
        return {
          result: item.end.promise,
          abort: async () => {
            item.aborts++;
          },
          kill: async () => {
            item.kills++;
            item.end.resolve({ outcome: { kind: "cancelled", message: "Killed." } });
          },
        };
      },
      recover: async () => ({ kind: "unknown" }),
    },
  };
  return {
    options,
    starts,
    errors,
    saved: () => snapshot,
    writes,
    closes: () => closes,
    failSave: () => {
      failSave = true;
    },
  };
}
function add(state: M.CoordinatorState, fact: M.CoordinatorFact): M.CoordinatorState {
  return M.reduceCoordinatorState(
    { revision: state.revision + 1, occurredAt: "2026-10-23T12:00:00Z", fact },
    state,
  );
}
function activeState(hostId = "host-a") {
  let state = add(M.createCoordinatorState(hostId), { type: "request", command: command("one") });
  state = add(state, { type: "resources", allocation: available });
  state = add(state, {
    type: "run-start",
    run: {
      id: `${hostId}:3`,
      requestRef: "one",
      hostBindingRevisionId: M.bindingRevisionId(hostId, {
        id: "agent",
        configuration: { model: "fixture" },
      }),
      resourceRevision: 2,
      limits,
    },
  });
  return add(state, { type: "run-phase", runId: `${hostId}:3`, phase: "running" });
}

test("pure state replay preserves run identity, resource history and unverified occupancy", () => {
  const running = activeState();
  const changed = add(running, { type: "resources", allocation: { kind: "no-resource" } });
  assert.equal(M.runViews(changed)[0]?.phase, "running");
  const unknown = add(changed, { type: "run-phase", runId: "host-a:3", phase: "unverified" });
  assert.equal(coordinatorViews([unknown]).hosts[0]?.occupancy, 1);
  assert.equal(M.bindingForRun(unknown, present(M.runViews(unknown)[0]).run).id, "agent");
  assert.deepEqual(M.restoreCoordinatorState(JSON.parse(JSON.stringify(unknown))), unknown);
  assert.throws(() => M.restoreCoordinatorState({ ...unknown, revision: 999 }), /differs/);
  assert.throws(
    () =>
      M.reduceCoordinatorState(
        { revision: 99, occurredAt: "bad", fact: { type: "resources", allocation: available } },
        unknown,
      ),
    /prefix/,
  );
  assert.throws(
    () => add(unknown, { type: "run-end", runId: "host-a:3", outcome: { kind: "target-reached" } }),
    /evidence/,
  );
});

test("views retain shared Request and separate contributions from two Hosts", () => {
  const a = activeState();
  const b = activeState("host-b");
  const views = coordinatorViews([a, b]);
  assert.equal(views.requests.length, 1);
  assert.equal(views.requests[0]?.runs.length, 2);
  assert.equal(views.requests[0]?.satisfaction, "undetermined");
  assert.equal(views.objectives.length, 1);
  assert.equal(views.targets.length, 1);
  assert.equal(views.hosts[0]?.contact.status, "unknown");
  assert.equal(views.hosts[1]?.occupancy, 1);
  assert.throws(() => coordinatorViews([a, a]), /one consistent snapshot/);
});

test("a store lease cannot be reused by concurrent Coordinator scopes", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>({
          kind: "no-resource",
        });
        const requests = yield* SubscriptionRef.make(R.createRegulationRequests());
        yield* coordinator(resources, requests, f.options);
        const duplicate = yield* Effect.exit(coordinator(resources, requests, f.options));
        assert.ok(Exit.isFailure(duplicate));
        assert.equal(f.closes(), 0);
      }),
    ),
  );
  assert.equal(f.closes(), 1);
});

test("resource and observation projections reproduce the same facts at every event prefix", () => {
  const first = activeState();
  const capacity = add(first, {
    type: "resources",
    allocation: {
      kind: "configured",
      bindings: [{ binding: { id: "agent", configuration: { model: "fixture" } }, capacity: 0 }],
    },
  });
  const changed = add(capacity, {
    type: "resources",
    allocation: {
      kind: "configured",
      bindings: [{ binding: { id: "agent", configuration: { model: "next" } }, capacity: 2 }],
    },
  });
  const facts = M.resourceFacts(changed);
  assert.equal(facts.bindings.length, 2);
  assert.equal(facts.revisions.length, 3);
  assert.equal(
    facts.revisions[0]?.members[0]?.hostBindingRevisionId,
    facts.revisions[1]?.members[0]?.hostBindingRevisionId,
  );
  assert.notEqual(
    facts.revisions[1]?.members[0]?.hostBindingRevisionId,
    facts.revisions[2]?.members[0]?.hostBindingRevisionId,
  );
  let prefix = M.createCoordinatorState("host-a");
  for (const event of changed.events) {
    prefix = M.reduceCoordinatorState(event, prefix);
    const replay = M.restoreCoordinatorState(JSON.parse(JSON.stringify(prefix)));
    assert.deepEqual(coordinatorViews([prefix]), coordinatorViews([replay]));
  }
  assert.deepEqual(M.bindingForRun(changed, present(M.runViews(changed)[0]).run).configuration, {
    model: "fixture",
  });
});

test("contacts and publications are explicit external observations, not inferred or frozen inputs", () => {
  const state = activeState();
  const details = R.requestDetails(state.requests, "one");
  const contact = {
    hostId: "host-a",
    status: "online" as const,
    lastContactAt: "2026-10-23T12:05:00Z",
    lastReceivedAt: "2026-10-23T12:04:00Z",
  };
  const publication = {
    objectiveKey: details.objective.key,
    objectiveRevisionKey: details.objectiveRevision.key,
    publishedAt: "2026-10-23T11:00:00Z",
  };
  const views = coordinatorViews([state], [contact], [publication]);
  assert.deepEqual(views.hosts[0]?.contact, contact);
  assert.deepEqual(views.objectives[0]?.latestPublishedRevision, publication);
  assert.equal(views.objectives[0]?.revisions.length, 1);
  assert.ok(!Object.isFrozen(contact));
  assert.ok(!Object.isFrozen(publication));
  assert.throws(
    () => coordinatorViews([state], [], [{ ...publication, objectiveRevisionKey: "unknown" }]),
    /unknown or inconsistent/,
  );
  assert.equal(coordinatorViews([state]).objectives[0]?.latestPublishedRevision, null);
});

test("dual Behaviors wake pending work, persist before start and never repeat completed requests", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>({
          kind: "no-resource",
        });

        test("npm package bindings cross actual runner, event, replay and query boundaries without a Git commit", async () => {
          const f = fixture();
          const original = command("npm-run");
          const packageDigest = `sha256-pguide-package-v1:${"d".repeat(64)}`;
          const objective: PilotSpec = {
            ...original.objective,
            objectiveId: "@fixture/behavior-objective",
            version: packageDigest,
            source: {
              kind: "npm-package",
              packageName: "@fixture/behavior-objective",
              packageDigest,
              version: "1.0.0",
              spec: "@fixture/behavior-objective@^1",
              resolved: "https://registry.example.test/behavior-objective-1.0.0.tgz",
              integrity: "sha512-fixture",
            },
          };
          await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
                const requests = yield* SubscriptionRef.make(
                  R.reduceRegulationRequests(
                    { ...original, objective },
                    R.createRegulationRequests(),
                  ),
                );
                const service = yield* coordinator(resources, requests, f.options);
                yield* Effect.promise(async () => {
                  await until(() => f.starts.length === 1);
                  const start = present(f.starts[0]);
                  assert.equal(
                    start.context.details.objectiveRevision.packageDigest,
                    packageDigest,
                  );
                  assert.equal(start.context.details.objectiveRevision.commit, undefined);
                  await start.context.report(observation(start.context));
                  start.end.resolve({ outcome: { kind: "target-reached" } });
                  await until(() => M.requestClosed(service.snapshot(), "npm-run"));
                  await service.flush();
                  const replay = M.restoreCoordinatorState(
                    JSON.parse(JSON.stringify(present(f.saved()))),
                  );
                  const views = coordinatorViews([replay]);
                  assert.deepEqual(views.objectives[0]?.objective.source, {
                    packageName: objective.objectiveId,
                  });
                  assert.equal(views.objectives[0]?.revisions[0]?.packageDigest, packageDigest);
                  assert.equal(
                    views.runs[0]?.observation?.sources?.[objective.objectiveId]?.kind,
                    "npm-package",
                  );
                  assert.deepEqual(coordinatorViews([service.snapshot()]), views);
                });
              }),
            ),
          );
          assert.deepEqual(f.errors, []);
        });
        const input = R.reduceRegulationRequests(command("one"), R.createRegulationRequests());
        const requests = yield* SubscriptionRef.make(input);
        const service = yield* coordinator(resources, requests, f.options);
        assert.equal(f.starts.length, 0);
        yield* SubscriptionRef.set(resources, available);
        yield* Effect.promise(async () => {
          await until(() => f.starts.length === 1);
          assert.ok(f.saved()?.events.some(({ fact }) => fact.type === "run-start"));
          const start = present(f.starts[0]);
          await start.context.report(observation(start.context));
          start.end.resolve({ outcome: { kind: "target-reached" } });
          await until(() => M.requestClosed(service.snapshot(), "one"));
          assert.equal(M.runViews(service.snapshot())[0]?.outcome?.kind, "target-reached");
        });
        yield* SubscriptionRef.set(resources, { kind: "no-resource" });
        yield* SubscriptionRef.set(resources, available);
        yield* SubscriptionRef.set(requests, structuredClone(input));
        yield* Effect.promise(async () => {
          await tick();
          await service.flush();
        });
        assert.equal(f.starts.length, 1);
      }),
    ),
  );
  assert.equal(f.closes(), 1);
  assert.deepEqual(f.errors, []);
});

test("initial is validated and closed without runner execution; same target updates preserve old run facts", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
        let input = R.reduceRegulationRequests(
          { ...command("empty"), desiredLevel: "initial" },
          R.createRegulationRequests(),
        );
        const requests = yield* SubscriptionRef.make(input);
        const service = yield* coordinator(resources, requests, f.options);
        assert.ok(M.requestClosed(service.snapshot(), "empty"));
        assert.equal(f.starts.length, 0);
        input = R.reduceRegulationRequests(command("one"), input);
        yield* SubscriptionRef.set(requests, input);
        yield* Effect.promise(() => until(() => f.starts.length === 1));
        input = R.reduceRegulationRequests(command("two"), input);
        yield* SubscriptionRef.set(requests, input);
        yield* Effect.promise(async () => {
          await until(() => M.requestClosed(service.snapshot(), "one"));
          assert.equal(f.starts.length, 1);
          present(f.starts[0]).end.resolve({
            outcome: { kind: "cancelled", message: "Ended old call." },
          });
          await until(() => f.starts.length === 2);
          assert.equal(f.starts[0]?.context.run.requestRef, "one");
          assert.equal(f.starts[1]?.context.run.requestRef, "two");
        });
      }),
    ),
  );
  assert.equal(f.starts[1]?.kills, 1);
});

test("resource changes do not rewrite existing bindings or release occupied capacity", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
        let input = R.reduceRegulationRequests(command("one"), R.createRegulationRequests());
        const requests = yield* SubscriptionRef.make(input);
        const service = yield* coordinator(resources, requests, f.options);
        yield* SubscriptionRef.set(resources, {
          kind: "configured",
          bindings: [{ binding: { id: "agent", configuration: { model: "new" } }, capacity: 0 }],
        });
        input = R.reduceRegulationRequests(command("two", "other"), input);
        yield* SubscriptionRef.set(requests, input);
        yield* Effect.promise(async () => {
          await until(() => service.snapshot().requests.requests.length === 2);
          assert.equal(f.starts.length, 1);
          assert.deepEqual(f.starts[0]?.context.binding.configuration, { model: "fixture" });
          assert.equal(coordinatorViews([service.snapshot()]).hosts[0]?.occupancy, 1);
          present(f.starts[0]).end.resolve({
            outcome: { kind: "blocked", message: "Resource denied." },
          });
          await until(() => M.requestClosed(service.snapshot(), "one"));
          assert.equal(f.starts.length, 1);
        });
        yield* SubscriptionRef.set(resources, available);
        yield* Effect.promise(() => until(() => f.starts.length === 2));
      }),
    ),
  );
});

test("unknown recovery keeps occupancy and prevents duplicate starts after restart", async () => {
  const f = fixture(activeState());
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
        const requests = yield* SubscriptionRef.make(
          R.reduceRegulationRequests(command("one"), R.createRegulationRequests()),
        );
        const service = yield* coordinator(resources, requests, f.options);
        assert.equal(M.runViews(service.snapshot())[0]?.phase, "unverified");
        assert.equal(f.starts.length, 0);
        assert.equal(coordinatorViews([service.snapshot()]).hosts[0]?.occupancy, 1);
        assert.equal(f.errors.length, 1);
      }),
    ),
  );
});

test("recovered actual exit closes old request without restarting or replaying side effects", async () => {
  const f = fixture(activeState());
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
        const requests = yield* SubscriptionRef.make(
          R.reduceRegulationRequests(command("one"), R.createRegulationRequests()),
        );
        const service = yield* coordinator(resources, requests, {
          ...f.options,
          runner: {
            ...f.options.runner,
            recover: async () => ({
              kind: "ended",
              result: { outcome: { kind: "blocked", message: "Previously exited." } },
            }),
          },
        });
        assert.equal(f.starts.length, 0);
        assert.ok(M.requestClosed(service.snapshot(), "one"));
        assert.equal(coordinatorViews([service.snapshot()]).hosts[0]?.occupancy, 0);
      }),
    ),
  );
});

test("dependency result creates provider request before its Run and resumes consumer with a new Run", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
        const requests = yield* SubscriptionRef.make(
          R.reduceRegulationRequests(command("one"), R.createRegulationRequests()),
        );
        const service = yield* coordinator(resources, requests, f.options);
        yield* Effect.promise(async () => {
          present(f.starts[0]).end.resolve({
            outcome: { kind: "blocked", message: "Needs provider." },
            dependencies: [
              {
                ...command("provider", "provider-subject"),
                origin: { kind: "dependency", consumerRequestRef: "one" },
              },
            ],
          });
          await until(() => f.starts.length === 2);
          const provider = present(f.starts[1]);
          assert.equal(provider.context.run.requestRef, "provider");
          assert.ok(service.snapshot().requests.requests.some(({ ref }) => ref === "provider"));
          provider.end.resolve({
            outcome: { kind: "target-reached" },
            observation: observation(provider.context),
          });
          await until(() => f.starts.length === 3);
          const consumer = present(f.starts[2]);
          assert.equal(consumer.context.run.requestRef, "one");
          assert.notEqual(consumer.context.run.id, present(f.starts[0]).context.run.id);
          consumer.end.resolve({
            outcome: { kind: "target-reached" },
            observation: observation(consumer.context),
          });
          await until(() => M.requestClosed(service.snapshot(), "one"));
          for (const saved of f.writes) {
            const first = M.runViews(saved).find(
              ({ run }) => run.id === f.starts[0]?.context.run.id,
            );
            if (first?.phase === "ended" && !M.requestClosed(saved, "one"))
              assert.deepEqual(M.dependencies(saved, "one"), ["provider"]);
          }
        });
      }),
    ),
  );
});

test("timeout measures from durable launch and confirms kill rather than freeing on abort", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
        const requests = yield* SubscriptionRef.make(
          R.reduceRegulationRequests(command("one"), R.createRegulationRequests()),
        );
        const service = yield* coordinator(resources, requests, {
          ...f.options,
          limits: { ...limits, timeoutMs: 30 },
        });
        yield* Effect.promise(async () => {
          await until(() => M.requestClosed(service.snapshot(), "one"));
          const start = f.starts[0];
          assert.ok(start);
          assert.equal(start.aborts, 1);
          assert.equal(start.kills, 1);
          assert.equal(M.runViews(service.snapshot())[0]?.phase, "ended");
          assert.equal(coordinatorViews([service.snapshot()]).hosts[0]?.occupancy, 0);
        });
      }),
    ),
  );
});

test("latest Probe failure stays visible and cannot use old success to claim reached", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
        const requests = yield* SubscriptionRef.make(
          R.reduceRegulationRequests(command("one"), R.createRegulationRequests()),
        );
        const service = yield* coordinator(resources, requests, f.options);
        yield* Effect.promise(async () => {
          const start = f.starts[0];
          assert.ok(start);
          await start.context.report(observation(start.context));
          await start.context.reportProbeFailure("2026-10-23T12:01:00Z", "Probe unavailable.");
          assert.equal(
            coordinatorViews([service.snapshot()]).targets[0]?.latestProbes[0]?.result.kind,
            "error",
          );
          start.end.resolve({ outcome: { kind: "target-reached" } });
          await until(() => M.requestClosed(service.snapshot(), "one"));
          assert.equal(M.runViews(service.snapshot())[0]?.outcome?.kind, "error");
          assert.ok(f.errors.length > 0);
        });
      }),
    ),
  );
});

test("cyclic dependency installation is atomic and does not leak a provider request", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
        const requests = yield* SubscriptionRef.make(
          R.reduceRegulationRequests(command("one"), R.createRegulationRequests()),
        );
        const service = yield* coordinator(resources, requests, f.options);
        yield* Effect.promise(async () => {
          const first = f.starts[0];
          assert.ok(first);
          first.end.resolve({
            outcome: { kind: "blocked", message: "Invalid self dependency." },
            dependencies: [
              {
                ...command("self"),
                origin: { kind: "dependency", consumerRequestRef: "one" },
              },
            ],
          });
          await until(() => M.requestClosed(service.snapshot(), "one"));
          assert.equal(f.starts.length, 1);
          assert.equal(service.snapshot().requests.requests.length, 1);
          assert.deepEqual(M.dependencies(service.snapshot(), "one"), []);
          assert.ok(f.errors.length > 0);
        });
      }),
    ),
  );
});

test("dependency fanout is bounded before any partial provider installation", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
        const requests = yield* SubscriptionRef.make(
          R.reduceRegulationRequests(command("one"), R.createRegulationRequests()),
        );
        const service = yield* coordinator(resources, requests, {
          ...f.options,
          maxDependencyRequests: 1,
        });
        yield* Effect.promise(async () => {
          const first = f.starts[0];
          assert.ok(first);
          first.end.resolve({
            outcome: { kind: "blocked", message: "Too many providers." },
            dependencies: ["a", "b"].map((name) => ({
              ...command(name, name),
              origin: { kind: "dependency", consumerRequestRef: "one" },
            })),
          });
          await until(() => M.requestClosed(service.snapshot(), "one"));
          assert.equal(service.snapshot().requests.requests.length, 1);
          assert.ok(f.errors.some((error) => String(error).includes("limit exceeded")));
        });
      }),
    ),
  );
});

test("initial replacement stops active execution without claiming zero occupancy before exit", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
        let input = R.reduceRegulationRequests(command("one"), R.createRegulationRequests());
        const requests = yield* SubscriptionRef.make(input);
        const service = yield* coordinator(resources, requests, {
          ...f.options,
          abortGraceMs: 100,
        });
        input = R.reduceRegulationRequests(
          { ...command("initial"), desiredLevel: "initial" },
          input,
        );
        yield* SubscriptionRef.set(requests, input);
        yield* Effect.promise(async () => {
          await until(() => M.runViews(service.snapshot())[0]?.phase === "stopping");
          assert.equal(coordinatorViews([service.snapshot()]).hosts[0]?.occupancy, 1);
          const first = f.starts[0];
          assert.ok(first);
          first.end.resolve({ outcome: { kind: "cancelled", message: "Exit confirmed." } });
          await until(() => M.runViews(service.snapshot())[0]?.phase === "ended");
          assert.equal(f.starts.length, 1);
          assert.equal(M.runViews(service.snapshot()).length, 1);
        });
      }),
    ),
  );
});

test("failure to read a persisted snapshot releases the acquired store and never starts fresh", async () => {
  const f = fixture();
  await assert.rejects(
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
          const requests = yield* SubscriptionRef.make(R.createRegulationRequests());
          yield* coordinator(resources, requests, {
            ...f.options,
            store: {
              ...f.options.store,
              load: async () => {
                throw new Error("Corrupt persisted state.");
              },
            },
          });
        }),
      ),
    ),
    /Corrupt persisted state/,
  );
  assert.equal(f.closes(), 1);
  assert.equal(f.starts.length, 0);
});

test("persistence failure is explicit and cannot launch work", async () => {
  const f = fixture();
  f.failSave();
  await assert.rejects(
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
          const requests = yield* SubscriptionRef.make(
            R.reduceRegulationRequests(command("one"), R.createRegulationRequests()),
          );
          yield* coordinator(resources, requests, f.options);
        }),
      ),
    ),
    /Persistence unavailable/,
  );
  assert.equal(f.starts.length, 0);
  assert.ok(f.errors.length > 0);
  assert.equal(f.closes(), 1);
});

test("file store uses an OS-backed profile lock, preserves snapshots and rejects corrupt data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coordinator-store-"));
  try {
    const first = await openCoordinatorStore(directory);
    assert.equal(await first.load(), null);
    await assert.rejects(openCoordinatorStore(directory), /already in use/);
    await first.save(activeState());
    assert.deepEqual(await first.load(), activeState());
    await first.close();
    const second = await openCoordinatorStore(directory);
    assert.deepEqual(await second.load(), activeState());
    const original = await readFile(join(directory, "coordinator-state.json"), "utf8");
    await writeFile(join(directory, "coordinator-state.json"), "{broken");
    await assert.rejects(second.load());
    await writeFile(join(directory, "coordinator-state.json"), original);
    await rm(join(directory, "coordinator-state.json"));
    await assert.rejects(second.load(), /snapshot is missing/);
    await second.close();
    await assert.rejects(second.load(), /closed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("kill failure preserves occupancy and surfaces failure until actual execution exits", async () => {
  const f = fixture();
  await assert.rejects(
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
          const requests = yield* SubscriptionRef.make(
            R.reduceRegulationRequests(command("one"), R.createRegulationRequests()),
          );
          const service = yield* coordinator(resources, requests, {
            ...f.options,
            limits: { ...limits, timeoutMs: 20 },
            runner: {
              ...f.options.runner,
              start: (context) => {
                const handle = f.options.runner.start(context);
                return {
                  ...handle,
                  kill: async () => {
                    throw new Error("Kill refused.");
                  },
                };
              },
            },
          });
          yield* Effect.promise(async () => {
            await until(() => f.errors.some((error) => String(error).includes("Kill refused")));
            assert.equal(M.runViews(service.snapshot())[0]?.phase, "stopping");
            assert.equal(coordinatorViews([service.snapshot()]).hosts[0]?.occupancy, 1);
            await assert.rejects(service.flush(), /Kill refused/);
            const run = f.starts[0];
            assert.ok(run);
            run.end.resolve({
              outcome: { kind: "cancelled", message: "Actual exit after failure." },
            });
            await tick();
          });
        }),
      ),
    ),
    /Kill refused/,
  );
  assert.equal(f.closes(), 1);
});

test("shared provider remains demanded after one consumer is superseded", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make<M.ResourceAllocation>({
          kind: "configured",
          bindings: [{ binding: { id: "agent" }, capacity: 2 }],
        });
        let input = R.reduceRegulationRequests(
          command("left", "left"),
          R.createRegulationRequests(),
        );
        input = R.reduceRegulationRequests(command("right", "right"), input);
        const requests = yield* SubscriptionRef.make(input);
        const service = yield* coordinator(resources, requests, f.options);
        yield* Effect.promise(async () => {
          const left = f.starts.find(({ context }) => context.run.requestRef === "left");
          const right = f.starts.find(({ context }) => context.run.requestRef === "right");
          assert.ok(left && right);
          left.end.resolve({
            outcome: { kind: "blocked", message: "Needs common provider." },
            dependencies: [
              {
                ...command("provider", "provider"),
                origin: { kind: "dependency", consumerRequestRef: "left" },
              },
            ],
          });
          await until(() => f.starts.length === 3);
          right.end.resolve({
            outcome: { kind: "blocked", message: "Needs same provider." },
            dependencies: [{ requestRef: "provider" }],
          });
          await until(() => M.dependencies(service.snapshot(), "right").length === 1);
        });
        input = R.reduceRegulationRequests(
          { ...command("left-initial", "left"), desiredLevel: "initial" },
          input,
        );
        yield* SubscriptionRef.set(requests, input);
        yield* Effect.promise(async () => {
          await until(() => M.requestClosed(service.snapshot(), "left"));
          const provider = f.starts.find(({ context }) => context.run.requestRef === "provider");
          assert.ok(provider);
          assert.equal(provider.aborts, 0);
          assert.ok(!M.requestClosed(service.snapshot(), "provider"));
          provider.end.resolve({
            outcome: { kind: "target-reached" },
            observation: observation(provider.context),
          });
          await until(() => f.starts.length === 4);
          const resumed = f.starts[3];
          assert.ok(resumed);
          assert.equal(resumed.context.run.requestRef, "right");
          resumed.end.resolve({
            outcome: { kind: "target-reached" },
            observation: observation(resumed.context),
          });
          await until(() => M.requestClosed(service.snapshot(), "right"));
          assert.equal(
            f.starts.filter(({ context }) => context.run.requestRef === "left").length,
            1,
          );
        });
      }),
    ),
  );
});
test("restored run reattaches a real child process and retains elapsed timeout", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
  const result: Promise<RunResult> = exited.then(() => ({
    outcome: { kind: "cancelled", message: "Child exit confirmed." },
  }));
  const f = fixture(activeState());
  let recoveries = 0;
  let kills = 0;
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const resources = yield* SubscriptionRef.make<M.ResourceAllocation>(available);
          const requests = yield* SubscriptionRef.make(
            R.reduceRegulationRequests(command("one"), R.createRegulationRequests()),
          );
          const service = yield* coordinator(resources, requests, {
            ...f.options,
            runner: {
              ...f.options.runner,
              recover: async (context) => {
                recoveries++;
                assert.equal(context.run.id, "host-a:3");
                return {
                  kind: "attached",
                  handle: {
                    result,
                    abort: async () => {},
                    kill: async () => {
                      kills++;
                      child.kill();
                      await exited;
                    },
                  },
                };
              },
            },
          });
          yield* Effect.promise(async () => {
            await until(() => M.requestClosed(service.snapshot(), "one"));
            assert.equal(f.starts.length, 0);
            assert.equal(recoveries, 1);
            assert.equal(kills, 1);
            assert.equal(coordinatorViews([service.snapshot()]).hosts[0]?.occupancy, 0);
          });
        }),
      ),
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
});
