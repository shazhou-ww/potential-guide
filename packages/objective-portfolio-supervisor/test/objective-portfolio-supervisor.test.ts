import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ObjectiveGuide,
  ObjectiveGuideInstance,
  ObjectiveLevelDescription,
  ObjectiveObservation,
} from "@potential-guide/objective-guide";
import { createObjectiveLoader } from "@potential-guide/objective-guide";
import type {
  ObjectivePortfolioPolicy,
  ObjectiveRegistration,
} from "@potential-guide/objective-portfolio-supervisor";
import {
  createObjectivePortfolioSupervisor,
  ObjectivePortfolioError,
} from "@potential-guide/objective-portfolio-supervisor";
import { createObjectiveRegulator } from "@potential-guide/objective-regulator";

interface Harness {
  instance: ObjectiveGuideInstance;
  registration: ObjectiveRegistration;
  setLevel(index: number): void;
}

function harness(id: string, initialLevel: number, probeLog: string[]): Harness {
  let levelIndex = initialLevel;
  let instance: ObjectiveGuideInstance;
  const guide: ObjectiveGuide = {
    manifestUri: `https://objectives.test/${id}.yaml`,
    domainSchema: { type: "object" },
    prerequisite: null,
    createInstance: () => ({ ok: true, instance }),
  };
  let levels: readonly ObjectiveLevelDescription[] = [];
  instance = Object.freeze({
    guide,
    subject: Object.freeze({ id }),
    language: "en-US",
    title: id,
    description: `${id} objective`,
    prerequisite: null,
    describeLevels: () => levels,
    async probe(): Promise<ObjectiveObservation> {
      probeLog.push(id);
      const current = levels[levelIndex];
      if (current === undefined) {
        throw new Error("Invalid test level.");
      }
      const problems =
        current.id === "terminal"
          ? []
          : [{ id: `${id}-repair`, parameters: { description: `Advance ${id}` } }];
      return Object.freeze({
        current,
        problems: Object.freeze(problems),
        gapSummary: problems
          .map(({ parameters }) => String(parameters.description ?? ""))
          .join("\n"),
      });
    },
    async readPage(pageId: string) {
      return { id: pageId, title: pageId, content: pageId };
    },
    async searchPages() {
      return [];
    },
  });
  levels = Object.freeze(
    ["critical", "safe", "terminal"].map((levelId, index) =>
      Object.freeze({
        instance,
        id: levelId,
        title: levelId,
        description: levelId,
        advancementOutcome: index === 2 ? null : `Advance ${id}`,
      }),
    ),
  );
  return {
    instance,
    registration: {
      id,
      regulator: createObjectiveRegulator(instance),
      safety: {
        defensiveThresholdId: "critical",
        defensiveTargetLevelId: "safe",
      },
    },
    setLevel(index) {
      levelIndex = index;
    },
  };
}

const limits = {
  maxIterations: 3,
  timeoutMs: 1_000,
  maxStalledIterations: 2,
};

test("loaded same-level checks retain injected scheduling through supervision and regulation", async () => {
  const missing = new Set(["first", "second"]);
  let active = 0;
  let maximum = 0;
  let policyCalls = 0;
  const manifestUri = "https://objectives.test/scheduled/manifest.yaml";
  const loader = createObjectiveLoader({
    resources: {
      async readText() {
        return JSON.stringify({
          schemaVersion: 1,
          domainSchema: { type: "object" },
          levels: [{ id: "stage", advancement: { checks: ["first", "second"] } }],
          defaultLanguage: "en-US",
          languages: ["en-US"],
        });
      },
      async readPages(sourceUri) {
        return [
          ["system/overview", { title: "Scheduled", description: "Scheduled objective" }],
          ["system/404", { title: "Missing", description: "Missing page" }],
          ["levels/stage", { title: "Stage", description: "Attained stage", outcome: "Advance" }],
          ["levels/terminal", { title: "Terminal", description: "Complete" }],
          ["checks/first", { title: "First", description: "First check" }],
          ["checks/second", { title: "Second", description: "Second check" }],
          ["problems/repair", { title: "Repair", description: "Repair check" }],
        ].map(([id, properties]) => ({
          uri: new URL(`${id}/en-US.md`, sourceUri).href,
          source: `---\n${JSON.stringify(properties)}\n---\n`,
        }));
      },
    },
    checkSchedulingPolicy: () => {
      policyCalls += 1;
      return 2;
    },
    checkRunner: {
      async run(_uri, id) {
        maximum = Math.max(maximum, ++active);
        await Promise.resolve();
        active -= 1;
        return missing.has(id)
          ? { pass: false, problems: [{ id: "repair", parameters: { checkId: id } }] }
          : { pass: true };
      },
    },
  });
  const guide = await loader.load(manifestUri);
  const created = guide.createInstance({ subject: {} });
  if (!created.ok) assert.fail("Expected loaded instance.");
  const supervisor = createObjectivePortfolioSupervisor(
    [
      {
        id: "scheduled",
        regulator: createObjectiveRegulator(created.instance),
        safety: { defensiveThresholdId: "stage", defensiveTargetLevelId: "terminal" },
      },
    ],
    async () => ({
      directives: [
        {
          registrationId: "scheduled",
          targetLevelId: "terminal",
          trigger: "defensive",
          rationale: "Repair the attained stage.",
          limits,
        },
      ],
      deferred: [],
    }),
  );
  const observed = await supervisor.observe();
  assert.equal(observed.entries[0]?.observation.problems.length, 2);
  const actions: string[] = [];
  const results = await supervisor.execute(await supervisor.plan(observed), async ({ problem }) => {
    const id = problem.parameters.checkId;
    if (typeof id !== "string") assert.fail("Expected check identity.");
    actions.push(id);
    missing.delete(id);
    return { status: "completed", summary: `Repaired ${id}` };
  });
  assert.deepEqual(actions, ["first", "second"]);
  assert.equal(maximum, 2);
  assert.equal(policyCalls, 4);
  assert.equal(results.results[0]?.result.status, "target-reached");
  assert.equal(results.results[0]?.result.latestObservation.current.id, "terminal");
});

test("observes sequentially, plans defense first, and executes in policy order", async () => {
  const probes: string[] = [];
  const defensive = harness("defensive", 0, probes);
  const growth = harness("growth", 1, probes);
  const policy: ObjectivePortfolioPolicy = async () => ({
    directives: [
      {
        registrationId: "defensive",
        targetLevelId: "safe",
        trigger: "defensive",
        rationale: "Restore the safety floor.",
        limits,
      },
      {
        registrationId: "growth",
        targetLevelId: "terminal",
        trigger: "opportunistic",
        rationale: "Use remaining capacity.",
        limits,
      },
    ],
    deferred: [],
  });
  const supervisor = createObjectivePortfolioSupervisor(
    [defensive.registration, growth.registration],
    policy,
  );

  const observation = await supervisor.observe();
  assert.deepEqual(probes, ["defensive", "growth"]);
  assert.deepEqual(
    observation.entries.map(({ registrationId }) => registrationId),
    ["defensive", "growth"],
  );

  const plan = await supervisor.plan(observation);
  assert.ok(Object.isFrozen(plan));
  assert.deepEqual(
    plan.directives.map(({ registrationId, trigger }) => [registrationId, trigger]),
    [
      ["defensive", "defensive"],
      ["growth", "opportunistic"],
    ],
  );

  const harnessByInstance = new Map([
    [defensive.instance, defensive],
    [growth.instance, growth],
  ]);
  const execution = await supervisor.execute(
    plan,
    async ({ targetLevelId, observation: current }) => {
      const target = harnessByInstance.get(current.current.instance);
      if (target === undefined) {
        throw new Error("Unknown test instance.");
      }
      target.setLevel(targetLevelId === "safe" ? 1 : 2);
      return { status: "completed", summary: `Reached ${targetLevelId}` };
    },
  );
  assert.deepEqual(
    execution.results.map(({ registrationId, result }) => [registrationId, result.status]),
    [
      ["defensive", "target-reached"],
      ["growth", "target-reached"],
    ],
  );
});

test("requires policy coverage and mandatory defensive recovery", async () => {
  const probes: string[] = [];
  const defensive = harness("defensive", 0, probes);
  const growth = harness("growth", 1, probes);
  const supervisor = createObjectivePortfolioSupervisor(
    [defensive.registration, growth.registration],
    async () => ({
      directives: [
        {
          registrationId: "growth",
          targetLevelId: "terminal",
          trigger: "opportunistic",
          rationale: "Grow first.",
          limits,
        },
      ],
      deferred: [
        {
          registrationId: "defensive",
          reason: "Wait.",
        },
      ],
    }),
  );
  await assert.rejects(
    supervisor.plan(await supervisor.observe()),
    /requires a defensive directive/,
  );

  const uncovered = createObjectivePortfolioSupervisor(
    [defensive.registration, growth.registration],
    async () => ({
      directives: [
        {
          registrationId: "defensive",
          targetLevelId: "safe",
          trigger: "defensive",
          rationale: "Restore safety.",
          limits,
        },
      ],
      deferred: [],
    }),
  );
  await assert.rejects(
    uncovered.plan(await uncovered.observe()),
    /direct or defer every registration/,
  );
});

test("rejects opportunistic work before defense and cross-instance targets", async () => {
  const probes: string[] = [];
  const defensive = harness("defensive", 0, probes);
  const growth = harness("growth", 1, probes);
  const wrongOrder = createObjectivePortfolioSupervisor(
    [defensive.registration, growth.registration],
    async () => ({
      directives: [
        {
          registrationId: "growth",
          targetLevelId: "terminal",
          trigger: "opportunistic",
          rationale: "Grow.",
          limits,
        },
        {
          registrationId: "defensive",
          targetLevelId: "safe",
          trigger: "defensive",
          rationale: "Restore safety.",
          limits,
        },
      ],
      deferred: [],
    }),
  );
  await assert.rejects(
    wrongOrder.plan(await wrongOrder.observe()),
    /Defensive directives must precede/,
  );

  const wrongTarget = createObjectivePortfolioSupervisor(
    [defensive.registration, growth.registration],
    async () => ({
      directives: [
        {
          registrationId: "defensive",
          targetLevelId: "missing",
          trigger: "defensive",
          rationale: "Invalid target.",
          limits,
        },
      ],
      deferred: [{ registrationId: "growth", reason: "Wait." }],
    }),
  );
  await assert.rejects(wrongTarget.plan(await wrongTarget.observe()), /target does not belong/);
});

test("validates registration identity and defensive thresholds", () => {
  const probes: string[] = [];
  const first = harness("duplicate", 0, probes);
  const second = harness("duplicate", 1, probes);
  assert.throws(
    () =>
      createObjectivePortfolioSupervisor([first.registration, second.registration], async () => ({
        directives: [],
        deferred: [],
      })),
    ObjectivePortfolioError,
  );

  assert.throws(
    () =>
      createObjectivePortfolioSupervisor(
        [
          {
            ...first.registration,
            id: "invalid-thresholds",
            safety: {
              defensiveThresholdId: "terminal",
              defensiveTargetLevelId: "safe",
            },
          },
        ],
        async () => ({ directives: [], deferred: [] }),
      ),
    ObjectivePortfolioError,
  );
});
