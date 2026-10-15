import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ObjectiveGuide,
  ObjectiveGuideInstance,
  ObjectiveLevelDescription,
  ObjectiveObservation,
  ObservedProblem,
} from "@potential-guide/objective-guide";
import type { ObjectiveActionResult } from "@potential-guide/objective-regulator";
import {
  createObjectiveRegulator,
  ObjectiveRegulatorError,
} from "@potential-guide/objective-regulator";

interface Harness {
  instance: ObjectiveGuideInstance;
  setLevel(index: number): void;
  setProblems(problems: readonly ObservedProblem[]): void;
  probeCount(): number;
}

function harness(): Harness {
  let levelIndex = 0;
  let problems: readonly ObservedProblem[] = [
    { id: "repair", parameters: { description: "Repair the objective" } },
  ];
  let probes = 0;
  let instance: ObjectiveGuideInstance;
  const guide: ObjectiveGuide = {
    manifestUri: "https://objectives.test/guide.yaml",
    domainSchema: { type: "object" },
    prerequisite: null,
    createInstance: () => ({ ok: true, instance }),
  };
  let levels: readonly ObjectiveLevelDescription[] = [];
  instance = Object.freeze({
    guide,
    subject: Object.freeze({}),
    language: "en-US",
    title: "Objective",
    description: "Test objective",
    prerequisite: null,
    describeLevels: () => levels,
    async probe(): Promise<ObjectiveObservation> {
      probes += 1;
      const current = levels[levelIndex];
      if (current === undefined) {
        throw new Error("Invalid test level.");
      }
      return Object.freeze({
        current,
        problems: Object.freeze([...problems]),
        gapSummary: problems
          .map(({ parameters }) => String(parameters.description ?? ""))
          .join("\n"),
      });
    },
    async readPage(id: string) {
      return { id, title: id, content: id };
    },
    async searchPages() {
      return [];
    },
  });
  levels = Object.freeze(
    ["unready", "ready", "terminal"].map((id, index) =>
      Object.freeze({
        instance,
        id,
        title: id,
        description: id,
        advancementOutcome: index === 2 ? null : `Advance from ${id}`,
      }),
    ),
  );
  return {
    instance,
    setLevel(index) {
      levelIndex = index;
      if (index === 2) {
        problems = [];
      }
    },
    setProblems(value) {
      problems = value;
    },
    probeCount: () => probes,
  };
}

const limits = {
  maxIterations: 5,
  timeoutMs: 1_000,
  maxStalledIterations: 2,
};

test("regulates one action at a time and confirms progress with a new probe", async () => {
  const subject = harness();
  const regulator = createObjectiveRegulator(subject.instance);
  const requests: string[] = [];
  const result = await regulator.regulate(
    { targetLevelId: "terminal", limits },
    async ({ targetLevelId, observation, problem }) => {
      requests.push(`${targetLevelId}/${observation.current.id}/${problem.id}`);
      subject.setLevel(2);
      return { status: "completed", summary: "Repaired" };
    },
  );

  assert.equal(result.status, "target-reached");
  assert.equal(result.iterations, 1);
  assert.equal(result.latestObservation.current.id, "terminal");
  assert.deepEqual(requests, ["terminal/unready/repair"]);
  assert.equal(subject.probeCount(), 2);
});

test("returns explicit blocked, stalled, exhausted, and no-action statuses", async () => {
  const blocked = harness();
  const blockedResult = await createObjectiveRegulator(blocked.instance).regulate(
    { targetLevelId: "terminal", limits },
    async () => ({ status: "blocked", reason: "Needs a human" }),
  );
  assert.equal(blockedResult.status, "action-blocked");
  assert.equal(blockedResult.iterations, 1);
  assert.equal(blocked.probeCount(), 1);

  const stalled = harness();
  const stalledResult = await createObjectiveRegulator(stalled.instance).regulate(
    { targetLevelId: "terminal", limits },
    async () => ({ status: "completed", summary: "Tried" }),
  );
  assert.equal(stalledResult.status, "no-progress");
  assert.equal(stalledResult.iterations, 2);
  assert.equal(stalled.probeCount(), 3);

  const exhausted = harness();
  const exhaustedResult = await createObjectiveRegulator(exhausted.instance).regulate(
    {
      targetLevelId: "terminal",
      limits: { ...limits, maxIterations: 1, maxStalledIterations: 10 },
    },
    async () => ({ status: "completed", summary: "Tried" }),
  );
  assert.equal(exhaustedResult.status, "max-iterations");
  assert.equal(exhaustedResult.iterations, 1);

  const noAction = harness();
  noAction.setProblems([]);
  const noActionResult = await createObjectiveRegulator(noAction.instance).regulate(
    { targetLevelId: "terminal", limits },
    async () => assert.fail("Executor must not be called."),
  );
  assert.equal(noActionResult.status, "no-actionable-problem");
  assert.equal(noActionResult.iterations, 0);
});

test("bounds waiting time while retaining the latest completed observation", async () => {
  const subject = harness();
  const regulator = createObjectiveRegulator(subject.instance);
  const result = await regulator.regulate(
    {
      targetLevelId: "terminal",
      limits: { maxIterations: 2, timeoutMs: 20, maxStalledIterations: 2 },
    },
    async () => new Promise<ObjectiveActionResult>(() => undefined),
  );
  assert.equal(result.status, "timed-out");
  assert.equal(result.iterations, 1);
  assert.equal(result.latestObservation.current.id, "unready");
});

test("rejects invalid targets, limits, and executor results", async () => {
  const subject = harness();
  const regulator = createObjectiveRegulator(subject.instance);
  await assert.rejects(
    regulator.regulate({ targetLevelId: "missing", limits }, async () => ({
      status: "completed",
      summary: "No-op",
    })),
    ObjectiveRegulatorError,
  );
  await assert.rejects(
    regulator.regulate(
      {
        targetLevelId: "terminal",
        limits: { maxIterations: -1, timeoutMs: 1, maxStalledIterations: 1 },
      },
      async () => ({ status: "completed", summary: "No-op" }),
    ),
    ObjectiveRegulatorError,
  );
  await assert.rejects(
    regulator.regulate({ targetLevelId: "terminal", limits }, async () => ({
      status: "completed",
      summary: "",
    })),
    ObjectiveRegulatorError,
  );
});
