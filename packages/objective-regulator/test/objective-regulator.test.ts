import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Exit, SubscriptionRef, startEffect } from "@potential-guide/effects";
import type { PilotManifest } from "@potential-guide/objective-pilot";
import { fixture, manifest, objectiveId } from "../../objective-pilot/test/fixtures.js";
import {
  type AgentInput,
  decideRegulation,
  makeRegulatorSpec,
  RegulationError,
  type RegulationInput,
  type RegulationRuntime,
  type RegulationStrategy,
  regulate,
  regulationPrerequisite,
  regulatorBehavior,
} from "../src/index.js";

const pass = { status: 200, message: "", payload: { ok: true, problems: [] } } as const;
const fail = {
  status: 200,
  message: "",
  payload: { ok: false, problems: [{ id: "broken", parameters: {} }] },
} as const;
const completed = { status: "completed", summary: "Repair finished." } as const;
const quota = { timeoutMs: 10_000, maxAgentRuns: 10, maxStallRuns: 10 };
async function input(strategy: Partial<RegulationStrategy> = {}): Promise<RegulationInput> {
  return {
    spec: makeRegulatorSpec(
      await fixture().load(),
      { targetLevel: "terminal", agentExecutionLimits: { timeoutMs: 1000 }, quota, ...strategy },
      { id: "test-agent" },
    ),
    subject: { name: "repo" },
  };
}
async function until(predicate: () => boolean, message = "condition") {
  const deadline = performance.now() + 3000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, `Timed out waiting for ${message}.`);
    await delay(1);
  }
}
async function errorOf(value: RegulationInput, runtime: RegulationRuntime) {
  const result = await Effect.runPromise(
    regulate(value, runtime).pipe(
      Effect.match({
        onFailure: (error) => error,
        onSuccess: () => assert.fail("Expected a typed regulation error."),
      }),
    ),
  );
  assert.ok(result instanceof RegulationError);
  return result;
}

test("recipe and runtime snapshots are immutable JSON data", async () => {
  const value = await input();
  assert.deepEqual(JSON.parse(JSON.stringify(value.spec)), value.spec);
  assert.equal("subject" in value.spec, false);
  assert.ok(Object.isFrozen(value.spec.strategy.quota));
  let repaired = false;
  const result = await Effect.runPromise(
    regulate(value, {
      pilot: { resolveCheck: () => async () => (repaired ? pass : fail) },
      async executeAgent(request) {
        assert.ok(Object.isFrozen(request));
        assert.ok(Object.isFrozen(request.observation.problems));
        assert.ok(Object.isFrozen(request.subject));
        assert.throws(() => Object.assign(request.subject, { name: "changed" }));
        Object.assign(value.subject, { name: "external mutation" });
        assert.equal(request.subject.name, "repo");
        repaired = true;
        return completed;
      },
    }),
  );
  assert.equal(result.stopReason, "target-reached");
  assert.ok(Object.isFrozen(result.latestObservation));
  assert.ok(Object.isFrozen(result));
});

test("single run performs multiple Agent rounds and observes after every completed round", async () => {
  let rounds = 0;
  const events: string[] = [];
  const requests: AgentInput[] = [];
  const result = await Effect.runPromise(
    regulate(await input(), {
      pilot: { resolveCheck: () => async () => (rounds < 3 ? fail : pass) },
      async executeAgent(request) {
        events.push("agent");
        requests.push(request);
        rounds++;
        return completed;
      },
      onObservation: () => events.push("observation"),
    }),
  );
  assert.equal(result.stopReason, "target-reached");
  assert.equal(result.iterations, 3);
  assert.equal(result.stalledRuns, 0);
  assert.equal(result.exhaustedBy, undefined);
  assert.deepEqual(events, [
    "observation",
    "agent",
    "observation",
    "agent",
    "observation",
    "agent",
    "observation",
  ]);
  for (const request of requests) {
    assert.equal(request.observation.problems.length, 2);
    assert.deepEqual(request.target, { objectiveId, levelId: "terminal" });
    assert.deepEqual(request.limits, { timeoutMs: 1000 });
  }
});

test("an already reached target completes once without scheduling rechecks", async () => {
  let observations = 0;
  let agents = 0;
  const result = await Effect.runPromise(
    regulate(await input(), {
      pilot: { resolveCheck: () => async () => pass },
      executeAgent: async () => {
        agents++;
        return completed;
      },
      onObservation: () => observations++,
    }),
  );
  await delay(20);
  assert.equal(result.stopReason, "target-reached");
  assert.equal(result.iterations, 0);
  assert.equal(observations, 1);
  assert.equal(agents, 0);
});

test("agent-run quota exhausts only after observing the final completed repair", async () => {
  let observations = 0;
  const result = await Effect.runPromise(
    regulate(await input({ quota: { ...quota, maxAgentRuns: 2 } }), {
      pilot: { resolveCheck: () => async () => fail },
      executeAgent: async () => completed,
      onObservation: () => observations++,
    }),
  );
  assert.equal(result.stopReason, "exhausted");
  assert.equal(result.exhaustedBy, "agent-runs");
  assert.equal(result.iterations, 2);
  assert.equal(result.stalledRuns, 2);
  assert.equal(observations, 3);
});

test("target reached by last allowed Agent takes precedence over exhausted count", async () => {
  let repaired = false;
  const result = await Effect.runPromise(
    regulate(await input({ quota: { ...quota, maxAgentRuns: 1, maxStallRuns: 1 } }), {
      pilot: { resolveCheck: () => async () => (repaired ? pass : fail) },
      executeAgent: async () => {
        repaired = true;
        return completed;
      },
    }),
  );
  assert.equal(result.stopReason, "target-reached");
  assert.equal(result.iterations, 1);
});

test("stall quota carries across runs, counts completed no-progress rounds, and prevents more work", async () => {
  const base = await input({ quota: { ...quota, maxStallRuns: 2 } });
  let agents = 0;
  const runtime: RegulationRuntime = {
    pilot: { resolveCheck: () => async () => fail },
    executeAgent: async () => {
      agents++;
      return completed;
    },
  };
  const first = await Effect.runPromise(
    regulate({ ...base, history: { stalledRuns: 1 } }, runtime),
  );
  assert.equal(first.exhaustedBy, "stall");
  assert.equal(first.stalledRuns, 2);
  assert.equal(first.iterations, 1);
  const second = await Effect.runPromise(
    regulate({ ...base, history: { stalledRuns: first.stalledRuns } }, runtime),
  );
  assert.equal(second.exhaustedBy, "stall");
  assert.equal(second.iterations, 0);
  assert.equal(agents, 1);
});

test("level advancement and reduced scoped problems reset carried stagnation", async () => {
  for (const advanceLevel of [false, true]) {
    let rounds = 0;
    const base = await input({ quota: { ...quota, maxAgentRuns: 2, maxStallRuns: 2 } });
    const result = await Effect.runPromise(
      regulate(
        { ...base, history: { stalledRuns: 1 } },
        {
          pilot: {
            resolveCheck: (ref) => async () => {
              if (rounds === 0) return fail;
              if (ref.levelId === "z-first" && (advanceLevel || ref.checkId === "one")) return pass;
              return fail;
            },
          },
          executeAgent: async () => {
            rounds++;
            return completed;
          },
        },
      ),
    );
    assert.equal(result.iterations, 2);
    assert.equal(result.exhaustedBy, "agent-runs");
    assert.equal(result.stalledRuns, 1);
  }
});

test("changing problem parameters alone is not progress", async () => {
  let round = 0;
  const result = await Effect.runPromise(
    regulate(await input({ quota: { ...quota, maxStallRuns: 1 } }), {
      pilot: {
        resolveCheck: () => async () => ({
          ...fail,
          payload: { ok: false, problems: [{ id: "broken", parameters: { round } }] },
        }),
      },
      executeAgent: async () => {
        round++;
        return completed;
      },
    }),
  );
  assert.equal(result.exhaustedBy, "stall");
  assert.equal(result.iterations, 1);
});

test("time quota aborts an uncooperative first probe with an explicit null observation", async () => {
  const signals: AbortSignal[] = [];
  const releases: (() => void)[] = [];
  let agents = 0;
  const result = await Effect.runPromise(
    regulate(await input({ quota: { ...quota, timeoutMs: 50 } }), {
      pilot: {
        resolveCheck: () => async (_subject, signal) => {
          signals.push(signal);
          await new Promise<void>((resolve) => releases.push(resolve));
          return pass;
        },
      },
      executeAgent: async () => {
        agents++;
        return completed;
      },
    }),
  );
  assert.equal(result.exhaustedBy, "time");
  assert.equal(result.latestObservation.payload, null);
  assert.equal(result.iterations, 0);
  assert.equal(agents, 0);
  assert.ok(signals.length > 0);
  assert.ok(signals.every((signal) => signal.aborted));
  for (const release of releases) release();
  await delay(5);
  assert.equal(result.latestObservation.payload, null);
});

test("time quota includes Agent execution and preserves the latest observation", async () => {
  let aborted = false;
  let release: (() => void) | undefined;
  const result = await Effect.runPromise(
    regulate(await input({ quota: { ...quota, timeoutMs: 50 } }), {
      pilot: { resolveCheck: () => async () => fail },
      executeAgent: async (_request, signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return completed;
      },
    }),
  );
  assert.equal(result.exhaustedBy, "time");
  assert.equal(result.iterations, 1);
  assert.equal(result.latestObservation.status, 200);
  assert.equal(aborted, true);
  release?.();
});

test("per-Agent timeout and explicit limit are agent-limit exhaustion, not stalls", async () => {
  for (const explicit of [false, true]) {
    let aborted = false;
    let release: (() => void) | undefined;
    let observations = 0;
    const result = await Effect.runPromise(
      regulate(await input({ agentExecutionLimits: { timeoutMs: 20 } }), {
        pilot: { resolveCheck: () => async () => fail },
        executeAgent: async (_request, signal) => {
          if (explicit) return { status: "limit-reached", reason: "tool quota" };
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return completed;
        },
        onObservation: () => observations++,
      }),
    );
    assert.equal(result.exhaustedBy, "agent-limit");
    assert.equal(result.iterations, 1);
    assert.equal(result.stalledRuns, 0);
    assert.equal(observations, 1);
    assert.equal(aborted, !explicit);
    release?.();
  }
});

test("each Agent round receives its own fresh limit", async () => {
  let rounds = 0;
  const result = await Effect.runPromise(
    regulate(await input({ agentExecutionLimits: { timeoutMs: 100 } }), {
      pilot: { resolveCheck: () => async () => (rounds < 3 ? fail : pass) },
      executeAgent: async (request) => {
        assert.equal(request.limits.timeoutMs, 100);
        await delay(45);
        rounds++;
        return completed;
      },
    }),
  );
  assert.equal(result.stopReason, "target-reached");
  assert.equal(result.iterations, 3);
});

const childId = "git+https://example.test/objectives.git#child/pilot.yaml";
const grandchildId = "git+https://example.test/objectives.git#grandchild/pilot.yaml";
async function dependencyInput(deep = false): Promise<RegulationInput> {
  const configs: Record<string, PilotManifest> = {
    [objectiveId]: manifest({
      prerequisite: {
        manifestUri: "../child/pilot.yaml",
        subject: '{"name": name & "-child"}',
        minimumLevelId: "a-next",
      },
    }),
    [childId]: manifest(
      deep
        ? {
            prerequisite: {
              manifestUri: "../grandchild/pilot.yaml",
              subject: '{"name": name & "-deep"}',
            },
          }
        : {},
    ),
    ...(deep ? { [grandchildId]: manifest() } : {}),
  };
  const base = await input();
  return {
    ...base,
    spec: makeRegulatorSpec(await fixture(configs).load(), base.spec.strategy, base.spec.binding),
  };
}

test("initial unmet prerequisite returns projected direct child without invoking root Agent", async () => {
  for (const deep of [false, true]) {
    const value = await dependencyInput(deep);
    const probed: string[] = [];
    const result = await Effect.runPromise(
      regulate(value, {
        pilot: {
          resolveCheck: (ref) => async (subject) => {
            probed.push(ref.objectiveId);
            assert.equal(subject.name, deep ? "repo-child-deep" : "repo-child");
            return fail;
          },
        },
        executeAgent: async () => assert.fail("Prerequisites must never reach root Agent."),
      }),
    );
    assert.equal(result.stopReason, "prerequisite-unmet");
    assert.equal(result.iterations, 0);
    assert.equal(result.prerequisite?.spec.objectiveId, childId);
    assert.equal(result.prerequisite?.minimumLevelId, "a-next");
    assert.deepEqual(result.prerequisite?.subject, { name: "repo-child" });
    assert.equal(
      result.latestObservation.payload?.current.objectiveId,
      deep ? grandchildId : childId,
    );
    assert.ok(probed.every((id) => id !== objectiveId));
    assert.deepEqual(regulationPrerequisite(value), result.prerequisite);
  }
});

test("prerequisite regression after a root repair returns dependency instead of a second root Agent", async () => {
  let regressed = false;
  let agents = 0;
  const result = await Effect.runPromise(
    regulate(await dependencyInput(), {
      pilot: {
        resolveCheck: (ref) => async () =>
          ref.objectiveId === childId && !regressed ? pass : fail,
      },
      executeAgent: async (request) => {
        assert.ok(request.observation.problems.every(({ ref }) => ref.objectiveId === objectiveId));
        agents++;
        regressed = true;
        return completed;
      },
    }),
  );
  assert.equal(result.stopReason, "prerequisite-unmet");
  assert.equal(result.iterations, 1);
  assert.equal(result.stalledRuns, 1);
  assert.equal(result.prerequisite?.spec.objectiveId, childId);
  assert.equal(agents, 1);
});

test("meeting a direct prerequisite minimum permits root Agent even below child terminal", async () => {
  let repaired = false;
  const result = await Effect.runPromise(
    regulate(await dependencyInput(), {
      pilot: {
        resolveCheck: (ref) => async () =>
          ref.objectiveId === childId
            ? ref.levelId === "z-first"
              ? pass
              : fail
            : repaired
              ? pass
              : fail,
      },
      executeAgent: async (request) => {
        assert.equal(request.observation.current.objectiveId, objectiveId);
        repaired = true;
        return completed;
      },
    }),
  );
  assert.equal(result.stopReason, "target-reached");
  assert.equal(result.iterations, 1);
});

test("subject and prerequisite projection validation failures precede every probe and Agent", async () => {
  const base = await dependencyInput();
  assert.ok(base.spec.pilot.manifest.prerequisite !== undefined);
  for (const value of [
    { ...base, subject: {} },
    {
      ...base,
      spec: {
        ...base.spec,
        pilot: {
          ...base.spec.pilot,
          manifest: {
            ...base.spec.pilot.manifest,
            prerequisite: { ...base.spec.pilot.manifest.prerequisite, subject: '{"wrong": name}' },
          },
        },
      },
    },
  ]) {
    let calls = 0;
    const error = await errorOf(value, {
      pilot: {
        resolveCheck: () => {
          calls++;
          return async () => fail;
        },
      },
      executeAgent: async () => {
        calls++;
        return completed;
      },
    });
    assert.equal(error.status, 400);
    assert.equal(calls, 0);
  }
});

test("Agent blocked, failed, malformed outcomes, and unexpected crashes are typed faults", async () => {
  for (const status of ["blocked", "failed", "malformed", "crash"] as const) {
    let observations = 0;
    const error = await errorOf(await input(), {
      pilot: { resolveCheck: () => async () => fail },
      executeAgent: async () => {
        if (status === "crash") throw new Error("Agent crashed.");
        if (status === "malformed") return null as never;
        return { status, reason: "cannot repair" };
      },
      onObservation: () => observations++,
    });
    assert.equal(error.status, status === "blocked" ? 409 : status === "malformed" ? 502 : 500);
    assert.equal(observations, 1);
  }
  const callbackError = await errorOf(await input(), {
    pilot: { resolveCheck: () => async () => pass },
    executeAgent: async () => completed,
    onObservation: () => {
      throw new Error("report failed");
    },
  });
  assert.equal(callbackError.status, 500);
});

test("parent cancellation interrupts during probes and Agent work rather than completing", async () => {
  for (const duringProbe of [false, true]) {
    let started = false;
    let aborted = false;
    let release: (() => void) | undefined;
    const wait = async (signal: AbortSignal) => {
      started = true;
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const controller = new AbortController();
    const running = startEffect(
      regulate(await input(), {
        pilot: {
          resolveCheck: () => async (_subject, signal) => {
            if (duringProbe) await wait(signal);
            return fail;
          },
        },
        executeAgent: async (_request, signal) => {
          await wait(signal);
          return completed;
        },
      }),
      controller.signal,
    );
    await until(() => started);
    controller.abort();
    const exit = await running.exit();
    assert.equal(Exit.hasInterrupts(exit), true);
    await assert.rejects(running.await());
    assert.equal(aborted, true);
    release?.();
  }
});

test("already cancelled parent never launches probes or Agent", async () => {
  const controller = new AbortController();
  controller.abort();
  const running = startEffect(
    regulate(await input(), {
      pilot: { resolveCheck: () => assert.fail("cancelled probe") },
      executeAgent: async () => assert.fail("cancelled Agent"),
    }),
    controller.signal,
  );
  assert.equal(Exit.hasInterrupts(await running.exit()), true);
});

test("behavior refreshes changed strategies after Agent mutation and rejects late old completions", async () => {
  const value = await input();
  const source = await Effect.runPromise(SubscriptionRef.make(value));
  let repaired = false;
  let agents = 0;
  let release: (() => void) | undefined;
  const events: string[] = [];
  const reports: string[] = [];
  const behavior = await regulatorBehavior(source, {
    pilot: { resolveCheck: () => async () => (repaired ? pass : fail) },
    executeAgent: async (_request, signal) => {
      agents++;
      repaired = true;
      signal.addEventListener("abort", () => events.push("abort"));
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return completed;
    },
    onObservation: (sample) => {
      events.push("observation");
      reports.push(sample.payload?.current.levelId ?? "error");
    },
  });
  try {
    await until(() => agents === 1);
    await Effect.runPromise(
      SubscriptionRef.set(source, {
        ...value,
        spec: makeRegulatorSpec(
          value.spec.pilot,
          { ...value.spec.strategy, targetLevel: "a-next" },
          value.spec.binding,
        ),
      }),
    );
    await until(() => reports.length === 2);
    const last = await Effect.runPromise(SubscriptionRef.get(behavior.outcome));
    assert.equal(last.state, "ready");
    if (last.state === "ready") assert.equal(last.value.stopReason, "target-reached");
    assert.deepEqual(events, ["observation", "abort", "observation"]);
    assert.deepEqual(reports, ["z-first", "terminal"]);
    assert.equal(agents, 1, "Replacement must observe mutation rather than reuse stale failure.");
    release?.();
    await delay(10);
    assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(behavior.outcome)), last);
  } finally {
    release?.();
    await behavior.close();
  }
});

test("behavior aborts old probes before new snapshots and isolates late observations", async () => {
  const value = await input();
  const source = await Effect.runPromise(SubscriptionRef.make(value));
  let started = false;
  let release: (() => void) | undefined;
  let newReported = false;
  const events: string[] = [];
  const behavior = await regulatorBehavior(source, {
    pilot: {
      resolveCheck: () => async (subject, signal) => {
        if (subject.name === "repo") {
          started = true;
          signal.addEventListener("abort", () => events.push("abort"));
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        } else events.push("new-probe");
        return pass;
      },
    },
    executeAgent: async () => assert.fail("No repair required."),
    onObservation: () => {
      newReported = true;
    },
  });
  try {
    await until(() => started);
    await Effect.runPromise(SubscriptionRef.set(source, { ...value, subject: { name: "new" } }));
    await until(() => newReported);
    assert.ok(events.indexOf("abort") < events.indexOf("new-probe"));
    const state = await Effect.runPromise(SubscriptionRef.get(behavior.observation));
    release?.();
    await delay(10);
    assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(behavior.observation)), state);
  } finally {
    release?.();
    await behavior.close();
  }
});

test("decision uses local level order and rejects foreign problems", async () => {
  const value = await input({ targetLevel: "a-next" });
  const observation = {
    current: { objectiveId, levelId: "a-next" },
    problems: [],
    gapSummary: "",
    observedAt: "",
    versions: {},
  };
  assert.equal(decideRegulation(value, observation).type, "stop");
  assert.throws(
    () =>
      decideRegulation(value, {
        ...observation,
        current: { objectiveId: "git+https://other.test/repo.git#pilot.yaml", levelId: "terminal" },
      }),
    RegulationError,
  );
});
