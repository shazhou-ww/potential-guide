import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay, setImmediate as nextTurn } from "node:timers/promises";
import { Effect } from "@potential-guide/effects";
import { fixture } from "../../objective-pilot/test/fixtures.js";
import {
  makeRegulatorSpec,
  RegulationError,
  type RegulationInput,
  type RegulationStrategy,
  regulate,
} from "../src/index.js";

const pass = { status: 200, message: "", payload: { ok: true, problems: [] } } as const;
async function input(strategy: Partial<RegulationStrategy> = {}) {
  return {
    spec: makeRegulatorSpec(
      await fixture().load(),
      {
        targetLevel: "terminal",
        agentExecutionLimits: { timeoutMs: 1000 },
        quota: { timeoutMs: 10_000, maxAgentRuns: 10, maxStallRuns: 3 },
        ...strategy,
      },
      { id: "test" },
    ),
    subject: { name: "repo" },
  };
}

test("probe policy retries 5xx only, preserving typed invocation errors and envelope", async () => {
  const base = await input({ probe: { timeoutMs: 1000, retry: { maxRetries: 2, delayMs: 15 } } });
  for (const status of [403, 503]) {
    let rounds = 0;
    let agents = 0;
    const starts: number[] = [];
    const error = await Effect.runPromise(
      regulate(base, {
        pilot: {
          resolveCheck: (ref) => async () => {
            if (ref.checkId === "one" && ref.levelId === "z-first") {
              rounds++;
              starts.push(performance.now());
            }
            return { status, payload: null, message: "transport unavailable" };
          },
        },
        executeAgent: async () => {
          agents++;
          return { status: "completed", summary: "wrong" };
        },
      }).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => assert.fail("Invocation failure must reject."),
        }),
      ),
    );
    assert.ok(error instanceof RegulationError);
    assert.equal(error.status, status);
    assert.equal(error.envelope?.payload, null);
    assert.equal(rounds, status === 403 ? 1 : 3);
    assert.equal(agents, 0);
    if (status === 503) {
      const [first, second, third] = starts;
      assert.ok(first !== undefined && second !== undefined && third !== undefined);
      assert.ok(second - first >= 14);
      assert.ok(third - second >= 14);
    }
  }
});

test("successful retry establishes target without authorizing Agent repair", async () => {
  const base = await input({ probe: { timeoutMs: 1000, retry: { maxRetries: 2, delayMs: 0 } } });
  let rounds = 0;
  const statuses: number[] = [];
  const result = await Effect.runPromise(
    regulate(base, {
      pilot: {
        resolveCheck: (ref) => async () => {
          if (ref.levelId === "z-first" && ref.checkId === "one") rounds++;
          return rounds < 3 ? { status: 500, payload: null, message: "retryable" } : pass;
        },
      },
      executeAgent: async () => assert.fail("No repair required."),
      onObservation: (sample) => statuses.push(sample.status),
    }),
  );
  assert.equal(result.stopReason, "target-reached");
  assert.equal(result.iterations, 0);
  assert.deepEqual(statuses, [500, 500, 200]);
});

test("a sibling 4xx prevents whole-observation retries even if a 5xx appeared first", async () => {
  let checks = 0;
  const error = await Effect.runPromise(
    regulate(await input({ probe: { timeoutMs: 1000, retry: { maxRetries: 2, delayMs: 0 } } }), {
      pilot: {
        resolveCheck: (ref) => async () => {
          checks++;
          return { status: ref.checkId === "one" ? 503 : 403, payload: null, message: "rejected" };
        },
      },
      executeAgent: async () => assert.fail("Invocation faults cannot authorize repair."),
    }).pipe(
      Effect.match({
        onFailure: (error) => error,
        onSuccess: () => assert.fail("Expected invocation error."),
      }),
    ),
  );
  assert.equal(error.status, 403);
  assert.equal(checks, 2);
});

test("probe timeout aborts ignored cleanup, raises 504, and isolates late results", async () => {
  const releases: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  const reports: number[] = [];
  const error = await Effect.runPromise(
    regulate(await input({ probe: { timeoutMs: 20, retry: { maxRetries: 0, delayMs: 0 } } }), {
      pilot: {
        resolveCheck: () => async (_subject, signal) => {
          signals.push(signal);
          await new Promise<void>((resolve) => releases.push(resolve));
          return pass;
        },
      },
      executeAgent: async () => assert.fail("Timeout cannot authorize repair."),
      onObservation: (sample) => reports.push(sample.status),
    }).pipe(
      Effect.match({
        onFailure: (error) => error,
        onSuccess: () => assert.fail("Expected probe timeout."),
      }),
    ),
  );
  assert.equal(error.status, 504);
  assert.equal(error.envelope?.payload, null);
  assert.ok(signals.every((signal) => signal.aborted));
  for (const release of releases) release();
  await delay(5);
  assert.deepEqual(reports, [504]);
});

test("overall time quota includes probe retries and retry delays", { timeout: 5000 }, async (t) => {
  const base = await input({
    quota: { timeoutMs: 50, maxAgentRuns: 5, maxStallRuns: 5 },
    probe: { timeoutMs: 1000, retry: { maxRetries: 10, delayMs: 20 } },
  });
  // Keep both quota clocks controlled; host load must not exhaust the quota before a probe.
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const advance = async (ms: number) => {
    now += ms;
    t.mock.timers.tick(ms);
    await nextTurn();
  };
  let probes = 0;
  let settled = false;
  const observations: { status: number; payload: unknown; message: string }[] = [];
  const pending = Effect.runPromise(
    regulate(base, {
      pilot: {
        resolveCheck: (ref) => async () => {
          if (ref.levelId === "z-first" && ref.checkId === "one") {
            probes++;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
          }
          return { status: probes === 1 ? 500 : 503, payload: null, message: "offline" };
        },
      },
      executeAgent: async () => assert.fail("No repair on invocation failure."),
      onObservation: (sample) => observations.push(sample),
    }),
  ).then((result) => {
    settled = true;
    return result;
  });
  await nextTurn();
  assert.equal(probes, 1);
  await advance(9);
  assert.equal(observations.length, 0);
  await advance(1);
  assert.deepEqual(
    observations.map((sample) => sample.status),
    [500],
  );
  await advance(19);
  assert.equal(probes, 1);
  await advance(1);
  assert.equal(probes, 2);
  await advance(9);
  assert.equal(observations.length, 1);
  await advance(1);
  assert.deepEqual(
    observations.map((sample) => sample.status),
    [500, 503],
  );
  await advance(9);
  assert.equal(settled, false);
  await advance(1);
  assert.equal(settled, true);
  const result = await pending;
  assert.equal(result.stopReason, "exhausted");
  assert.equal(result.exhaustedBy, "time");
  assert.equal(result.latestObservation.status, 503);
  assert.equal(result.latestObservation, observations[1]);
  assert.equal(result.iterations, 0);
  await advance(20);
  assert.equal(probes, 2);
  assert.equal(observations.length, 2);
});

test("probe crashes become typed invocation faults, not normal completed outcomes", async () => {
  const error = await Effect.runPromise(
    regulate(await input(), {
      pilot: {
        resolveCheck: () => {
          throw new Error("resolver crashed");
        },
      },
      executeAgent: async () => assert.fail("Cannot repair an invocation failure."),
    }).pipe(
      Effect.match({
        onFailure: (error) => error,
        onSuccess: () => assert.fail("Expected invocation fault."),
      }),
    ),
  );
  assert.equal(error.status, 502);
  assert.match(error.message, /resolver crashed/);
});

test("externally provided malformed inputs reject as 400 before any execution", async () => {
  const base = await input();
  const invalid: unknown[] = [
    null,
    {},
    [],
    { ...base, subject: null },
    { ...base, subject: [] },
    { ...base, language: 1 },
    { ...base, history: null },
    { ...base, history: { stalledRuns: -1 } },
    { ...base, history: { stalledRuns: 1.5 } },
    { ...base, history: { stalledRuns: Number.MAX_SAFE_INTEGER + 1 } },
    { ...base, spec: null },
    ...[
      null,
      {},
      { ...base.spec.objective, manifest: null },
      { ...base.spec.objective, locales: null },
      { ...base.spec.objective, objectiveId: 1 },
      { ...base.spec.objective, version: null },
      { ...base.spec.objective, manifest: { ...base.spec.objective.manifest, levels: [null] } },
    ].map((objective) => ({ ...base, spec: { ...base.spec, objective } })),
    ...[
      null,
      {},
      { ...base.spec.strategy, agentExecutionLimits: null },
      { ...base.spec.strategy, quota: null },
      { ...base.spec.strategy, probe: { timeoutMs: 1, retry: null } },
      { ...base.spec.strategy, mode: { type: "periodic", intervalMs: 10 } },
      { ...base.spec.strategy, effectTtlMs: 100 },
      { ...base.spec.strategy, targetLevel: "unknown" },
    ].map((strategy) => ({ ...base, spec: { ...base.spec, strategy } })),
    ...[null, {}, { id: 1 }, { id: "test", configuration: [] }].map((binding) => ({
      ...base,
      spec: { ...base.spec, binding },
    })),
  ];
  const cyclic: Record<string, unknown> = { ...base };
  cyclic.subject = cyclic;
  invalid.push(cyclic);
  for (const value of invalid) {
    let calls = 0;
    const error = await Effect.runPromise(
      regulate(value as RegulationInput, {
        pilot: {
          resolveCheck: () => {
            calls++;
            return async () => pass;
          },
        },
        executeAgent: async () => {
          calls++;
          return { status: "completed", summary: "wrong" };
        },
      }).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => assert.fail("Malformed input cannot complete."),
        }),
      ),
    );
    assert.ok(error instanceof RegulationError);
    assert.equal(error.status, 400);
    assert.equal(calls, 0);
  }
});

test("quota timers and counts are required, positive and safe", async () => {
  const base = await input();
  for (const field of ["timeoutMs", "maxAgentRuns", "maxStallRuns"] as const) {
    for (const value of [
      0,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      assert.throws(
        () =>
          makeRegulatorSpec(
            base.spec.objective,
            {
              ...base.spec.strategy,
              quota: { ...base.spec.strategy.quota, [field]: value },
            },
            base.spec.binding,
          ),
        (error: unknown) => error instanceof RegulationError && error.status === 400,
      );
    }
  }
  assert.throws(
    () =>
      makeRegulatorSpec(
        base.spec.objective,
        {
          ...base.spec.strategy,
          quota: { ...base.spec.strategy.quota, timeoutMs: 2_147_483_648 },
        },
        base.spec.binding,
      ),
    RegulationError,
  );
  for (const extra of [
    { agentExecutionLimits: { timeoutMs: 0 } },
    { agentExecutionLimits: { timeoutMs: 2_147_483_648 } },
    { probe: { timeoutMs: 0, retry: { maxRetries: 0, delayMs: 0 } } },
    { probe: { timeoutMs: 1, retry: { maxRetries: -1, delayMs: 0 } } },
    { probe: { timeoutMs: 1, retry: { maxRetries: 1, delayMs: -1 } } },
  ])
    await assert.rejects(input(extra), RegulationError);
});
