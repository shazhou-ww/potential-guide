import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { type AgentProfile, atomicWrite } from "@potential-guide/cli-core";
import type { PlannerPolicyInput } from "@potential-guide/objective-portfolio-supervisor";
import { withPilot } from "../../cli-runtime/src/pilot-source.js";
import { createAcpPlannerPolicy, plannerPrompt } from "../../pguide-supervise/src/acp-planner.js";
import { parsePortfolioFile } from "../../pguide-supervise/src/commands/supervisor.js";
import { bin, fixture, git, root, run, scratch, writeConfig } from "./fixtures.js";

const stubSource = `
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const [mode, log, marker] = process.argv.slice(2);
writeFileSync(log + ".pid", String(process.pid));
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  appendFileSync(log, JSON.stringify(message) + "\\n");
  if (!message.id) continue;
  if (mode === "hang") continue;
  let result = {};
  if (message.method === "initialize") {
    if (message.params.protocolVersion !== 1) throw Error("Expected numeric ACP version");
    result = { protocolVersion: 1 };
  }
  if (message.method === "session/new") result = { sessionId: "planner-session" };
  if (message.method === "session/prompt") {
    if (mode === "repair") {
      console.log(JSON.stringify({ jsonrpc: "2.0", method: "pguide/capability-request",
        params: { capability: "additional-tool", reason: "Need a specialized verification tool" } }));
      const deadline = Date.now() + 15000;
      while (!existsSync(marker + ".planner-feedback")) {
        if (Date.now() > deadline) throw Error("Planner did not acknowledge capability feedback.");
        await new Promise(done => setTimeout(done, 25));
      }
      writeFileSync(marker, "repaired");
      result = { stopReason: "end_turn", summary: "Repaired" };
    } else {
      const context = JSON.parse(message.params.prompt[0].text.split("\\n").at(-1));
      if (context.observations.fixture?.payload?.current?.levelId === "terminal" &&
          context.previousQueue.demands.length === 0)
        writeFileSync(marker + ".terminal", "observed");
      if (message.params.prompt[0].text.includes("Need a specialized verification tool"))
        writeFileSync(marker + ".planner-feedback", "acknowledged");
      const directives = context.candidates.map(goal => ({ goalId: goal.id, priority: goal.priority }));
      let value = JSON.stringify({ directives });
      if (mode === "duplicate") value = JSON.stringify({ directives: [directives[0], directives[0]] });
      if (mode === "unknown") value = JSON.stringify({ directives: [{ goalId: "invented", priority: 0 }] });
      if (mode === "command") value = JSON.stringify({ directives: [{ ...directives[0], command: "arbitrary shell command" }] });
      if (mode === "malformed") value = "not JSON";
      if (mode === "oversized") value = "x".repeat(1100000);
      if (mode !== "summary-only") {
        for (const text of [value.slice(0, 5), value.slice(5)]) {
          console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {
            sessionId: message.params.sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } }
          }}));
        }
      }
      result = { stopReason: mode === "refusal" ? "refusal" : mode === "cancelled" ? "cancelled" : "end_turn", summary: value };
    }
  }
  console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
}
`;

function profile(stub: string, mode: string, log: string, marker = "unused"): AgentProfile {
  return {
    type: "acp",
    connection: { protocolVersion: "1" },
    transport: { type: "stdio", command: process.execPath, args: [stub, mode, log, marker] },
  };
}

test("ACP planner consumes standard text chunks, excludes inventory, and fails closed", async (t) => {
  const f = await fixture();
  try {
    const commit = await f.commit();
    const stub = join(f.directory, "planner.mjs");
    await writeFile(stub, stubSource);
    await withPilot(f.uri, root, commit, async (objective) => {
      const goal = {
        id: "registered",
        objective,
        subject: {},
        targetLevel: "terminal",
        priority: 2,
        observationIntervalMs: 1_000,
      };
      const input: PlannerPolicyInput = {
        goals: [goal],
        candidates: [goal],
        observations: {},
        previousQueue: { revision: 0, demands: [] },
        events: [
          {
            type: "started",
            demand: { ...goal, revision: 1 },
            resourceId: "SECRET_RESOURCE_INVENTORY",
          },
        ],
      };
      assert.doesNotMatch(plannerPrompt(input), /SECRET_RESOURCE_INVENTORY/);
      const log = join(f.directory, "normal.jsonl");
      const plan = await createAcpPlannerPolicy(profile(stub, "plan", log), root)(input);
      assert.deepEqual(plan, { directives: [{ goalId: "registered", priority: 2 }] });
      const messages = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(messages.filter((message) => message.method === "session/prompt").length, 1);
      for (const mode of [
        "duplicate",
        "unknown",
        "command",
        "malformed",
        "refusal",
        "cancelled",
        "summary-only",
        "oversized",
      ]) {
        await t.test(mode, async () => {
          const modeLog = join(f.directory, `${mode}.jsonl`);
          await assert.rejects(
            createAcpPlannerPolicy(profile(stub, mode, modeLog), root)(input),
            /invalid priority queue|malformed JSON|blocked|cancelled|no JSON text chunks|output limit/,
          );
          const pid = Number(await readFile(`${modeLog}.pid`, "utf8"));
          assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
        });
      }
      await t.test("startup timeout terminates the ACP process", async () => {
        const timeoutLog = join(f.directory, "timeout.jsonl");
        const before = Date.now();
        await assert.rejects(
          createAcpPlannerPolicy(profile(stub, "hang", timeoutLog), root, { timeoutMs: 500 })(
            input,
          ),
          /timed out/,
        );
        assert.ok(Date.now() - before < 5_000);
        if (existsSync(`${timeoutLog}.pid`)) {
          const pid = Number(await readFile(`${timeoutLog}.pid`, "utf8"));
          assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
        }
      });
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("supervise plans once without repairs, then continuously observes and executes a pinned goal once", async () => {
  const f = await fixture();
  let running: ReturnType<typeof run> | undefined;
  try {
    const marker = join(f.directory, "repaired");
    const counts = join(f.directory, "observations.jsonl");
    await writeFile(
      join(f.repository, "objective", "checks", "ready", "run.js"),
      `#!/usr/bin/env node\nimport{existsSync,appendFileSync}from"node:fs";let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const x=JSON.parse(s);appendFileSync(x.counts,"observed\\n");const ok=existsSync(x.marker);console.log(JSON.stringify({status:200,payload:ok?{ok:true,problems:[]}:{ok:false,problems:[{kind:"internal",id:"not-ready",parameters:{}}]},message:""}));});`,
    );
    const revision = await f.commit();
    const stub = join(f.directory, "agent.mjs");
    const plannerLog = join(f.directory, "planner.jsonl");
    const executorLog = join(f.directory, "executor.jsonl");
    await writeFile(stub, stubSource);
    const config = join(f.directory, "config.json");
    await writeConfig(
      config,
      JSON.stringify({
        schemaVersion: 2,
        agentExecutionLimits: { timeoutMs: 12_000 },
        objectives: { fixture: f.uri },
        agents: {
          strategist: profile(stub, "plan", plannerLog, marker),
          "private-execution-agent": profile(stub, "repair", executorLog, marker),
        },
      }),
    );
    const portfolio = join(f.directory, "portfolio.json");
    await writeFile(
      portfolio,
      JSON.stringify({
        schemaVersion: 3,
        goals: [
          {
            id: "fixture",
            objective: "@fixture",
            revision,
            subject: { marker, counts },
            targetLevel: "terminal",
            priority: 1,
            observationIntervalMs: 300,
          },
        ],
        resources: [
          {
            id: "PRIVATE_RESOURCE_ID",
            agent: "private-execution-agent",
            capacity: 1,
            capabilities: [],
          },
        ],
      }),
    );
    const args = [
      "--portfolio-file",
      portfolio,
      "--planner",
      "strategist",
      "--config",
      config,
      "--format",
      "json",
    ];
    const planned = await run(bin("supervise"), args);
    assert.equal(planned.code, 0, planned.stdout + planned.stderr);
    const report = JSON.parse(planned.stdout);
    assert.equal(report.schemaVersion, 3);
    assert.equal(report.status, "planned");
    assert.equal(report.observations.fixture.payload.current.levelId, "initial");
    assert.equal(report.queue.demands[0].id, "fixture");
    assert.equal(
      report.queue.demands[0].objective.version,
      await git(f.repository, "rev-parse", `${revision}:objective`),
    );
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(executorLog), false);
    assert.equal((await readFile(counts, "utf8")).trim().split("\n").length, 1);
    const portfolioValue = JSON.parse(await readFile(portfolio, "utf8"));
    const registeredResources = portfolioValue.resources;
    portfolioValue.resources = [];
    delete portfolioValue.goals[0].revision;
    await writeFile(portfolio, JSON.stringify(portfolioValue));
    const resourcePath = join(f.directory, ".pguide", "agents.yaml");
    const resource = JSON.parse(await readFile(resourcePath, "utf8"));
    const configuredExecutor = resource.agents["private-execution-agent"];
    delete resource.agents["private-execution-agent"];
    await atomicWrite(resourcePath, JSON.stringify(resource));
    const runner = join(f.directory, "supervise-until-observed.mjs");
    await writeFile(
      runner,
      `import {existsSync} from "node:fs";
const timer = setInterval(() => {
  if (existsSync(${JSON.stringify(`${marker}.terminal`)})) {
    clearInterval(timer);
    process.emit("SIGINT");
  }
}, 25);
timer.unref();
await import(${JSON.stringify(pathToFileURL(bin("supervise")).href)});
`,
    );
    // Duration is a failure watchdog, not the readiness/success condition.
    running = run(runner, [...args, "--execute", "--duration-ms", "60000"]);
    const deadline = Date.now() + 60_000;
    while ((await readFile(plannerLog, "utf8")).split('"method":"session/prompt"').length < 3) {
      assert.ok(Date.now() < deadline, "Supervisor did not start planning.");
      await new Promise((done) => setTimeout(done, 25));
    }
    await writeFile(join(f.repository, "new-revision.txt"), "Updated pinned source");
    const updatedRevision = await f.commit();
    resource.agents["private-execution-agent"] = configuredExecutor;
    await atomicWrite(resourcePath, JSON.stringify(resource));
    portfolioValue.resources = registeredResources;
    portfolioValue.goals[0].subject.generation = 2;
    await atomicWrite(portfolio, JSON.stringify(portfolioValue));
    const executed = await running;
    assert.equal(executed.code, 0, executed.stdout + executed.stderr);
    const execution = JSON.parse(executed.stdout);
    assert.equal(execution.status, "executed");
    assert.equal(execution.observations.fixture.payload.current.levelId, "terminal");
    assert.equal(
      execution.observations.fixture.payload.versions[f.uri],
      await git(f.repository, "rev-parse", `${updatedRevision}:objective`),
    );
    assert.equal(execution.queue.demands.length, 0);
    assert.equal(
      execution.events.filter((event: { type: string }) => event.type === "started").length,
      1,
    );
    assert.ok(
      execution.events.some(
        (event: { type: string; requirements?: string[] }) =>
          event.type === "capability-request" && event.requirements?.includes("additional-tool"),
      ),
    );
    assert.ok((await readFile(counts, "utf8")).trim().split("\n").length >= 4);
    assert.equal(existsSync(marker), true);
    const messages = (await readFile(plannerLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const prompts = messages.filter((message) => message.method === "session/prompt");
    assert.ok(prompts.length >= 3);
    for (const message of prompts) {
      assert.doesNotMatch(
        message.params.prompt[0].text,
        /PRIVATE_RESOURCE_ID|private-execution-agent/,
      );
    }
    assert.ok(
      prompts.some((message) =>
        message.params.prompt[0].text.includes("Need a specialized verification tool"),
      ),
    );
    const executorMessages = (await readFile(executorLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      executorMessages.filter((message) => message.method === "session/prompt").length,
      1,
    );
  } finally {
    await running;
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("supervise rejects legacy portfolios and invalid registrations before planning", async () => {
  const directory = await mkdtemp(join(scratch, "supervise-invalid-"));
  try {
    for (const schemaVersion of [1, 2]) {
      const path = join(directory, `portfolio-${schemaVersion}.json`);
      await writeFile(path, JSON.stringify({ schemaVersion, objectives: [] }));
      const result = await run(bin("supervise"), ["--portfolio-file", path, "--format", "json"]);
      assert.equal(result.code, 2, result.stdout + result.stderr);
      assert.match(result.stdout, /schemaVersion: 3/);
    }
    assert.throws(
      () =>
        parsePortfolioFile({
          schemaVersion: 3,
          goals: [{ id: "bad" }],
          resources: [],
        }),
      /invalid or duplicate goal/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("supervise dynamically binds a cross-process dependency, repairs it, then re-observes the consumer", async () => {
  const consumer = await fixture();
  const provider = await fixture();
  let running: ReturnType<typeof run> | undefined;
  try {
    const marker = join(consumer.directory, "dependency-repaired");
    await writeFile(
      join(consumer.repository, "objective", "checks", "ready", "run.js"),
      `#!/usr/bin/env node
import {createSourceObjectiveDependencyProbe} from "@potential-guide/objective-pilot";
let source = ""; for await (const chunk of process.stdin) source += chunk;
const subject = JSON.parse(source);
const probe = createSourceObjectiveDependencyProbe({objectiveId:${JSON.stringify(provider.uri)},expectedLevelId:"terminal"});
process.stdout.write(JSON.stringify(await probe({marker:subject.marker}, new AbortController().signal)));
`,
    );
    await writeFile(
      join(provider.repository, "objective", "checks", "ready", "run.js"),
      `#!/usr/bin/env node
import {existsSync} from "node:fs";
let source = ""; for await (const chunk of process.stdin) source += chunk;
const {marker} = JSON.parse(source), ok = existsSync(marker);
process.stdout.write(JSON.stringify({status:200,message:"",payload:ok?{ok:true,problems:[]}:{ok:false,problems:[{kind:"internal",id:"not-ready",parameters:{}}]}}));
`,
    );
    const consumerRevision = await consumer.commit();
    const providerRevision = await provider.commit();
    const stub = join(consumer.directory, "agent.mjs");
    await writeFile(stub, stubSource);
    const config = join(consumer.directory, "config.json");
    await writeConfig(
      config,
      JSON.stringify({
        schemaVersion: 2,
        agentExecutionLimits: { timeoutMs: 20_000 },
        agents: {
          strategist: profile(stub, "plan", join(consumer.directory, "planner.jsonl"), marker),
          worker: profile(stub, "repair", join(consumer.directory, "worker.jsonl"), marker),
        },
      }),
    );
    const portfolio = join(consumer.directory, "portfolio.json");
    await writeFile(
      portfolio,
      JSON.stringify({
        schemaVersion: 3,
        goals: [
          {
            id: "fixture",
            objective: consumer.uri,
            revision: consumerRevision,
            subject: { marker },
            targetLevel: "terminal",
            priority: 2,
            observationIntervalMs: 500,
          },
        ],
        resources: [{ id: "worker", agent: "worker", capacity: 1, capabilities: [] }],
      }),
    );
    const runner = join(consumer.directory, "until-terminal.mjs");
    await writeFile(
      runner,
      `
import {existsSync} from "node:fs";
const timer = setInterval(() => {
  if (existsSync(${JSON.stringify(`${marker}.terminal`)})) { clearInterval(timer); process.emit("SIGINT"); }
}, 25); timer.unref();
await import(${JSON.stringify(pathToFileURL(bin("supervise")).href)});
`,
    );
    running = run(runner, [
      "--portfolio-file",
      portfolio,
      "--planner",
      "strategist",
      "--config",
      config,
      "--execute",
      "--duration-ms",
      "60000",
      "--format",
      "json",
    ]);
    const executed = await running;
    assert.equal(executed.code, 0, executed.stdout + executed.stderr);
    const result = JSON.parse(executed.stdout);
    assert.equal(
      existsSync(`${marker}.terminal`),
      true,
      "Consumer was not freshly observed at terminal.",
    );
    assert.equal(result.observations.fixture.payload.current.objectiveId, consumer.uri);
    assert.equal(result.observations.fixture.payload.current.levelId, "terminal");
    const providerTree = await git(
      provider.repository,
      "rev-parse",
      `${providerRevision}:objective`,
    );
    assert.equal(result.observations.fixture.payload.versions[provider.uri], providerTree);
    assert.equal(result.queue.demands.length, 0);
    const handoff = result.events.find(
      (event: { type: string; outcome?: { stopReason: string } }) =>
        event.type === "result" && event.outcome?.stopReason === "dependency-required",
    );
    assert.ok(handoff);
    assert.equal(handoff.outcome.iterations, 0);
    assert.equal(handoff.outcome.dependencies[0].objectiveId, provider.uri);
    assert.ok(
      result.events.some(
        (event: {
          type: string;
          demand: { objective: { objectiveId: string; version: string } };
          outcome?: { stopReason: string };
        }) =>
          event.type === "result" &&
          event.demand.objective.objectiveId === provider.uri &&
          event.demand.objective.version === providerTree &&
          event.outcome?.stopReason === "target-reached",
      ),
    );
    const messages = (await readFile(join(consumer.directory, "worker.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(messages.filter((message) => message.method === "session/prompt").length, 1);
  } finally {
    await running;
    await rm(consumer.directory, { recursive: true, force: true });
    await rm(provider.directory, { recursive: true, force: true });
  }
});

test("continuous supervise follows script and dependency source updates without portfolio edits", async () => {
  const consumer = await fixture();
  const provider = await fixture();
  let running: ReturnType<typeof run> | undefined;
  try {
    const marker = join(consumer.directory, "source-follow");
    const observations = join(consumer.directory, "observations.jsonl");
    const plannerLog = join(consumer.directory, "planner.jsonl");
    const consumerScript = join(consumer.repository, "objective", "checks", "ready", "run.js");
    const providerScript = join(provider.repository, "objective", "checks", "ready", "run.js");
    const probeSource = (ok: boolean) => `#!/usr/bin/env node
process.stdout.write(JSON.stringify({status:200,message:"",payload:${JSON.stringify(ok ? { ok: true, problems: [] } : { ok: false, problems: [{ kind: "internal", id: "not-ready", parameters: {} }] })}}));
`;
    await writeFile(providerScript, probeSource(false));
    const providerCommit = await provider.commit();
    const providerTree = await git(provider.repository, "rev-parse", `${providerCommit}:objective`);
    const consumerSource = (phase: string, dependency: boolean) => `#!/usr/bin/env node
void (async () => {
  const { appendFileSync } = await import("node:fs");
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  const subject = JSON.parse(input);
  appendFileSync(subject.log, ${JSON.stringify(`${phase}\n`)});
  ${
    dependency
      ? `const { createSourceObjectiveDependencyProbe } = await import("@potential-guide/objective-pilot");
  const probe = createSourceObjectiveDependencyProbe({objectiveId:${JSON.stringify(provider.uri)},expectedLevelId:"terminal"});
  const result = await probe({}, new AbortController().signal);`
      : 'const result = {status:200,message:"",payload:{ok:false,problems:[{kind:"internal",id:"not-ready",parameters:{}}]}};'
  }
  process.stdout.write(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
    await writeFile(consumerScript, consumerSource("v1", false));
    const initialCommit = await consumer.commit();
    const initialTree = await git(consumer.repository, "rev-parse", `${initialCommit}:objective`);
    const stub = join(consumer.directory, "planner.mjs");
    await writeFile(
      stub,
      `
import { createInterface } from "node:readline";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const [, log, marker] = process.argv.slice(2);
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  appendFileSync(log, JSON.stringify(message) + "\\n");
  if (!message.id) continue;
  let result = {};
  if (message.method === "initialize") result = { protocolVersion: 1 };
  if (message.method === "session/new") result = { sessionId: "source-follow" };
  if (message.method === "session/prompt") {
    const context = JSON.parse(message.params.prompt[0].text.split("\\n").at(-1));
    const payload = context.observations.fixture?.payload;
    if (payload?.current.levelId === "terminal" && context.previousQueue.demands.length === 0) {
      const key = JSON.stringify({ versions: payload.versions, sources: payload.sources });
      appendFileSync(marker + ".samples", key + "\\n");
      const last = readFileSync(marker + ".samples", "utf8").trim().split("\\n").slice(-3);
      if (last.length === 3 && last.every(sample => sample === key))
        writeFileSync(marker + ".terminal", key);
    }
    const text = JSON.stringify({ directives: context.candidates.map(goal => ({ goalId: goal.id, priority: goal.priority })) });
    console.log(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "source-follow",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } }));
    result = { stopReason: "end_turn" };
  }
  console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
}
`,
    );
    const config = join(consumer.directory, "config.json");
    await writeConfig(
      config,
      JSON.stringify({
        schemaVersion: 2,
        agents: { strategist: profile(stub, "plan", plannerLog, marker) },
      }),
    );
    const portfolio = join(consumer.directory, "portfolio.json");
    const content = JSON.stringify({
      schemaVersion: 3,
      goals: [
        {
          id: "fixture",
          objective: consumer.uri,
          subject: { log: observations },
          targetLevel: "terminal",
          priority: 2,
          observationIntervalMs: 500,
        },
      ],
      resources: [],
    });
    await writeFile(portfolio, content);
    const runner = join(consumer.directory, "until-source-followed.mjs");
    await writeFile(
      runner,
      `import {existsSync} from "node:fs";
const timer = setInterval(() => {
  if (existsSync(${JSON.stringify(`${marker}.terminal`)})) { clearInterval(timer); process.emit("SIGINT"); }
}, 25); timer.unref();
await import(${JSON.stringify(pathToFileURL(bin("supervise")).href)});
`,
    );
    running = run(runner, [
      "--portfolio-file",
      portfolio,
      "--planner",
      "strategist",
      "--config",
      config,
      "--execute",
      "--duration-ms",
      "60000",
      "--format",
      "json",
    ]);
    let completed: Awaited<ReturnType<typeof run>> | undefined;
    void running.then((result) => {
      completed = result;
    });
    const snapshots = async () => {
      let source: string;
      try {
        source = await readFile(plannerLog, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      return source
        .split("\n")
        .slice(0, -1)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((message) => message.method === "session/prompt")
        .map(
          (message) =>
            JSON.parse(message.params.prompt[0].text.split("\n").at(-1)).observations.fixture
              ?.payload,
        );
    };
    const deadline = Date.now() + 60_000;
    const waitFor = async (
      predicate: (values: Awaited<ReturnType<typeof snapshots>>) => boolean,
    ) => {
      while (!predicate(await snapshots())) {
        if (completed !== undefined) assert.fail(completed.stdout + completed.stderr);
        assert.ok(Date.now() < deadline, "Continuous supervise did not follow source updates.");
        await new Promise((done) => setTimeout(done, 25));
      }
    };
    await waitFor((values) =>
      values.some((value) => value?.sources?.[consumer.uri]?.commit === initialCommit),
    );
    await writeFile(join(consumer.repository, "unrelated.txt"), "outside the Pilot");
    const unrelatedCommit = await consumer.commit();
    assert.equal(
      await git(consumer.repository, "rev-parse", `${unrelatedCommit}:objective`),
      initialTree,
    );
    await waitFor((values) =>
      values.some(
        (value) =>
          value?.sources?.[consumer.uri]?.commit === unrelatedCommit &&
          value.versions[consumer.uri] === initialTree,
      ),
    );
    await writeFile(consumerScript, consumerSource("v2", true));
    const updatedCommit = await consumer.commit();
    const updatedTree = await git(consumer.repository, "rev-parse", `${updatedCommit}:objective`);
    assert.notEqual(updatedTree, initialTree);
    await waitFor((values) =>
      values.some(
        (value) =>
          value?.versions?.[consumer.uri] === updatedTree &&
          value?.versions?.[provider.uri] === providerTree,
      ),
    );
    await writeFile(providerScript, probeSource(true));
    const dependencyCommit = await provider.commit();
    const dependencyTree = await git(
      provider.repository,
      "rev-parse",
      `${dependencyCommit}:objective`,
    );
    assert.notEqual(dependencyTree, providerTree);
    const result = await running;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(
      report.observations.fixture,
      result.stderr + JSON.stringify({ providerTree, dependencyTree, report }),
    );
    const final = report.observations.fixture.payload;
    assert.equal(final.current.levelId, "terminal");
    assert.equal(final.versions[consumer.uri], updatedTree);
    assert.equal(final.sources[consumer.uri].commit, updatedCommit);
    assert.equal(final.versions[provider.uri], dependencyTree);
    assert.equal(final.sources[provider.uri].commit, dependencyCommit);
    assert.equal(await readFile(portfolio, "utf8"), content);
    assert.deepEqual(
      new Set((await readFile(observations, "utf8")).trim().split("\n")),
      new Set(["v1", "v2"]),
    );
    assert.ok(!report.events.some((event: { type: string }) => event.type === "started"));
  } finally {
    if (running !== undefined) await running;
    await Promise.all(
      [consumer.directory, provider.directory].map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  }
});
