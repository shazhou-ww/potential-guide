import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, SubscriptionRef, startEffect } from "@potential-guide/effects";
import { fixture, objectiveId } from "../../objective-pilot/test/fixtures.js";
import type { AgentInput, RegulationInput, RegulationRuntime } from "../src/index.js";
import { decideRegulation, makeRegulatorSpec, regulate, regulatorBehavior } from "../src/index.js";

const pass = { status: 200, message: "", payload: { ok: true, problems: [] } } as const;
const fail = {
  status: 200,
  message: "",
  payload: { ok: false, problems: [{ id: "broken", parameters: {} }] },
} as const;

async function input(timeoutMs = 1000): Promise<RegulationInput> {
  return {
    spec: makeRegulatorSpec(
      await fixture().load(),
      {
        targetLevel: "terminal",
        agentExecutionLimits: { timeoutMs },
      },
      { id: "test-agent" },
    ),
    subject: { name: "repo" },
  };
}

async function until(predicate: () => boolean, message = "condition") {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, `Timed out waiting for ${message}.`);
    await delay(1);
  }
}

test("pure reusable recipe is JSON data; target is a local identity, not a numeric order", async () => {
  const value = await input();
  assert.deepEqual(JSON.parse(JSON.stringify(value.spec)), value.spec);
  assert.equal("subject" in value.spec, false);
  assert.equal("agentExecutionLimits" in value.spec, false);
  assert.throws(
    () =>
      makeRegulatorSpec(
        value.spec.pilot,
        {
          targetLevel: "not-a-level",
          agentExecutionLimits: { timeoutMs: 1 },
        },
        { id: "test" },
      ),
    /root Pilot/,
  );
  assert.throws(
    () =>
      makeRegulatorSpec(
        value.spec.pilot,
        {
          targetLevel: "terminal",
          agentExecutionLimits: { timeoutMs: 0 },
        },
        { id: "test" },
      ),
    /timeoutMs/,
  );
  assert.throws(
    () =>
      makeRegulatorSpec(
        value.spec.pilot,
        {
          targetLevel: "terminal",
          agentExecutionLimits: { timeoutMs: 1 },
          ...{ maxIterations: 2 },
        },
        { id: "test" },
      ),
    /legacy budgets/,
  );
  assert.equal(
    decideRegulation(value, {
      current: { objectiveId, levelId: "terminal" },
      problems: [],
      gapSummary: "",
      observedAt: "",
      versions: {},
    }).type,
    "stop",
  );
  assert.throws(
    () =>
      decideRegulation(value, {
        current: { objectiveId: "git+https://other.test/repo.git#p.yaml", levelId: "terminal" },
        problems: [],
        gapSummary: "",
        observedAt: "",
        versions: {},
      }),
    /unrelated/,
  );
});

test("one regulation sends the complete observation and re-probes until target without round budgets", async () => {
  const value = await input();
  const agentInputs: AgentInput[] = [];
  const events: string[] = [];
  let rounds = 0;
  const result = await Effect.runPromise(
    regulate(value, {
      pilot: {
        resolveCheck: (ref) => async () => {
          events.push(`check:${ref.levelId}:${ref.checkId}`);
          return rounds < 5 ? fail : pass;
        },
      },
      async executeAgent(request) {
        events.push("agent");
        agentInputs.push(request);
        rounds++;
        return { status: "completed", summary: "Round complete." };
      },
      onObservation: (sample) => {
        events.push("observation");
        assert.ok(sample.payload !== null);
      },
    }),
  );
  assert.equal(result.stopReason, "target-reached");
  assert.equal(result.iterations, 5);
  assert.equal(agentInputs.length, 5);
  for (const request of agentInputs) {
    assert.equal(request.observation.problems.length, 2);
    assert.deepEqual(request.target, { objectiveId, levelId: "terminal" });
    assert.deepEqual(request.limits, { timeoutMs: 1000 });
    assert.equal("problem" in request, false);
  }
  assert.ok(events.indexOf("observation") < events.indexOf("agent"));
  assert.equal(events.at(-1), "observation");
});

test("invocation failure does not authorize an Agent", async () => {
  let calls = 0;
  const result = await Effect.runPromise(
    regulate(await input(), {
      pilot: {
        resolveCheck: () => async () => {
          throw new Error("offline");
        },
      },
      executeAgent: async () => {
        calls++;
        return { status: "completed", summary: "wrong" };
      },
    }),
  );
  assert.equal(result.stopReason, "invocation-failed");
  assert.equal(result.iterations, 0);
  assert.equal(calls, 0);
  assert.equal(result.latestObservation.payload, null);
});

test("explicit blocked, failed and per-call limit outcomes stop without new probe", async () => {
  for (const status of ["blocked", "failed", "limit-reached"] as const) {
    let observations = 0;
    const result = await Effect.runPromise(
      regulate(await input(), {
        pilot: { resolveCheck: () => async () => fail },
        executeAgent: async () => ({ status, reason: "explicit reason" }),
        onObservation: () => {
          observations++;
        },
      }),
    );
    assert.equal(result.stopReason, `agent-${status}`);
    assert.equal(observations, 1);
  }
});

test("each Agent receives a fresh full execution allowance, not a cumulative timeout", async () => {
  let rounds = 0;
  const limits: number[] = [];
  const result = await Effect.runPromise(
    regulate(await input(100), {
      pilot: { resolveCheck: () => async () => (rounds < 3 ? fail : pass) },
      async executeAgent(request) {
        limits.push(request.limits.timeoutMs);
        await delay(45);
        rounds++;
        return { status: "completed", summary: "done" };
      },
    }),
  );
  assert.equal(result.stopReason, "target-reached");
  assert.deepEqual(limits, [100, 100, 100]);
});

test("hard Agent time limit requests Abort without waiting for ignored cleanup", async () => {
  let aborted = false;
  const result = await Effect.runPromise(
    regulate(await input(20), {
      pilot: { resolveCheck: () => async () => fail },
      executeAgent: async (_request, signal) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        );
        return await new Promise(() => {});
      },
    }),
  );
  assert.equal(result.stopReason, "agent-limit-reached");
  assert.equal(aborted, true);
  assert.equal("cancel" in result, false);
});

test("parent cancellation is lifecycle failure, not a business stop reason", async () => {
  const value = await input();
  let started = false;
  let aborted = false;
  const controller = new AbortController();
  const running = startEffect(
    regulate(value, {
      pilot: { resolveCheck: () => async () => fail },
      executeAgent: async (_input, signal) => {
        started = true;
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return await new Promise(() => {});
      },
    }),
    controller.signal,
  );
  await until(() => started);
  controller.abort();
  await assert.rejects(running.await());
  assert.equal(aborted, true);
});

test("FRP keeps in-flight Pilot for strategy/binding changes, aborts old Agent first and rejects late effects", async () => {
  const value = await input();
  const source = await Effect.runPromise(SubscriptionRef.make(value));
  const pending: (() => void)[] = [];
  const events: string[] = [];
  let checks = 0;
  let agents = 0;
  let unblockFirst: (() => void) | undefined;
  const reports: string[] = [];
  const runtime: RegulationRuntime = {
    pilot: {
      checkConcurrency: 2,
      resolveCheck: () => async () => {
        checks++;
        await new Promise<void>((resolve) => pending.push(resolve));
        return fail;
      },
    },
    executeAgent: async (request, signal) => {
      agents++;
      events.push(`start:${request.binding.id}`);
      signal.addEventListener("abort", () => events.push(`abort:${request.binding.id}`));
      if (request.binding.id === "test-agent") {
        return new Promise((resolve) => {
          unblockFirst = () => resolve({ status: "completed", summary: "late old result" });
        });
      }
      return { status: "blocked", reason: "new binding" };
    },
    onObservation: (observation) => {
      if (observation.payload !== null) reports.push(observation.payload.current.objectiveId);
    },
  };
  const behavior = await regulatorBehavior(source, runtime);
  assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(behavior.observation)), {
    state: "initial",
  });
  await until(() => checks === 2);
  const strategyChanged: RegulationInput = {
    ...value,
    spec: makeRegulatorSpec(
      value.spec.pilot,
      { ...value.spec.strategy, targetLevel: "a-next" },
      value.spec.binding,
    ),
  };
  await Effect.runPromise(SubscriptionRef.set(source, strategyChanged));
  await delay(10);
  assert.equal(checks, 2);
  for (const resolve of pending.splice(0)) resolve();
  await until(() => agents === 1);
  const bindingChanged: RegulationInput = {
    ...strategyChanged,
    spec: makeRegulatorSpec(value.spec.pilot, strategyChanged.spec.strategy, { id: "replacement" }),
  };
  await Effect.runPromise(SubscriptionRef.set(source, bindingChanged));
  await until(() => agents === 2);
  assert.ok(events.indexOf("abort:test-agent") < events.indexOf("start:replacement"));
  assert.equal(checks, 2);
  const last = await Effect.runPromise(SubscriptionRef.get(behavior.outcome));
  assert.equal(last.state, "ready");
  if (last.state === "ready") assert.equal(last.value.stopReason, "agent-blocked");
  unblockFirst?.();
  await delay(10);
  assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(behavior.outcome)), last);
  assert.equal(checks, 2);
  assert.equal(reports.length, 2);
  await behavior.close();
});

test("FRP complete snapshot changes replace Pilot; old noncooperating result cannot overwrite the new state", async () => {
  const value = await input();
  const source = await Effect.runPromise(SubscriptionRef.make(value));
  const pending: (() => void)[] = [];
  let checks = 0;
  const reports: string[] = [];
  const events: string[] = [];
  const behavior = await regulatorBehavior(source, {
    pilot: {
      checkConcurrency: 2,
      resolveCheck: () => async (subject, signal) => {
        events.push(`start:${subject.name}`);
        signal.addEventListener("abort", () => events.push(`abort:${subject.name}`));
        checks++;
        if (subject.name === "repo") await new Promise<void>((resolve) => pending.push(resolve));
        return pass;
      },
    },
    executeAgent: async () => ({ status: "blocked", reason: "not required" }),
    onObservation: (sample) => {
      if (sample.payload !== null) reports.push(sample.payload.current.levelId);
    },
  });
  await until(() => checks === 2);
  await Effect.runPromise(SubscriptionRef.set(source, { ...value, subject: { name: "new" } }));
  await until(() => reports.length === 1);
  assert.ok(events.indexOf("abort:repo") < events.indexOf("start:new"));
  assert.equal(pending.length, 2, "Replacement must not wait for the old probe cleanup.");
  const state = await Effect.runPromise(SubscriptionRef.get(behavior.observation));
  assert.equal(state.state, "ready");
  for (const resolve of pending.splice(0)) resolve();
  await delay(10);
  assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(behavior.observation)), state);
  assert.deepEqual(reports, ["terminal"]);
  await behavior.close();
});
