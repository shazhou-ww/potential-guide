import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { CliError } from "@potential-guide/cli-core";
import type { Envelope, PilotObservation, PilotSpec } from "@potential-guide/objective-pilot";
import type { ObjectiveGoal } from "@potential-guide/objective-portfolio-supervisor";
import { RegulationError } from "@potential-guide/objective-regulator";
import { observationMarkdown } from "../../pguide-pilot/src/commands/pilot.js";
import {
  regulationInputGuidance,
  regulationMarkdown,
} from "../../pguide-regulate/src/commands/regulator.js";
import { supervisionMarkdown } from "../../pguide-supervise/src/commands/supervisor.js";
import { bin, fixture, root, run, scratch, writeConfig } from "./fixtures.js";

const normalize = (value: string) =>
  value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, "<RUN>");

async function executionFixture() {
  const f = await fixture(scratch, "execution-output-");
  await writeFile(
    join(f.repository, "objective", "checks", "ready", "worker.cjs"),
    "exports.execute = async (inputSubject, context) => {\n    const source = JSON.stringify(inputSubject);\n    const subject = JSON.parse(source);\n    const value = subject.mode === \"failure\" ? { status: 502, payload: null, message: \"Synthetic check invocation failed\" } :\n        { status: 200, message: \"\", payload: { ok: subject.mode === \"terminal\", problems: subject.mode === \"terminal\" ? [] : [{ kind: \"internal\", id: \"not-ready\", parameters: {} }] } };\n    return value;\n};\n",
  );
  await writeFile(
    join(f.repository, "objective", "references", "levels", "initial", "en-US.md"),
    "---\ntitle: Initial\ndescription: Initial level\nreferences: []\n---\n\nRepair the readiness check before advancing.\n",
  );
  const revision = await f.commit();
  const agent = join(f.directory, "agent.mjs");
  await writeFile(
    agent,
    `import{createInterface}from"node:readline";
for await(const line of createInterface({input:process.stdin})){
const m=JSON.parse(line);if(m.id===undefined)continue;let result={};
if(m.method==="initialize")result={protocolVersion:1,agentCapabilities:{loadSession:true}};
if(m.method==="session/new")result={sessionId:"fixture-session"};
if(m.method==="session/prompt"){
const prompt=m.params.prompt[0].text;
if(prompt.startsWith("Potential Guide regulation"))result={stopReason:"end_turn"};
else{
const context=JSON.parse(prompt.split("\\n").at(-1));
const text=JSON.stringify({directives:context.candidates.map(goal=>({goalId:goal.id,priority:goal.priority}))});
console.log(JSON.stringify({jsonrpc:"2.0",method:"session/update",params:{sessionId:"fixture-session",update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text}}}}));
result={stopReason:"end_turn"};
}}
console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));}`,
  );
  const config = join(f.directory, "config.json");
  const state = join(f.directory, "state");
  await writeConfig(
    config,
    JSON.stringify({
      schemaVersion: 2,
      defaultAgent: "fixture",
      stateDirectory: state,
      reports: { enabled: false },
      regulationStrategy: { quota: { timeoutMs: 10000, maxAgentRuns: 2, maxStallRuns: 1 } },
      agents: {
        fixture: {
          connection: { type: "acp", protocolVersion: "1" },
          transport: { type: "stdio", command: process.execPath, args: [agent] },
        },
      },
    }),
  );
  const portfolio = join(f.directory, "portfolio.json");
  async function setSubject(mode: string) {
    await writeFile(f.subject, JSON.stringify({ mode, privateValue: "SUBJECT_MUST_NOT_APPEAR" }));
    await writeFile(
      portfolio,
      JSON.stringify({
        schemaVersion: 4,
        goals: [
          {
            id: "readiness",
            objective: f.uri,
            revision,
            subject: { mode, privateValue: "SUBJECT_MUST_NOT_APPEAR" },
            targetLevel: "terminal",
            priority: 1,
            observationIntervalMs: 10000,
          },
        ],
        resources: [],
      }),
    );
  }
  await setSubject("gap");
  const probeArgs = [
    "--pilot",
    f.uri,
    "--revision",
    revision,
    "--subject-file",
    f.subject,
    "--no-reports",
    "--fixture-config",
    config,
  ];
  const regulationArgs = [
    "--pilot",
    f.uri,
    "--revision",
    revision,
    "--subject-file",
    f.subject,
    "--target",
    "terminal",
    "--fixture-config",
    config,
  ];
  const supervisionArgs = [
    "--portfolio-file",
    portfolio,
    "--planner",
    "fixture",
    "--fixture-config",
    config,
  ];
  return { ...f, config, state, portfolio, setSubject, probeArgs, regulationArgs, supervisionArgs };
}

test("scaffold receipts and validate scope have default/Markdown parity; --bogus is rejected", async () => {
  const directory = await mkdtemp(join(scratch, "execution-receipt-"));
  try {
    const target = join(directory, "objective");
    const args = ["pilot", target, "--check", "ready"];
    const plain = await run(bin("scaffold"), args);
    assert.equal(plain.code, 0, plain.stderr);
    for (const text of [
      "# Pilot scaffold created",
      "- Action:",
      "- Directory:",
      "- Manifest:",
      "- Languages: `en-US`",
      "- Check: `ready`",
      "pguide validate pilot",
      "Commit the Pilot",
    ])
      assert.ok(plain.stdout.includes(text), text);
    await rm(target, { recursive: true });
    const markdown = await run(bin("scaffold"), [...args, "--format", "markdown"]);
    assert.equal(markdown.stdout, plain.stdout);
    const validated = await run(bin("validate"), ["pilot", target]);
    const explicit = await run(bin("validate"), ["pilot", target, "--format", "markdown"]);
    assert.equal(validated.code, 0, validated.stderr);
    assert.equal(validated.stdout, explicit.stdout);
    assert.match(validated.stdout, /^# Pilot validation\n/u);
    assert.match(validated.stdout, /checks were not executed/u);
    const json = await run(bin("validate"), ["pilot", target, "--format", "json"]);
    assert.deepEqual(Object.keys(JSON.parse(json.stdout)).sort(), [
      "objectiveId",
      "schemaVersion",
      "status",
    ]);
    assert.equal(JSON.parse(json.stdout).status, "valid");
    for (const script of [bin("validate"), join(root, "packages", "pguide", "dist", "bin.js")]) {
      const prefix = script === bin("validate") ? [] : ["validate"];
      const rejected = await run(
        script,
        [...prefix, "pilot", target, "--bogus", "--format", "json", "--cwd", directory],
        { ...process.env, PATH: "" },
      );
      assert.equal(rejected.code, 2, rejected.stdout + rejected.stderr);
      assert.equal(rejected.stderr, "");
      const failure = JSON.parse(rejected.stdout);
      assert.equal(failure.status, "invalid");
      assert.match(failure.error, /Unknown option: --bogus/u);
      assert.equal(failure.objectiveId, undefined);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("probe reports identity, references, guidance, terminal outcome and compatible invocation failures", async () => {
  const f = await executionFixture();
  try {
    const plain = await run(bin("probe"), f.probeArgs);
    const markdown = await run(bin("probe"), [...f.probeArgs, "--format", "markdown"]);
    assert.equal(plain.code, 0, plain.stderr);
    assert.equal(markdown.stdout, plain.stdout);
    for (const text of [
      "# Observation",
      f.uri,
      "not yet complete",
      "- Current level: `initial`",
      "- Problems: 1",
      "not-ready",
      "check: `ready`",
      "`problems/not-ready`",
      "`levels/initial`",
      "Repair the readiness check",
      "rerun this probe",
    ])
      assert.ok(plain.stdout.includes(text), text);
    assert.doesNotMatch(plain.stdout, /SUBJECT_MUST_NOT_APPEAR/u);
    const json = await run(bin("probe"), [...f.probeArgs, "--format", "json"]);
    assert.equal(json.code, 0, json.stderr);
    const observation = JSON.parse(json.stdout);
    assert.deepEqual(Object.keys(observation).sort(), ["message", "payload", "status"]);
    assert.equal(observation.status, 200);
    assert.equal(observation.payload.current.levelId, "initial");
    assert.equal(observation.payload.problems[0].ref.problemId, "not-ready");
    await f.setSubject("terminal");
    const terminal = await run(bin("probe"), f.probeArgs);
    assert.equal(terminal.code, 0, terminal.stderr);
    assert.match(terminal.stdout, /complete - terminal reached/u);
    assert.match(terminal.stdout, /Problems: 0/u);
    assert.match(terminal.stdout, /no repair is needed/u);
    assert.doesNotMatch(terminal.stdout, /## Guidance|## Problems/u);
    await f.setSubject("failure");
    const failed = await run(bin("probe"), f.probeArgs);
    assert.equal(failed.code, 6, failed.stdout + failed.stderr);
    assert.equal(failed.stderr, "");
    assert.match(failed.stdout, /observation failed; completion could not be determined/u);
    assert.ok(failed.stdout.includes(f.uri));
    assert.match(failed.stdout, /Synthetic check invocation failed/u);
    const failedMarkdown = await run(bin("probe"), [...f.probeArgs, "--format", "markdown"]);
    assert.equal(failedMarkdown.stdout, failed.stdout);
    const failedJson = await run(bin("probe"), [...f.probeArgs, "--format", "json"]);
    assert.equal(failedJson.code, 6);
    assert.deepEqual(JSON.parse(failedJson.stdout), {
      status: 502,
      payload: null,
      message: "Synthetic check invocation failed",
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("regulate and continue expose stop conditions and persisted recovery without changing JSON", async () => {
  const f = await executionFixture();
  try {
    const report = join(f.directory, "report.json");
    const args = [...f.regulationArgs, "--report", report];
    const plain = await run(bin("regulate"), args);
    assert.equal(plain.code, 5, plain.stdout + plain.stderr);
    for (const text of [
      "# Regulation",
      f.uri,
      "- Target level: `terminal`",
      "- Current level: `initial`",
      "Stop reason: exhausted (stall)",
      "- Iterations: 1",
      "10000 ms; 2 Agent runs; 1 additional stalled run.",
      "- State:",
      "- Report:",
      "pguide continue",
      "target not reached",
    ])
      assert.ok(plain.stdout.includes(text), text);
    assert.doesNotMatch(plain.stdout, /SUBJECT_MUST_NOT_APPEAR|Potential Guide regulation/u);
    const markdown = await run(bin("regulate"), [...args, "--format", "markdown"]);
    assert.equal(normalize(markdown.stdout), normalize(plain.stdout));
    const saved = JSON.parse(await readFile(report, "utf8"));
    assert.equal(saved.schemaVersion, 2);
    assert.equal(saved.status, "exhausted");
    assert.deepEqual(Object.keys(saved).sort(), [
      "attempts",
      "outcome",
      "recovery",
      "regulationId",
      "schemaVersion",
      "status",
    ]);
    const state = join(f.state, "regulations", saved.regulationId, "regulation.json");
    const persisted = JSON.parse(await readFile(state, "utf8"));
    assert.equal(persisted.schemaVersion, 4);
    assert.equal(persisted.subject.privateValue, "SUBJECT_MUST_NOT_APPEAR");
    const continued = await run(bin("continue"), [
      saved.regulationId,
      "--fixture-config",
      f.config,
    ]);
    assert.equal(continued.code, 5, continued.stdout + continued.stderr);
    assert.match(continued.stdout, /Stop reason: exhausted \(stall\)/u);
    assert.match(continued.stdout, /Stalled runs: 2/u);
    const continuationJson = await run(bin("continue"), [
      saved.regulationId,
      "--fixture-config",
      f.config,
      "--format",
      "json",
    ]);
    assert.equal(continuationJson.code, 5, continuationJson.stdout + continuationJson.stderr);
    assert.equal(JSON.parse(continuationJson.stdout).attempts.length, 3);
    await f.setSubject("terminal");
    const complete = await run(bin("regulate"), [...f.regulationArgs, "--format", "json"]);
    assert.equal(complete.code, 0, complete.stdout + complete.stderr);
    assert.equal(JSON.parse(complete.stdout).status, "target-reached");
    await f.setSubject("failure");
    const failure = await run(bin("regulate"), f.regulationArgs);
    assert.equal(failure.code, 6, failure.stdout + failure.stderr);
    assert.equal(failure.stderr, "");
    assert.match(failure.stdout, /Regulation failed for Objective/u);
    assert.ok(failure.stdout.includes(f.uri));
    assert.match(failure.stdout, /target `terminal`.*Synthetic check invocation failed/u);
    const failureMarkdown = await run(bin("regulate"), [
      ...f.regulationArgs,
      "--format",
      "markdown",
    ]);
    assert.equal(normalize(failureMarkdown.stdout), normalize(failure.stdout));
    const failureJson = await run(bin("regulate"), [...f.regulationArgs, "--format", "json"]);
    assert.equal(failureJson.code, 6);
    assert.equal(failureJson.stderr, "");
    assert.equal(JSON.parse(failureJson.stdout).status, "regulation-error");
    assert.equal(
      JSON.parse(failureJson.stdout).error,
      "Probe invocation failed: Synthetic check invocation failed",
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("regulate and continue render supported locales without changing the outer error taxonomy", async () => {
  const f = await executionFixture();
  try {
    const args = [...f.regulationArgs, "--language", "fr-FR"];
    const normal = await run(bin("regulate"), args);
    assert.equal(normal.code, 2, normal.stdout + normal.stderr);
    assert.equal(normal.stderr, "");
    assert.match(normal.stdout, /Regulation failed for Objective/u);
    assert.ok(normal.stdout.includes(f.uri));
    assert.match(normal.stdout, /target `terminal`/u);
    assert.match(normal.stdout, /Unsupported language fr-FR/u);
    assert.match(normal.stdout, /Supported languages: `en-US`, `zh-CN`/u);
    assert.match(normal.stdout, /choose a supported --language for a new regulation/u);
    assert.match(normal.stdout, /Continue retains the original language/u);
    const [id] = await readdir(join(f.state, "regulations"));
    assert.ok(id);
    const continued = await run(bin("continue"), [id, "--fixture-config", f.config]);
    assert.equal(continued.code, 2, continued.stdout + continued.stderr);
    assert.equal(continued.stderr, "");
    assert.equal(continued.stdout, normal.stdout);
    const markdown = await run(bin("regulate"), [...args, "--format", "markdown"]);
    assert.equal(normalize(markdown.stdout), normalize(normal.stdout));
    const expected = {
      schemaVersion: 1,
      status: "regulation-error",
      error: `Unsupported language fr-FR for ${f.uri}.`,
    };
    for (const [script, argv] of [
      [bin("regulate"), args],
      [bin("continue"), [id, "--fixture-config", f.config]],
    ] as const) {
      const json = await run(script, [...argv, "--format", "json"]);
      assert.equal(json.code, 2, json.stdout + json.stderr);
      assert.equal(json.stderr, "");
      assert.deepEqual(JSON.parse(json.stdout), expected);
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("nested CliError human input guidance survives regulation wrapping", () => {
  const input = new CliError(
    "Original machine error",
    2,
    "pilot-error",
    undefined,
    "Supported languages: `en-US`.\n\nNext: choose a supported language.",
  );
  const error = new RegulationError(400, "Outer regulation context", {
    cause: new Error("Intermediate context", { cause: input }),
  });
  assert.equal(regulationInputGuidance(error), input.humanMessage);
  assert.equal(error.message, "Outer regulation context");
  assert.equal(error.status, 400);
  assert.equal(input.message, "Original machine error");
  const cycle = new RegulationError(400, "No input guidance");
  cycle.cause = cycle;
  assert.equal(regulationInputGuidance(cycle), undefined);
});

test("regulation quota labels distinguish singular and plural runs", () => {
  const input = {
    regulationId: "fixture-run",
    objectiveId: "fixture-objective",
    targetLevel: "terminal",
    status: "target-reached",
    quota: { timeoutMs: 1000, maxAgentRuns: 1, maxStallRuns: 1 },
    statePath: "state.json",
    recoveryCommand: "pguide continue fixture-run",
  };
  const singular = regulationMarkdown(input);
  assert.match(singular, /1000 ms; 1 Agent run; 1 additional stalled run\./u);
  assert.match(singular, /Objective complete - terminal reached\./u);
  assert.doesNotMatch(singular, /[—–]/u);
  const plural = regulationMarkdown({
    ...input,
    quota: { ...input.quota, maxAgentRuns: 2, maxStallRuns: 2 },
  });
  assert.match(plural, /1000 ms; 2 Agent runs; 2 additional stalled runs\./u);
});

test("supervise distinguishes planning, queued work, execution boundary and compatible failed observations", async () => {
  const f = await executionFixture();
  try {
    const plain = await run(bin("supervise"), f.supervisionArgs);
    assert.equal(plain.code, 0, plain.stdout + plain.stderr);
    const markdown = await run(bin("supervise"), [...f.supervisionArgs, "--format", "markdown"]);
    assert.equal(markdown.stdout, plain.stdout);
    for (const text of [
      "# Portfolio supervision",
      "planning only",
      "1 goal.",
      "1 demand.",
      "0 resources",
      "`readiness`",
      f.uri,
      "current: `initial`",
      "target: `terminal`",
      "target not reached",
      "execution was not requested",
      "planning pass finished",
      "--execute",
    ])
      assert.ok(plain.stdout.includes(text), text);
    assert.doesNotMatch(plain.stdout, /1 goals|1 demands|SUBJECT_MUST_NOT_APPEAR/u);
    const json = await run(bin("supervise"), [...f.supervisionArgs, "--format", "json"]);
    assert.equal(json.code, 0, json.stdout + json.stderr);
    const plan = JSON.parse(json.stdout);
    assert.deepEqual(Object.keys(plan).sort(), [
      "events",
      "observations",
      "queue",
      "schemaVersion",
      "status",
    ]);
    assert.equal(plan.schemaVersion, 4);
    assert.equal(plan.status, "planned");
    assert.equal(plan.queue.demands.length, 1);
    const executionArgs = [...f.supervisionArgs, "--execute", "--duration-ms", "1500"];
    const executed = await run(bin("supervise"), executionArgs);
    assert.equal(executed.code, 0, executed.stdout + executed.stderr);
    assert.match(executed.stdout, /Mode: execution/u);
    assert.match(executed.stdout, /duration limit reached \(1500 ms\)/u);
    assert.match(executed.stdout, /no resource matches/u);
    assert.match(executed.stdout, /does not prove all goals are reached/u);
    const explicitExecution = await run(bin("supervise"), [
      ...executionArgs,
      "--format",
      "markdown",
    ]);
    assert.equal(explicitExecution.stdout, executed.stdout);
    await f.setSubject("terminal");
    const complete = await run(bin("supervise"), f.supervisionArgs);
    assert.equal(complete.code, 0, complete.stdout + complete.stderr);
    assert.match(complete.stdout, /Remaining demands: 0 demands/u);
    assert.match(complete.stdout, /status: target reached/u);
    await f.setSubject("failure");
    const failure = await run(bin("supervise"), f.supervisionArgs);
    assert.equal(failure.code, 70, failure.stdout + failure.stderr);
    assert.equal(failure.stderr, "");
    assert.match(failure.stdout, /Observation failed for goal `readiness`, Objective/u);
    assert.ok(failure.stdout.includes(f.uri));
    assert.match(failure.stdout, /target `terminal`: Synthetic check invocation failed/u);
    const failedMarkdown = await run(bin("supervise"), [
      ...f.supervisionArgs,
      "--format",
      "markdown",
    ]);
    assert.equal(failedMarkdown.stdout, failure.stdout);
    const failedJson = await run(bin("supervise"), [...f.supervisionArgs, "--format", "json"]);
    assert.equal(failedJson.code, 70);
    assert.equal(failedJson.stderr, "");
    assert.equal(JSON.parse(failedJson.stdout).status, "internal-error");
    assert.equal(
      JSON.parse(failedJson.stdout).error,
      "Observation failed for readiness: Synthetic check invocation failed",
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("renderers escape Markdown and never display dependency subjects or transcript bodies", () => {
  const objectiveId = "git+file:///fixture#objective/";
  const spec: PilotSpec = {
    objectiveId,
    version: "a".repeat(40),
    manifest: {
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
      subjectSchema: { type: "object" },
      levels: [{ id: "ready", checks: [] }],
      defaultLanguage: "en-US",
      languages: ["en-US"],
    },
    locales: { "en-US": {} },
  };
  const observation: Envelope<PilotObservation> = {
    status: 200,
    message: "",
    payload: {
      current: { objectiveId, levelId: "initial" },
      problems: [
        {
          kind: "dependency",
          objectiveId: "dependency`name",
          subject: { secret: "PRIVATE_SUBJECT" },
          currentLevelId: "initial",
          expectedLevelId: "terminal",
        },
      ],
      gapSummary: "PRIVATE_SUBJECT",
      observedAt: "2026-01-01",
      versions: { [objectiveId]: spec.version },
    },
  };
  const probe = observationMarkdown(observation, spec);
  assert.match(probe, /``dependency`name``/u);
  assert.doesNotMatch(probe, /PRIVATE_SUBJECT/u);
  const goal: ObjectiveGoal = {
    id: "goal*\n# injected",
    objective: spec,
    subject: { secret: "PRIVATE_SUBJECT" },
    targetLevel: "terminal",
    priority: 1,
    observationIntervalMs: 1000,
  };
  const supervision = supervisionMarkdown(
    {
      schemaVersion: 4,
      status: "executed",
      observations: { [goal.id]: observation },
      queue: { revision: 1, demands: [{ ...goal, revision: 1, requirements: ["repair"] }] },
      events: [
        {
          type: "failed",
          demand: { ...goal, revision: 1 },
          error: new Error("Worker unavailable\nTRANSCRIPT_MUST_NOT_APPEAR"),
        },
      ],
    },
    [goal],
    [{ id: "worker", binding: { id: "agent" }, capacity: 1, capabilities: ["repair"] }],
    "cancelled",
  );
  assert.match(supervision, /1 resource; total capacity 1/u);
  assert.match(supervision, /matching capacity does not establish dispatch or completion/u);
  assert.match(supervision, /failure: Worker unavailable/u);
  assert.doesNotMatch(supervision, /PRIVATE_SUBJECT|TRANSCRIPT_MUST_NOT_APPEAR|\n# injected/u);
});
