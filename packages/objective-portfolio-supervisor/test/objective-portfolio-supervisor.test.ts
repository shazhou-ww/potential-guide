import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryCheckProbe, type PilotSpec } from "@potential-guide/objective-pilot";
import {
  createObjectivePortfolioSupervisor,
  type ObjectivePortfolioPlan,
  type ObjectiveRegistration,
} from "@potential-guide/objective-portfolio-supervisor";
import { type AgentInput, makeRegulatorSpec } from "@potential-guide/objective-regulator";

function registration(id = "fixture") {
  let repaired = false;
  const calls: AgentInput[] = [];
  const spec: PilotSpec = {
    objectiveId: `git+file:///fixture.git#${id}/pilot.yaml`,
    version: "a".repeat(40),
    manifest: {
      schemaVersion: 1,
      domainSchema: { type: "object" },
      levels: [
        {
          id: "initial",
          advancement: {
            checks: [
              { id: "first", problems: ["not-ready"] },
              { id: "second", problems: ["not-ready"] },
            ],
          },
        },
      ],
      defaultLanguage: "en-US",
      languages: ["en-US"],
    },
    locales: {
      "en-US": {
        "levels/initial": {
          id: "levels/initial",
          title: "Initial",
          description: "Initial level",
          references: [],
          content: "Needs repair",
        },
        "levels/terminal": {
          id: "levels/terminal",
          title: "Terminal",
          description: "Done",
          references: [],
          content: "Done",
        },
        "problems/not-ready": {
          id: "problems/not-ready",
          title: "Not ready",
          description: "Repair",
          references: [],
          content: "Repair",
        },
      },
    },
  };
  const value: ObjectiveRegistration = {
    id,
    input: {
      spec: makeRegulatorSpec(
        spec,
        {
          targetLevel: "terminal",
          agentExecutionLimits: { timeoutMs: 1000 },
        },
        { id: "fixture" },
      ),
      subject: {},
    },
    runtime: {
      pilot: {
        resolveCheck: () =>
          createMemoryCheckProbe(() =>
            Promise.resolve(
              repaired
                ? { status: 200, payload: { ok: true, problems: [] }, message: "" }
                : {
                    status: 200,
                    payload: { ok: false, problems: [{ id: "not-ready", parameters: {} }] },
                    message: "",
                  },
            ),
          ),
      },
      executeAgent: async (input) => {
        calls.push(input);
        repaired = true;
        return { status: "completed", summary: "Repaired both checks" };
      },
    },
    safety: { defensiveThresholdId: "initial", defensiveTargetLevelId: "terminal" },
  };
  return { value, calls };
}

function plan(id = "fixture"): ObjectivePortfolioPlan {
  return {
    directives: [
      {
        registrationId: id,
        targetLevelId: "terminal",
        trigger: "defensive",
        rationale: "Restore safety",
        agentExecutionLimits: { timeoutMs: 1000 },
      },
    ],
    deferred: [],
  };
}

test("supervisor composes Pilot observation and complete-observation regulation", async () => {
  const fixture = registration();
  const supervisor = createObjectivePortfolioSupervisor([fixture.value], async () => plan());
  const observed = await supervisor.observe();
  assert.equal(observed.entries[0]?.observation.current.levelId, "initial");
  assert.equal(observed.entries[0]?.observation.problems.length, 2);
  const proposed = await supervisor.plan(observed);
  const result = await supervisor.execute(proposed);
  assert.equal(result.results[0]?.result.stopReason, "target-reached");
  assert.equal(result.results[0]?.result.iterations, 1);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0]?.observation.problems.length, 2);
  assert.deepEqual(fixture.calls[0]?.limits, { timeoutMs: 1000 });
});

test("invocation failure does not fabricate portfolio levels or execute Agents", async () => {
  const fixture = registration();
  fixture.value.runtime = {
    ...fixture.value.runtime,
    pilot: {
      resolveCheck: () =>
        createMemoryCheckProbe(async () => ({
          status: 503,
          payload: null,
          message: "Probe unavailable",
        })),
    },
  };
  const supervisor = createObjectivePortfolioSupervisor([fixture.value], async () => plan());
  await assert.rejects(supervisor.observe(), /Pilot invocation failed.*unavailable/);
  assert.equal(fixture.calls.length, 0);
});

test("defensive requirements, local target ownership, and full plan coverage remain enforced", async () => {
  const fixture = registration();
  const supervisor = createObjectivePortfolioSupervisor([fixture.value], async () => ({
    directives: [],
    deferred: [{ registrationId: "fixture", reason: "Wait" }],
  }));
  await assert.rejects(supervisor.plan(await supervisor.observe()), /requires a defensive/);
  await assert.rejects(supervisor.execute({ directives: [], deferred: [] }), /every registration/);
  await assert.rejects(
    supervisor.execute({
      directives: [{ ...plan().directives[0]!, targetLevelId: "foreign" }],
      deferred: [],
    }),
    /does not belong/,
  );
  assert.throws(
    () => createObjectivePortfolioSupervisor([fixture.value, fixture.value], async () => plan()),
    /Duplicate/,
  );
});

test("legacy cross-round limits are rejected rather than reinterpreted", async () => {
  const fixture = registration();
  const supervisor = createObjectivePortfolioSupervisor([fixture.value], async () => plan());
  const directive = plan().directives[0];
  assert.ok(directive);
  const legacyLimits = { timeoutMs: 1000, maxIterations: 2 };
  await assert.rejects(
    supervisor.execute({
      directives: [
        {
          ...directive,
          agentExecutionLimits: legacyLimits,
        },
      ],
      deferred: [],
    }),
    /cross-round/,
  );
});

test("pre-cancellation starts neither checks nor Agents", async () => {
  const fixture = registration();
  let probes = 0;
  fixture.value.runtime = {
    ...fixture.value.runtime,
    pilot: {
      resolveCheck: () =>
        createMemoryCheckProbe(async () => {
          probes++;
          return { status: 200, payload: { ok: true, problems: [] }, message: "" };
        }),
    },
  };
  const controller = new AbortController();
  controller.abort();
  const supervisor = createObjectivePortfolioSupervisor([fixture.value], async () => plan());
  await assert.rejects(supervisor.observe(controller.signal));
  assert.equal(probes, 0);
  assert.equal(fixture.calls.length, 0);
});

test("invalid registration recipes retain their diagnostic cause", () => {
  const fixture = registration();
  fixture.value.input = {
    ...fixture.value.input,
    spec: {
      ...fixture.value.input.spec,
      strategy: {
        ...fixture.value.input.spec.strategy,
        agentExecutionLimits: { timeoutMs: 0 },
      },
    },
  };
  assert.throws(
    () => createObjectivePortfolioSupervisor([fixture.value], async () => plan()),
    (error: unknown) =>
      error instanceof Error &&
      error.cause instanceof Error &&
      error.message.includes(error.cause.message),
  );
});
