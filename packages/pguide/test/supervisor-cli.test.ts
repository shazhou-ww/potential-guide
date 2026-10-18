import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { type AgentProfile, atomicWrite } from "@potential-guide/cli-core";
import type { PlannerPolicyInput } from "@potential-guide/objective-portfolio-supervisor";
import { createAcpPlannerPolicy, plannerPrompt } from "../src/acp-planner.js";
import { parsePortfolioFile } from "../src/commands/supervisor.js";
import { withPilot } from "../src/pilot-source.js";
import { bin, fixture, root, run, scratch } from "./fixtures.js";

const stubSource = `
import { createInterface } from "node:readline";
import { appendFileSync, writeFileSync } from "node:fs";
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
      writeFileSync(marker, "repaired");
      result = { stopReason: "end_turn", summary: "Repaired" };
    } else {
      const context = JSON.parse(message.params.prompt[0].text.split("\\n").at(-1));
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
    connection: { type: "acp", protocolVersion: "1" },
    transport: { type: "stdio", command: process.execPath, args: [stub, mode, log, marker] },
  };
}

test("ACP planner consumes standard text chunks, excludes inventory, and fails closed", async (t) => {
  const f = await fixture();
  try {
    const commit = await f.commit();
    const stub = join(f.directory, "planner.mjs");
    await writeFile(stub, stubSource);
    await withPilot(f.uri, root, commit, async (pilot) => {
      const goal = {
        id: "registered",
        pilot,
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
      `#!/usr/bin/env node\nimport{existsSync,appendFileSync}from"node:fs";let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const x=JSON.parse(s);appendFileSync(x.counts,"observed\\n");const ok=existsSync(x.marker);console.log(JSON.stringify({status:200,payload:ok?{ok:true,problems:[]}:{ok:false,problems:[{id:"not-ready",parameters:{}}]},message:""}));});`,
    );
    const revision = await f.commit();
    const stub = join(f.directory, "agent.mjs");
    const plannerLog = join(f.directory, "planner.jsonl");
    const executorLog = join(f.directory, "executor.jsonl");
    await writeFile(stub, stubSource);
    const config = join(f.directory, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        agentExecutionLimits: { timeoutMs: 5_000 },
        agents: {
          strategist: profile(stub, "plan", plannerLog),
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
            pilot: f.uri,
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
    assert.equal(report.queue.demands[0].pilot.version, revision);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(executorLog), false);
    assert.equal((await readFile(counts, "utf8")).trim().split("\n").length, 1);
    const portfolioValue = JSON.parse(await readFile(portfolio, "utf8"));
    const registeredResources = portfolioValue.resources;
    portfolioValue.resources = [];
    delete portfolioValue.goals[0].revision;
    await writeFile(portfolio, JSON.stringify(portfolioValue));
    const configured = JSON.parse(await readFile(config, "utf8"));
    const configuredExecutor = configured.agents["private-execution-agent"];
    delete configured.agents["private-execution-agent"];
    await writeFile(config, JSON.stringify(configured));
    running = run(bin("supervise"), [...args, "--execute", "--duration-ms", "7000"]);
    const deadline = Date.now() + 8_000;
    while ((await readFile(plannerLog, "utf8")).split('"method":"session/prompt"').length < 3) {
      assert.ok(Date.now() < deadline, "Supervisor did not start planning.");
      await new Promise((done) => setTimeout(done, 25));
    }
    await writeFile(join(f.repository, "new-revision.txt"), "Updated pinned source");
    const updatedRevision = await f.commit();
    configured.agents["private-execution-agent"] = configuredExecutor;
    await atomicWrite(config, JSON.stringify(configured));
    portfolioValue.resources = registeredResources;
    portfolioValue.goals[0].subject.generation = 2;
    await atomicWrite(portfolio, JSON.stringify(portfolioValue));
    const executed = await running;
    assert.equal(executed.code, 0, executed.stdout + executed.stderr);
    const execution = JSON.parse(executed.stdout);
    assert.equal(execution.status, "executed");
    assert.equal(execution.observations.fixture.payload.current.levelId, "terminal");
    assert.equal(execution.observations.fixture.payload.versions[f.uri], updatedRevision);
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
