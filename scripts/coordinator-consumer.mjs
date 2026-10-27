import assert from "node:assert/strict";
import { join } from "node:path";
import { mock } from "node:test";
import { Effect, SubscriptionRef } from "@potential-guide/effects";
import {
  coordinator,
  coordinatorViews,
  CoordinatorModel as M,
  openCoordinatorStore,
  RequestModel as R,
} from "@potential-guide/regulation-coordinator";

const source = {
  kind: "git-tree",
  repository: "https://example.test/consumer.git",
  directory: "rules",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  repositoryTree: "c".repeat(40),
};
const objective = {
  objectiveId: "git+https://example.test/consumer.git#rules/",
  version: source.tree,
  source,
  manifest: {
    $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
    subjectSchema: { type: "object" },
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
        references: [],
        content: "",
      },
    },
  },
};
const starts = [];
const errors = [];
const allocation = {
  kind: "configured",
  bindings: [{ binding: { id: "agent" }, capacity: 1 }],
};
const profile = join(process.cwd(), "coordinator-profile");
let input = R.createRegulationRequests();
const request = (requestRef) => ({
  type: "request",
  requestRef,
  objective,
  subject: { a: 1, A: 2, ä: 3 },
  desiredLevel: "ready",
  priority: 1,
  origin: { kind: "external" },
});
const drain = async (service) => {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
    await service.flush();
  }
};
const options = async () => ({
  hostId: "packed-recurrence",
  store: await openCoordinatorStore(profile),
  limits: { timeoutMs: 10000, maxAgentRuns: 1, maxStallRuns: 1 },
  maxAttemptsPerRequest: 1,
  maxDependencyRequests: 4,
  abortGraceMs: 10,
  runner: {
    start(context) {
      let finish;
      const result = new Promise((resolve) => {
        finish = resolve;
      });
      starts.push({ context, finish });
      return {
        result,
        abort: async () => finish({ outcome: { kind: "cancelled", message: "Stopped." } }),
        kill: async () => finish({ outcome: { kind: "cancelled", message: "Killed." } }),
      };
    },
    recover: async () => ({ kind: "unknown" }),
  },
  onError: (error) => errors.push(error),
});
const exhaust = (run) =>
  run.finish({
    outcome: { kind: "exhausted", reason: "agent-runs", message: "Finite quota used." },
  });
async function session(run) {
  const config = await options();
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resources = yield* SubscriptionRef.make(allocation);
        const requests = yield* SubscriptionRef.make(input);
        const service = yield* coordinator(resources, requests, config);
        yield* Effect.promise(() => run(service, requests));
      }),
    ),
  );
}

mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-10-27T00:00:00Z") });
try {
  input = R.reduceRegulationRequests(
    {
      ...request("root"),
      eligibleAt: new Date(Date.now() + 100).toISOString(),
      recurrence: { intervalMs: 100 },
    },
    input,
  );
  await session(async (service, requests) => {
    assert.equal(starts.length, 0);
    mock.timers.tick(100);
    await drain(service);
    assert.equal(starts.length, 1);
    const successor = service
      .snapshot()
      .requests.requests.find((r) => r.origin.kind === "recurrence");
    assert.ok(successor);
    exhaust(starts[0]);
    await drain(service);
    assert.equal(starts.length, 1);
    const events = M.exhaustionEvents(service.snapshot());
    assert.equal(events.length, 1);
    assert.deepEqual(M.exhaustionEvents(M.restoreCoordinatorState(service.snapshot())), events);
    assert.equal(
      service.eventsSince(events[0].revision).some(({ fact }) => fact.type === "run-end"),
      false,
    );
    input = R.reduceRegulationRequests(request("extra"), input);
    await Effect.runPromise(SubscriptionRef.set(requests, input));
    await drain(service);
    assert.equal(starts.length, 2);
    assert.equal(starts[1].context.run.requestRef, "extra");
    assert.equal(M.requestClosed(service.snapshot(), successor.ref), false);
    exhaust(starts[1]);
    await drain(service);
  });
  mock.timers.tick(10000);
  await session(async (service, requests) => {
    assert.equal(starts.length, 3);
    assert.equal(starts[2].context.details.request.origin.kind, "recurrence");
    assert.equal(service.snapshot().requests.requests.length, 4);
    exhaust(starts[2]);
    await drain(service);
    await service.cancel("root");
    await Effect.runPromise(SubscriptionRef.set(requests, input));
    mock.timers.tick(10000);
    await drain(service);
    assert.equal(starts.length, 3);
    assert.equal(M.exhaustionEvents(service.snapshot()).length, 3);
    assert.equal(coordinatorViews([service.snapshot()]).hosts[0].exhaustionEvents.length, 3);
  });
  await session(async (service) => {
    await drain(service);
    assert.equal(starts.length, 3);
    assert.deepEqual(M.restoreCoordinatorState(service.snapshot()), service.snapshot());
  });
  assert.deepEqual(errors, []);
  console.log(
    "Packed Coordinator: timed recurrence, exhaustion replay, external append, restart and stop verified.",
  );
} finally {
  mock.timers.reset();
}
