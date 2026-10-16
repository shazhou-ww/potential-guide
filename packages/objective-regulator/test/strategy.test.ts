import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Exit, startEffect } from "@potential-guide/effects";
import { fixture } from "../../objective-pilot/test/fixtures.js";
import { makeRegulatorSpec, type RegulationStrategy, regulate } from "../src/index.js";

const pass = { status: 200, message: "", payload: { ok: true, problems: [] } } as const;
const fail = {
  status: 200,
  message: "",
  payload: { ok: false, problems: [{ id: "broken", parameters: {} }] },
} as const;
async function input(strategy: Partial<RegulationStrategy> = {}) {
  return {
    spec: makeRegulatorSpec(
      await fixture().load(),
      {
        targetLevel: "terminal",
        agentExecutionLimits: { timeoutMs: 1000 },
        ...strategy,
      },
      { id: "test" },
    ),
    subject: { name: "repo" },
  };
}

test("probe policy retries only 5xx and respects finite retry count and delay", async () => {
  const base = await input({ probe: { timeoutMs: 1000, retry: { maxRetries: 2, delayMs: 15 } } });
  for (const status of [403, 503]) {
    let rounds = 0;
    let agents = 0;
    const starts: number[] = [];
    const result = await Effect.runPromise(
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
          return { status: "blocked", reason: "must not repair transport" };
        },
      }),
    );
    assert.equal(result.stopReason, "invocation-failed");
    assert.equal(rounds, status === 403 ? 1 : 3);
    assert.equal(agents, 0);
    if (status === 503) {
      const [first, second, third] = starts;
      assert.ok(first !== undefined && second !== undefined && third !== undefined);
      assert.ok(second - first >= 15);
      assert.ok(third - second >= 15);
    }
  }
});

test("a later successful 5xx retry establishes a trusted level without an Agent repair", async () => {
  const base = await input({ probe: { timeoutMs: 1000, retry: { maxRetries: 2, delayMs: 0 } } });
  let rounds = 0;
  let agents = 0;
  const statuses: number[] = [];
  const result = await Effect.runPromise(
    regulate(base, {
      pilot: {
        resolveCheck: (ref) => async () => {
          if (ref.levelId === "z-first" && ref.checkId === "one") rounds++;
          return rounds < 3
            ? { status: 500, payload: null, message: "retryable source fault" }
            : pass;
        },
      },
      executeAgent: async () => {
        agents++;
        return { status: "blocked", reason: "wrong" };
      },
      onObservation: (sample) => {
        statuses.push(sample.status);
      },
    }),
  );
  assert.equal(rounds, 3);
  assert.equal(result.stopReason, "target-reached");
  assert.equal(agents, 0);
  assert.deepEqual(statuses, [500, 500, 200]);
});

test("a sibling 4xx prevents retrying a whole level even when a 5xx appears first", async () => {
  const base = await input({ probe: { timeoutMs: 1000, retry: { maxRetries: 2, delayMs: 0 } } });
  let checks = 0;
  const result = await Effect.runPromise(
    regulate(base, {
      pilot: {
        resolveCheck: (ref) => async () => {
          checks++;
          return {
            status: ref.checkId === "one" ? 503 : 403,
            payload: null,
            message: "Invocation rejected.",
          };
        },
      },
      executeAgent: async () => {
        throw new Error("Invocation faults must not authorize Agent work.");
      },
    }),
  );
  assert.equal(result.latestObservation.status, 403);
  assert.equal(checks, 2);
});

test("probe timeout aborts observation and reports 504 without trusting a late result", async () => {
  const base = await input({ probe: { timeoutMs: 20, retry: { maxRetries: 0, delayMs: 0 } } });
  const releases: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  let agents = 0;
  const result = await Effect.runPromise(
    regulate(base, {
      pilot: {
        resolveCheck: () => async (_subject, signal) => {
          signals.push(signal);
          await new Promise<void>((resolve) => releases.push(resolve));
          return pass;
        },
      },
      executeAgent: async () => {
        agents++;
        return { status: "blocked", reason: "wrong" };
      },
    }),
  );
  assert.equal(result.stopReason, "invocation-failed");
  assert.equal(result.latestObservation.status, 504);
  assert.equal(result.latestObservation.payload, null);
  assert.equal(agents, 0);
  assert.ok(signals.length > 0);
  assert.ok(signals.every((signal) => signal.aborted));
  for (const release of releases) release();
  await delay(5);
  assert.equal(result.latestObservation.payload, null);
});

test("periodic mode observes after target and repairs later regressions", async () => {
  const base = await input({ mode: { type: "periodic", intervalMs: 10 } });
  let regressed = false;
  let repaired = false;
  let observations = 0;
  let agents = 0;
  const controller = new AbortController();
  const running = startEffect(
    regulate(base, {
      pilot: { resolveCheck: () => async () => (regressed && !repaired ? fail : pass) },
      async executeAgent(request) {
        assert.equal(request.observation.problems.length, 2);
        agents++;
        repaired = true;
        return { status: "completed", summary: "regression repaired" };
      },
      onObservation: () => {
        observations++;
        if (observations === 1) regressed = true;
      },
    }),
    controller.signal,
  );
  try {
    const deadline = performance.now() + 2000;
    while (!repaired || observations < 3) {
      assert.ok(performance.now() < deadline, "Periodic regression repair did not complete.");
      await delay(1);
    }
    assert.equal(agents, 1);
  } finally {
    controller.abort();
    await assert.rejects(running.await());
  }
});

test("effect TTL is lifecycle interruption, not an Agent or cross-round budget", async () => {
  const base = await input({ effectTtlMs: 500 });
  let agentStarted = false;
  let agentAborted = false;
  const running = startEffect(
    regulate(base, {
      pilot: { resolveCheck: () => async () => fail },
      executeAgent: async (request, signal) => {
        agentStarted = true;
        assert.equal(request.limits.timeoutMs, 1000);
        signal.addEventListener("abort", () => {
          agentAborted = true;
        });
        return await new Promise(() => {});
      },
    }),
  );
  const exit = await running.exit();
  assert.equal(Exit.hasInterrupts(exit), true);
  assert.equal(agentStarted, true);
  assert.equal(agentAborted, true);
});

test("strategy validates cadence, probe retry policy and lifecycle TTL", async () => {
  for (const extra of [
    { mode: { type: "periodic" as const, intervalMs: 0 } },
    { probe: { timeoutMs: 0, retry: { maxRetries: 0, delayMs: 0 } } },
    { probe: { timeoutMs: 1, retry: { maxRetries: -1, delayMs: 0 } } },
    { probe: { timeoutMs: 1, retry: { maxRetries: 1, delayMs: -1 } } },
    { effectTtlMs: 0 },
  ])
    await assert.rejects(input(extra));
});
