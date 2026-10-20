import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Exit, SubscriptionRef, startEffect } from "@potential-guide/effects";
import {
  createObjectiveDependencyProbe,
  type PilotRuntime,
  recordDependencyObservation,
} from "@potential-guide/objective-pilot";
import { fixture, manifest, objectiveId } from "../../objective-pilot/test/fixtures.js";
import {
  type AgentInput,
  type AgentOutcome,
  decideRegulation,
  makeRegulationPermissions,
  makeRegulatorSpec,
  RegulationError,
  type RegulationInput,
  type RegulationRuntime,
  type RegulationStrategy,
  regulate,
  regulatorBehavior,
} from "../src/index.js";

const pass = { status: 200, message: "", payload: { ok: true, problems: [] } } as const;
const fail = {
  status: 200,
  message: "",
  payload: { ok: false, problems: [{ kind: "internal" as const, id: "broken", parameters: {} }] },
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

const deniedRequest = {
  id: "request-1",
  operation: "edit",
  resources: ["/workspace/config.json"],
  reason: "No matching run grant.",
} as const;

test("permissions deny by default and selected ceiling grants are immutable run snapshots", async () => {
  const policy = {
    ceiling: [{ id: "edit-config", operation: "edit", resources: ["/workspace/config.json"] }],
    grants: ["edit-config"],
  } as const;
  for (const permissions of [undefined, policy]) {
    const base = await input();
    let repaired = false;
    await Effect.runPromise(
      regulate(
        { ...base, ...(permissions ? { permissions } : {}) },
        {
          pilot: { resolveCheck: () => async () => (repaired ? pass : fail) },
          async executeAgent(request) {
            assert.deepEqual(request.permissions, permissions ?? { ceiling: [], grants: [] });
            assert.ok(Object.isFrozen(request.permissions.grants));
            assert.ok(Object.isFrozen(request.permissions.ceiling));
            repaired = true;
            return completed;
          },
        },
      ),
    );
  }
});

test("invalid grant selections and expanding rules fail with 400 before Agent execution", async () => {
  const ceiling = [{ id: "read-config", operation: "read", resources: ["/workspace/config.json"] }];
  for (const permissions of [
    { ceiling, grants: ["missing"] },
    { ceiling, grants: ["read-config", "read-config"] },
    { ceiling, grants: [{ id: "read-config", operation: "execute", command: "anything" }] },
    { ceiling: [...ceiling, ...ceiling], grants: [] },
    { ceiling: [{ id: "unknown", operation: "network", resources: [] }], grants: [] },
    { ceiling: [{ id: "relative", operation: "read", resources: ["file.txt"] }], grants: [] },
    { ceiling: [{ id: "glob", operation: "edit", resources: ["/workspace/*"] }], grants: [] },
    { ceiling: [{ id: "exec", operation: "execute", command: "" }], grants: [] },
    { ceiling, grants: [], selfAuthorize: true },
  ]) {
    const error = await errorOf({ ...(await input()), permissions } as unknown as RegulationInput, {
      pilot: { resolveCheck: () => assert.fail("Invalid policy cannot reach probes.") },
      executeAgent: async () => assert.fail("Invalid policy cannot reach Agent."),
    });
    assert.equal(error.status, 400);
  }
  assert.deepEqual(makeRegulationPermissions(undefined), { ceiling: [], grants: [] });
});

test("unresolved authorization is normal after a fresh observation and does not consume stall history", async () => {
  for (const status of ["completed", "authorization-required"] as const) {
    let observations = 0;
    const result = await Effect.runPromise(
      regulate(
        { ...(await input()), history: { stalledRuns: 2 } },
        {
          pilot: { resolveCheck: () => async () => fail },
          executeAgent: async () =>
            status === "completed"
              ? {
                  status,
                  summary: "Alternative unavailable.",
                  authorizationRequests: [deniedRequest],
                }
              : { status, reason: "Requires approval.", authorizationRequests: [deniedRequest] },
          onObservation: () => observations++,
        },
      ),
    );
    assert.equal(result.stopReason, "authorization-required");
    assert.deepEqual(result.authorizationRequests, [deniedRequest]);
    assert.equal(result.latestObservation.status, 200);
    assert.equal(result.latestObservation.payload?.current.levelId, "z-first");
    assert.equal(result.stalledRuns, 2);
    assert.equal(result.iterations, 1);
    assert.equal(observations, 2);
  }
});

test("target and actual alternate-path progress win over denied requests", async () => {
  for (const intermediate of [false, true]) {
    let rounds = 0;
    const result = await Effect.runPromise(
      regulate(await input(), {
        pilot: {
          resolveCheck: (ref) => async () =>
            rounds > (intermediate ? 1 : 0) || (rounds === 1 && ref.checkId === "one")
              ? pass
              : fail,
        },
        executeAgent: async () => {
          rounds++;
          return { ...completed, authorizationRequests: [deniedRequest] };
        },
      }),
    );
    assert.equal(result.stopReason, "target-reached");
    assert.equal(result.iterations, intermediate ? 2 : 1);
    assert.equal(result.stalledRuns, 0);
    assert.equal(result.authorizationRequests, undefined);
  }
});

test("unresolved denial on the last allowed turn takes precedence over Agent and stall counts", async () => {
  let observations = 0;
  const result = await Effect.runPromise(
    regulate(await input({ quota: { ...quota, maxAgentRuns: 1, maxStallRuns: 1 } }), {
      pilot: { resolveCheck: () => async () => fail },
      executeAgent: async () => ({ ...completed, authorizationRequests: [deniedRequest] }),
      onObservation: () => observations++,
    }),
  );
  assert.equal(result.stopReason, "authorization-required");
  assert.equal(result.exhaustedBy, undefined);
  assert.deepEqual(result.authorizationRequests, [deniedRequest]);
  assert.equal(result.iterations, 1);
  assert.equal(observations, 2);
  assert.equal(result.stalledRuns, 0);
  assert.equal(result.latestObservation.status, 200);
});

test("target or actual progress on the last allowed denied turn is not authorization-blocked", async () => {
  for (const reachTarget of [false, true]) {
    let executed = false;
    const result = await Effect.runPromise(
      regulate(await input({ quota: { ...quota, maxAgentRuns: 1, maxStallRuns: 1 } }), {
        pilot: {
          resolveCheck: (ref) => async () =>
            executed && (reachTarget || ref.checkId === "one") ? pass : fail,
        },
        executeAgent: async () => {
          executed = true;
          return { ...completed, authorizationRequests: [deniedRequest] };
        },
      }),
    );
    assert.equal(result.stopReason, reachTarget ? "target-reached" : "exhausted");
    assert.equal(result.exhaustedBy, reachTarget ? undefined : "agent-runs");
    assert.equal(result.authorizationRequests, undefined);
    assert.equal(result.stalledRuns, 0);
  }
});

test("malformed authorization outcomes fail with 502 instead of manufacturing approval", async () => {
  for (const agentOutcome of [
    { status: "authorization-required", reason: "Need approval." },
    { status: "authorization-required", reason: "Need approval.", authorizationRequests: [] },
    { ...completed, authorizationRequests: [{ ...deniedRequest, resources: "file" }] },
    { ...completed, authorizationRequests: [{ ...deniedRequest, operation: "" }] },
    { ...completed, authorizationRequests: [{ ...deniedRequest, grants: ["self-granted"] }] },
    { status: "failed", reason: "failure", authorizationRequests: [deniedRequest] },
  ]) {
    assert.equal(
      (
        await errorOf(await input(), {
          pilot: { resolveCheck: () => async () => fail },
          executeAgent: async () => agentOutcome as unknown as AgentOutcome,
        })
      ).status,
      502,
    );
  }
});

test("permission replacement aborts old work, isolates late authorization responses and freshly observes on resume", async () => {
  const base = await input();
  const granted = {
    ceiling: [{ id: "repair", operation: "execute", command: "node repair.js" }],
    grants: ["repair"],
  } as const;
  const source = await Effect.runPromise(
    SubscriptionRef.make<RegulationInput>({ ...base, permissions: granted }),
  );
  let calls = 0;
  let observations = 0;
  let repaired = false;
  let aborted = false;
  let release: (() => void) | undefined;
  const behavior = await regulatorBehavior(source, {
    pilot: { resolveCheck: () => async () => (repaired ? pass : fail) },
    async executeAgent(request, signal) {
      calls++;
      if (calls === 1) {
        assert.deepEqual(request.permissions.grants, ["repair"]);
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      } else assert.deepEqual(request.permissions.grants, []);
      return { ...completed, authorizationRequests: [deniedRequest] };
    },
    onObservation: () => observations++,
  });
  try {
    await until(() => calls === 1);
    await Effect.runPromise(SubscriptionRef.set(source, base));
    await until(() => observations === 3 && calls === 2);
    await delay(5);
    assert.equal(aborted, true);
    const blocked = await Effect.runPromise(SubscriptionRef.get(behavior.outcome));
    assert.equal(blocked.state, "ready");
    if (blocked.state === "ready") assert.equal(blocked.value.stopReason, "authorization-required");
    release?.();
    await delay(10);
    assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(behavior.outcome)), blocked);
    repaired = true;
    await Effect.runPromise(SubscriptionRef.set(source, { ...base, permissions: granted }));
    await until(() => observations === 4);
    await delay(5);
    const resumed = await Effect.runPromise(SubscriptionRef.get(behavior.outcome));
    assert.equal(resumed.state, "ready");
    if (resumed.state === "ready") assert.equal(resumed.value.stopReason, "target-reached");
    assert.equal(calls, 2, "Resume must observe current reality before choosing another Agent.");
  } finally {
    release?.();
    await behavior.close();
  }
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
          payload: {
            ok: false,
            problems: [{ kind: "internal" as const, id: "broken", parameters: { round } }],
          },
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
async function dependencyRuntime(ready: () => boolean, mixed = false): Promise<PilotRuntime> {
  const child = await fixture({ [childId]: manifest() }).load(childId);
  const probe = createObjectiveDependencyProbe(
    { spec: child, expectedLevelId: "a-next" },
    { resolveCheck: () => async () => (ready() ? pass : fail) },
    { recordObservation: recordDependencyObservation },
  );
  return {
    resolveCheck: (ref) => async (subject, signal) =>
      mixed && ref.checkId === "two"
        ? fail
        : probe({ name: `${subject.name}-${ref.checkId}` }, signal),
  };
}

test("all dependency problems and mixed internal problems hand off without an Agent or stall", async () => {
  for (const mixed of [false, true]) {
    const value = await input();
    const result = await Effect.runPromise(
      regulate(value, {
        pilot: await dependencyRuntime(() => false, mixed),
        executeAgent: async () => assert.fail("Dependencies must never reach root Agent."),
      }),
    );
    assert.equal(result.stopReason, "dependency-required");
    if (result.stopReason !== "dependency-required") assert.fail();
    assert.equal(result.iterations, 0);
    assert.equal(result.stalledRuns, 0);
    assert.equal(result.dependencies.length, mixed ? 1 : 2);
    assert.equal(result.dependencies[0].objectiveId, childId);
    assert.equal(result.latestObservation.payload?.current.objectiveId, objectiveId);
    assert.deepEqual(
      result.dependencies,
      result.latestObservation.payload?.problems.filter((problem) => problem.kind === "dependency"),
    );
  }
});

test("dependency after a repair hands off before accumulating an internal stall", async () => {
  let regressed = false;
  let agents = 0;
  const dependency = await dependencyRuntime(() => !regressed);
  const result = await Effect.runPromise(
    regulate(await input(), {
      pilot: {
        resolveCheck: (ref) => async (subject, signal) =>
          regressed ? dependency.resolveCheck(ref)(subject, signal) : fail,
      },
      executeAgent: async (request) => {
        assert.ok(
          request.observation.problems.every(
            (problem) => problem.kind === "internal" && problem.ref.objectiveId === objectiveId,
          ),
        );
        agents++;
        regressed = true;
        return completed;
      },
    }),
  );
  assert.equal(result.stopReason, "dependency-required");
  assert.equal(result.iterations, 1);
  assert.equal(result.stalledRuns, 0);
  assert.equal(agents, 1);
});

test("requested target attainment wins over dependencies needed only above that target", async () => {
  const result = await Effect.runPromise(
    regulate(
      { ...(await input({ targetLevel: "z-first" })), history: { stalledRuns: 2 } },
      {
        pilot: await dependencyRuntime(() => false, true),
        executeAgent: async () => assert.fail("The requested target is already reached."),
      },
    ),
  );
  assert.equal(result.stopReason, "target-reached");
  assert.equal(result.iterations, 0);
  assert.equal(result.stalledRuns, 2);
  assert.equal("dependencies" in result, false);
});

test("satisfied dependency permits internal repair and same-run target completion", async () => {
  let repaired = false;
  const dependency = await dependencyRuntime(() => true);
  const result = await Effect.runPromise(
    regulate(await input(), {
      pilot: {
        resolveCheck: (ref) => async (subject, signal) => {
          const result = await dependency.resolveCheck(ref)(subject, signal);
          return result.payload?.ok && !repaired ? fail : result;
        },
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

test("subject and deleted prerequisite validation failures precede every probe and Agent", async () => {
  const base = await input();
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
            prerequisite: { manifestUri: childId, subject: "$" },
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
    versions: { [objectiveId]: value.spec.pilot.version },
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
