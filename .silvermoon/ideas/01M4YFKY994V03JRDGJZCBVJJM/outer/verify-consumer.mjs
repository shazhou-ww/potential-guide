import assert from "node:assert/strict";
import { createObjectiveLoader } from "../../../../packages/objective-guide/dist/index.js";
import { createObjectivePortfolioSupervisor } from "../../../../packages/objective-portfolio-supervisor/dist/index.js";
import { createObjectiveRegulator } from "../../../../packages/objective-regulator/dist/index.js";

async function exercise(concurrency) {
  let repaired = false;
  let active = 0;
  let maximum = 0;
  let laterRuns = 0;
  const manifest = {
    schemaVersion: 1,
    domainSchema: { type: "object" },
    levels: [
      { id: "stage", advancement: { checks: ["first", "second"] } },
      { id: "later", advancement: { checks: ["later"] } },
    ],
    defaultLanguage: "zh-CN",
    languages: ["zh-CN"],
  };
  const references = [
    ["system/overview", { title: "使用方验证", description: "主分支使用方验证" }],
    ["system/404", { title: "未找到", description: "页面不存在" }],
    ["levels/stage", { title: "阶段", description: "已达成阶段", outcome: "进入下一阶段" }],
    ["levels/later", { title: "后续阶段", description: "后续阶段", outcome: "达成目标" }],
    ["levels/terminal", { title: "完成", description: "目标已达成" }],
    ["checks/first", { title: "第一项", description: "第一项检查" }],
    ["checks/second", { title: "第二项", description: "第二项检查" }],
    ["checks/later", { title: "后续检查", description: "后续阶段检查" }],
    ["problems/repair", { title: "需要修复", description: "修复当前阶段" }],
  ];
  const loader = createObjectiveLoader({
    resources: {
      async readText() {
        return JSON.stringify(manifest);
      },
      async readPages(sourceUri) {
        return references.map(([id, properties]) => ({
          uri: new URL(`${id}/zh-CN.md`, sourceUri).href,
          source: `---\n${JSON.stringify(properties)}\n---\n`,
        }));
      },
    },
    checkSchedulingPolicy: () => concurrency,
    checkRunner: {
      async run(_uri, id) {
        maximum = Math.max(maximum, ++active);
        await Promise.resolve();
        active -= 1;
        if (id === "later") {
          laterRuns += 1;
          return { pass: true };
        }
        return repaired
          ? { pass: true }
          : { pass: false, problems: [{ id: "repair", parameters: { checkId: id } }] };
      },
    },
  });
  const guide = await loader.load("https://consumer.test/objective-guide.yaml");
  const created = guide.createInstance({ subject: {} });
  assert.ok(created.ok);
  const regulator = createObjectiveRegulator(created.instance);
  const supervisor = createObjectivePortfolioSupervisor(
    [{
      id: "consumer",
      regulator,
      safety: { defensiveThresholdId: "stage", defensiveTargetLevelId: "terminal" },
    }],
    async () => ({
      directives: [{
        registrationId: "consumer",
        targetLevelId: "terminal",
        trigger: "defensive",
        rationale: "验证修复与重新观测",
        limits: { maxIterations: 2, timeoutMs: 5_000, maxStalledIterations: 2 },
      }],
      deferred: [],
    }),
  );
  const observed = await supervisor.observe();
  const sample = observed.entries[0].observation;
  assert.equal(sample.current.id, "stage");
  assert.deepEqual(sample.problems.map(({ parameters }) => parameters.checkId), ["first", "second"]);
  assert.equal(laterRuns, 0);
  const execution = await supervisor.execute(
    await supervisor.plan(observed),
    async () => {
      repaired = true;
      return { status: "completed", summary: "当前阶段已修复" };
    },
  );
  assert.equal(execution.results[0].result.status, "target-reached");
  assert.equal(execution.results[0].result.latestObservation.current.id, "terminal");
  assert.equal(laterRuns, 1);
  assert.equal(maximum, concurrency);
  return {
    currentLevel: sample.current.id,
    problems: sample.problems,
    gapSummary: sample.gapSummary,
    finalLevel: execution.results[0].result.latestObservation.current.id,
    laterRuns,
    maximum,
  };
}

const serial = await exercise(1);
const parallel = await exercise(2);
assert.deepEqual({ ...serial, maximum: 0 }, { ...parallel, maximum: 0 });
console.log(JSON.stringify({ serial, parallel, publication: "not-performed" }, null, 2));
