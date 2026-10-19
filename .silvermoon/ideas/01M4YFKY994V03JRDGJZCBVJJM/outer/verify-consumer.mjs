import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Effect, startEffect, SubscriptionRef } from "../../../../packages/effects/dist/index.js";
import {
  canonicalManifestUri,
  loadPilotSpec,
  observe,
} from "../../../../packages/objective-pilot/dist/index.js";
import {
  createPortfolioCoordinator,
  createPortfolioPlanner,
} from "../../../../packages/objective-portfolio-supervisor/dist/index.js";
import { regulate } from "../../../../packages/objective-regulator/dist/index.js";

const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: new URL("../../../../", import.meta.url),
  encoding: "utf8",
}).trim();

async function exercise(concurrency) {
  let repaired = false;
  let active = 0;
  let maximum = 0;
  let laterRuns = 0;
  let agentRuns = 0;
  const objectiveId = "git+https://consumer.test/objectives.git#pilot.yaml";
  const manifest = {
    schemaVersion: 1,
    domainSchema: { type: "object" },
    levels: [
      {
        id: "stage",
        advancement: {
          checks: [
            { id: "first", problems: ["first-repair"] },
            { id: "second", problems: ["second-repair"] },
          ],
        },
      },
      { id: "later", advancement: { checks: [{ id: "later", problems: [] }] } },
    ],
    defaultLanguage: "zh-CN",
    languages: ["zh-CN"],
  };
  const ids = [
    "system/overview",
    "system/404",
    "levels/terminal",
    ...manifest.levels.flatMap((level) => [
      `levels/${level.id}`,
      ...level.advancement.checks.flatMap((check) => [
        `levels/${level.id}/checks/${check.id}`,
        ...check.problems.map(
          (problem) => `levels/${level.id}/checks/${check.id}/problems/${problem}`,
        ),
      ]),
    ]),
  ];
  const pilot = await loadPilotSpec(objectiveId, {
    version: baseline,
    async readText() {
      return JSON.stringify(manifest);
    },
    async readPages(sourceUri) {
      return ids.map((id) => ({
        uri: canonicalManifestUri(`${id}/zh-CN.md`, sourceUri),
        source: `---\ntitle: 使用方验证\ndescription: 主分支阶段屏障验证\nreferences: []\n---\n`,
      }));
    },
  });
  const runtime = {
    checkConcurrency: concurrency,
    resolveCheck: (ref) => async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, ref.checkId === "first" ? 10 : 1));
      active -= 1;
      if (ref.levelId === "later") {
        laterRuns += 1;
        return { status: 200, message: "", payload: { ok: true, problems: [] } };
      }
      return {
        status: 200,
        message: "",
        payload: repaired
          ? { ok: true, problems: [] }
          : {
              ok: false,
              problems: [{ id: `${ref.checkId}-repair`, parameters: { checkId: ref.checkId } }],
            },
      };
    },
  };
  const goal = {
    id: "consumer",
    pilot,
    subject: {},
    targetLevel: "terminal",
    priority: 1,
    observationIntervalMs: 60_000,
  };
  const planner = await createPortfolioPlanner({
    goals: [goal],
    periodic: false,
    observe: (value) => Effect.runPromise(observe({ spec: value.pilot, subject: value.subject }, runtime)),
  });
  let coordinator;
  let outcome;
  let failure;
  try {
    const state = await Effect.runPromise(SubscriptionRef.get(planner.state));
    const sample = state.observations.consumer.payload;
    assert.ok(sample);
    assert.equal(sample.current.levelId, "stage");
    assert.deepEqual(sample.problems.map(({ ref }) => ref.checkId), ["first", "second"]);
    assert.equal(laterRuns, 0);
    const resources = await Effect.runPromise(
      SubscriptionRef.make([{ id: "consumer-agent", binding: { id: "repair" }, capacity: 1, capabilities: [] }]),
    );
    coordinator = await createPortfolioCoordinator({
      queue: planner.queue,
      resources,
      maxConcurrency: 1,
      quota: { timeoutMs: 5_000, maxAgentRuns: 2, maxStallRuns: 2 },
      agentExecutionLimits: { timeoutMs: 1_000 },
      abortGraceMs: 100,
      onEvent(event) {
        if (event.type === "result") outcome = event.outcome;
        if (event.type === "failed") failure = event.error;
      },
      runner: {
        start(input) {
          const running = startEffect(regulate(input, {
            pilot: runtime,
            async executeAgent() {
              agentRuns += 1;
              repaired = true;
              return { status: "completed", summary: "当前阶段已修复" };
            },
          }));
          return {
            result: running.await(),
            abort: () => running.cancel(),
            async kill() {
              running.cancel();
              await running.exit();
            },
          };
        },
      },
    });
    const deadline = performance.now() + 10_000;
    while (!outcome && !failure) {
      assert.ok(performance.now() < deadline, "等待真实 supervisor/regulator 结果超时");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ifError(failure);
    assert.equal(outcome.stopReason, "target-reached");
    assert.equal(outcome.latestObservation.payload.current.levelId, "terminal");
    assert.equal(laterRuns, 1);
    assert.equal(agentRuns, 1);
    assert.equal(maximum, concurrency);
    return {
      currentLevel: sample.current.levelId,
      problems: sample.problems,
      gapSummary: sample.gapSummary,
      finalLevel: outcome.latestObservation.payload.current.levelId,
      laterRuns,
      agentRuns,
      maximum,
    };
  } finally {
    await coordinator?.close();
    await planner.close();
  }
}

const serial = await exercise(1);
const parallel = await exercise(2);
assert.deepEqual({ ...serial, maximum: 0 }, { ...parallel, maximum: 0 });
console.log(JSON.stringify({ baseline, serial, parallel, publication: "not-performed" }, null, 2));
