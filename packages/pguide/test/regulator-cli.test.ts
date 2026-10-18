import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentInput } from "@potential-guide/objective-regulator";
import { agentPrompt, executeAcpAgent } from "../src/commands/regulator.js";
import { bin, fixture, git, root, run, scratch } from "./fixtures.js";

test("permissions persist per attempt and continue uses current grants and revoked ceiling", async () => {
  const f = await fixture();
  try {
    const marker = join(f.directory, "permission-marker");
    const permissions = {
      ceiling: [{ id: "marker", operation: "edit", resources: [marker] }],
      grants: [] as string[],
    };
    await writeFile(
      join(f.repository, "objective", "checks", "ready", "run.js"),
      `#!/usr/bin/env node\nimport {existsSync} from "node:fs";let s="";for await(const c of process.stdin)s+=c;const ok=existsSync(JSON.parse(s).marker);console.log(JSON.stringify({status:200,message:"",payload:{ok,problems:ok?[]:[{id:"not-ready",parameters:{}}]}}));`,
    );
    await writeFile(
      f.subject,
      JSON.stringify({ marker, regulationPermissions: { ...permissions, grants: ["marker"] } }),
    );
    const commit = await f.commit();
    const agent = join(f.directory, "permission-agent.mjs");
    const promptLog = join(f.directory, "permission-prompts.jsonl");
    await writeFile(
      agent,
      `import{createInterface}from"node:readline";import{writeFile,appendFile}from"node:fs/promises";
let prompt;for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);
if(m.method==="session/prompt"){prompt=m;await appendFile(${JSON.stringify(promptLog)},JSON.stringify(m.params)+"\\n");console.log(JSON.stringify({jsonrpc:"2.0",id:"permission",method:"session/request_permission",params:{sessionId:"permission-session",toolCall:{toolCallId:"edit",kind:"edit",locations:[{path:${JSON.stringify(marker)}}],rawInput:{path:${JSON.stringify(marker)},content:"yes"}},options:[{optionId:"allow",name:"Allow",kind:"allow_once"},{optionId:"deny",name:"Deny",kind:"reject_once"}]}}));continue;}
if(m.id==="permission"){if(m.result.outcome.optionId==="allow")await writeFile(${JSON.stringify(marker)},"yes");console.log(JSON.stringify({jsonrpc:"2.0",id:prompt.id,result:{stopReason:"end_turn"}}));continue;}
if(m.id!==undefined)console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result:m.method==="initialize"?{protocolVersion:1,agentCapabilities:{loadSession:true}}:m.method==="session/new"?{sessionId:"permission-session"}:{}}));}`,
    );
    const config = join(f.directory, "config.json");
    const value = {
      schemaVersion: 2,
      defaultAgent: "fixture",
      stateDirectory: join(f.directory, "state"),
      regulationPermissions: permissions,
      regulationStrategy: { quota: { timeoutMs: 20000, maxAgentRuns: 3, maxStallRuns: 2 } },
      agents: {
        fixture: {
          connection: { type: "acp", protocolVersion: "1" },
          transport: { type: "stdio", command: process.execPath, args: [agent] },
        },
      },
    };
    await writeFile(config, JSON.stringify(value));
    const first = await run(bin("regulate"), [
      "--pilot",
      f.uri,
      "--revision",
      commit,
      "--subject-file",
      f.subject,
      "--target",
      "terminal",
      "--config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(first.code, 3, first.stdout + first.stderr);
    const denied = JSON.parse(first.stdout);
    assert.equal(denied.status, "authorization-required");
    assert.equal(denied.outcome.authorizationRequests[0].operation, "edit");
    assert.deepEqual(denied.attempts[0].permissions.grants, []);
    permissions.grants = ["marker"];
    await writeFile(config, JSON.stringify(value));
    const args = [denied.regulationId, "--config", config, "--format", "json"];
    const resumed = await run(bin("continue"), args);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.equal(await readFile(marker, "utf8"), "yes");
    assert.deepEqual(JSON.parse(resumed.stdout).attempts[1].permissions.grants, ["marker"]);
    await rm(marker);
    value.regulationPermissions = { ceiling: [], grants: [] };
    await writeFile(config, JSON.stringify(value));
    const revoked = await run(bin("continue"), args);
    assert.equal(revoked.code, 3, revoked.stdout + revoked.stderr);
    const final = JSON.parse(revoked.stdout);
    assert.equal(final.status, "authorization-required");
    assert.deepEqual(final.attempts[2].permissions, { ceiling: [], grants: [] });
    const persisted = JSON.parse(
      await readFile(
        join(value.stateDirectory, "regulations", denied.regulationId, "regulation.json"),
        "utf8",
      ),
    );
    assert.deepEqual(persisted.permissions, { ceiling: [], grants: [] });
    assert.equal(persisted.attempts[0].actions[0].authorizationRequests[0].operation, "edit");
    const snapshots = (await readFile(promptLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const text = JSON.parse(line).prompt[0].text as string;
        const authorization = /^Current run authorization: (.+)$/m.exec(text)?.[1];
        assert.ok(authorization);
        assert.match(text, /Earlier session denials are historical/);
        return JSON.parse(authorization);
      });
    assert.deepEqual(snapshots, [
      { grants: [] },
      { grants: [{ id: "marker", operation: "edit", resources: [marker] }] },
      { grants: [] },
    ]);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("explicit continue grants another stall allowance while retaining history", async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.repository, "objective", "checks", "ready", "run.js"),
      '#!/usr/bin/env node\nconsole.log(JSON.stringify({status:200,message:"",payload:{ok:false,problems:[{id:"not-ready",parameters:{}}]}}));',
    );
    const commit = await f.commit();
    const agent = join(f.directory, "noop.mjs");
    await writeFile(
      agent,
      `import {createInterface} from "node:readline";
for await(const line of createInterface({input:process.stdin})){
const m=JSON.parse(line);if(!m.id)continue;
const result=m.method==="initialize"?{protocolVersion:1,agentCapabilities:{loadSession:true}}:
m.method==="session/new"?{sessionId:"same"}:m.method==="session/prompt"?{stopReason:"end_turn",summary:"No progress"}:{};
console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));}`,
    );
    const config = join(f.directory, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        defaultAgent: "noop",
        stateDirectory: join(f.directory, "state"),
        regulationStrategy: {
          quota: { timeoutMs: 10000, maxAgentRuns: 5, maxStallRuns: 1 },
        },
        agents: {
          noop: {
            connection: { type: "acp", protocolVersion: "1" },
            transport: { type: "stdio", command: process.execPath, args: [agent] },
          },
        },
      }),
    );
    const first = await run(bin("regulate"), [
      "--pilot",
      f.uri,
      "--revision",
      commit,
      "--subject-file",
      f.subject,
      "--target",
      "terminal",
      "--config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(first.code, 5, first.stdout + first.stderr);
    const firstReport = JSON.parse(first.stdout);
    assert.equal(firstReport.outcome.iterations, 1);
    assert.equal(firstReport.outcome.stalledRuns, 1);
    const second = await run(bin("continue"), [
      firstReport.regulationId,
      "--config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(second.code, 5, second.stdout + second.stderr);
    const secondReport = JSON.parse(second.stdout);
    assert.equal(secondReport.outcome.iterations, 1);
    assert.equal(secondReport.outcome.stalledRuns, 2);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("Agent prompts contain the subject, target and every problem, not a selected task", () => {
  const prompt = agentPrompt({
    permissions: { ceiling: [], grants: [] },
    binding: { id: "fixture" },
    subject: { name: "subject" },
    target: { objectiveId: "git+https://example.invalid/repo.git#pilot.yaml", levelId: "terminal" },
    observation: {
      current: {
        objectiveId: "git+https://example.invalid/repo.git#pilot.yaml",
        levelId: "initial",
      },
      problems: ["first", "second"].map((problemId) => ({
        ref: {
          objectiveId: "git+https://example.invalid/repo.git#pilot.yaml",
          levelId: "initial",
          checkId: "ready",
          problemId,
        },
        parameters: {},
      })),
      gapSummary: "Both failures",
      observedAt: "2026-01-01T00:00:00.000Z",
      versions: {},
    },
    limits: { timeoutMs: 1234 },
  });
  assert.match(prompt, /first/);
  assert.match(prompt, /second/);
  assert.match(prompt, /"timeoutMs":1234/);
  assert.match(prompt, /"name":"subject"/);
  assert.match(prompt, /Current run authorization: \{"grants":\[\]\}/);
  assert.match(prompt, /request host permission evaluation again/);
  assert.match(prompt, /do not let you self-authorize or bypass protocol permission requests/);
});

test("Agent prompt exposes effective grants without the ungranted administrative ceiling", () => {
  const prompt = agentPrompt({
    binding: { id: "fixture" },
    subject: {},
    target: { objectiveId: "git+file:///fixture.git#pilot.yaml", levelId: "terminal" },
    observation: {
      current: { objectiveId: "git+file:///fixture.git#pilot.yaml", levelId: "initial" },
      problems: [],
      gapSummary: "",
      observedAt: new Date().toISOString(),
      versions: {},
    },
    limits: { timeoutMs: 1000 },
    permissions: {
      ceiling: [
        { id: "active", operation: "edit", resources: [join(scratch, "active-marker")] },
        { id: "ungranted-private-rule", operation: "execute", command: "private-command" },
      ],
      grants: ["active"],
    },
  });
  assert.match(prompt, /"id":"active"/);
  assert.doesNotMatch(prompt, /ungranted-private-rule|private-command/);
});

test("regulate and continue persist pinned Pilot observations and use the JSON check protocol", async () => {
  const f = await fixture();
  try {
    const marker = join(f.directory, "repaired");
    const probeCount = join(f.directory, "probe-count");
    await writeFile(
      join(f.repository, "objective", "checks", "ready", "run.js"),
      `#!/usr/bin/env node\nimport{existsSync,readFileSync,writeFileSync}from"node:fs";let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const subject=JSON.parse(s);const count=existsSync(subject.probeCount)?Number(readFileSync(subject.probeCount,"utf8")):0;writeFileSync(subject.probeCount,String(count+1));if(count===0){console.log(JSON.stringify({status:503,payload:null,message:"transient source failure"}));return;}const ok=existsSync(subject.marker);console.log(JSON.stringify({status:200,payload:ok?{ok:true,problems:[]}:{ok:false,problems:[{id:"not-ready",parameters:{index:1}},{id:"not-ready",parameters:{index:2}}]},message:""}));});`,
    );
    await writeFile(f.subject, JSON.stringify({ marker, probeCount }));
    const commit = await f.commit();
    const agent = join(f.directory, "agent.mjs");
    const promptLog = join(f.directory, "prompt.json");
    const rpcLog = join(f.directory, "rpc.jsonl");
    await writeFile(
      agent,
      `import{createInterface}from"node:readline";import{appendFile,writeFile}from"node:fs/promises";for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(!m.id)continue;await appendFile(process.env.RPC_LOG,JSON.stringify(m)+"\\n");let result={};if(m.method==="initialize")result={protocolVersion:1,agentCapabilities:{loadSession:true}};if(m.method==="session/new")result={sessionId:"fixture"};if(m.method==="session/load"&&m.params.sessionId!=="fixture")throw Error("Wrong session ID");if(m.method==="session/prompt"){await writeFile(process.env.PROMPT_LOG,JSON.stringify(m.params));await writeFile(process.env.MARKER,"yes");result={stopReason:"end_turn",summary:"Repaired"};}console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));}`,
    );
    const state = join(f.directory, "state");
    const config = join(f.directory, "config.yaml");
    const regulationStrategy = {
      quota: { timeoutMs: 30000, maxAgentRuns: 10, maxStallRuns: 3 },
      probe: { timeoutMs: 5000, retry: { maxRetries: 1, delayMs: 1 } },
    };
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        defaultAgent: "fixture",
        stateDirectory: state,
        agentExecutionLimits: { timeoutMs: 10_000 },
        regulationStrategy,
        agents: {
          fixture: {
            connection: { type: "acp", protocolVersion: "1" },
            transport: {
              type: "stdio",
              command: process.execPath,
              args: [agent],
              env: ["MARKER", "PROMPT_LOG", "RPC_LOG"],
            },
            requirements: { sessionResume: true },
          },
        },
      }),
    );
    const env = { ...process.env, MARKER: marker, PROMPT_LOG: promptLog, RPC_LOG: rpcLog };
    const result = await run(
      bin("regulate"),
      [
        "--pilot",
        f.uri,
        "--revision",
        commit,
        "--subject-file",
        f.subject,
        "--target",
        "terminal",
        "--config",
        config,
        "--format",
        "json",
      ],
      env,
    );
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome.stopReason, "target-reached");
    assert.equal(report.outcome.iterations, 1);
    const successfulObservations = report.attempts[0].observations.filter(
      (observation: { status: number; payload: unknown }) =>
        observation.status === 200 && observation.payload !== null,
    );
    assert.equal(report.attempts[0].observations[0].payload, null);
    assert.match(report.attempts[0].observations[0].message, /transient source failure/);
    assert.equal(successfulObservations[0].payload.problems.length, 2);
    assert.equal(successfulObservations[1].payload.current.levelId, "terminal");
    assert.equal(successfulObservations[0].payload.versions[f.uri], commit);
    assert.match(await readFile(promptLog, "utf8"), /index\\?":1/);
    assert.match(await readFile(promptLog, "utf8"), /index\\?":2/);
    const persisted = JSON.parse(
      await readFile(join(state, "regulations", report.regulationId, "regulation.json"), "utf8"),
    );
    assert.equal(persisted.schemaVersion, 2);
    assert.equal(persisted.pilotCommit, commit);
    assert.deepEqual(persisted.agentExecutionLimits, { timeoutMs: 10_000 });
    assert.equal("limits" in persisted, false);
    assert.deepEqual(persisted.regulationStrategy, regulationStrategy);
    assert.equal(persisted.sessionId, "fixture");
    assert.equal(persisted.attempts[0].sessionId, "fixture");
    delete persisted.sessionId;
    await writeFile(
      join(state, "regulations", report.regulationId, "regulation.json"),
      JSON.stringify(persisted),
    );
    await rm(marker);
    await rm(probeCount);
    const updatedConfig = JSON.parse(await readFile(config, "utf8"));
    updatedConfig.regulationStrategy.probe.retry.maxRetries = 0;
    await writeFile(config, JSON.stringify(updatedConfig));
    const continued = await run(
      bin("continue"),
      [report.regulationId, "--config", config, "--format", "json"],
      env,
    );
    assert.equal(continued.code, 0, continued.stdout + continued.stderr);
    assert.equal(JSON.parse(continued.stdout).outcome.iterations, 1);
    assert.equal(JSON.parse(continued.stdout).attempts.length, 2);
    assert.equal(JSON.parse(continued.stdout).attempts[1].resumeMode, "resumed");
    const requests = (await readFile(rpcLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(requests.filter((request) => request.method === "session/new").length, 1);
    assert.equal(requests.filter((request) => request.method === "session/load").length, 1);
    assert.equal(
      requests.find((request) => request.method === "session/load").params.sessionId,
      "fixture",
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("continuation without a real session ID fails when required and is explicit otherwise", async () => {
  const input: AgentInput = {
    permissions: { ceiling: [], grants: [] },
    binding: { id: "fixture" },
    subject: {},
    target: { objectiveId: "git+file:///fixture.git#pilot.yaml", levelId: "terminal" },
    observation: {
      current: { objectiveId: "git+file:///fixture.git#pilot.yaml", levelId: "initial" },
      problems: [],
      gapSummary: "",
      observedAt: new Date().toISOString(),
      versions: {},
    },
    limits: { timeoutMs: 1000 },
  };
  const profile = {
    connection: { type: "acp" as const, protocolVersion: "1" },
    transport: {
      type: "stdio" as const,
      command: process.execPath,
      args: [
        "-e",
        'const r=require("node:readline").createInterface({input:process.stdin});r.on("line",l=>{const m=JSON.parse(l);let result=m.method==="initialize"?{protocolVersion:1}:m.method==="session/new"?{sessionId:"actual-new-id"}:{stopReason:"end_turn",summary:"done"};console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));});',
      ],
    },
  };
  await assert.rejects(
    executeAcpAgent(
      input,
      new AbortController().signal,
      {
        ...profile,
        requirements: { sessionResume: true },
      },
      root,
      undefined,
      { continuing: true },
    ),
    /no real ACP session ID/,
  );
  let mode: string | undefined;
  const outcome = await executeAcpAgent(
    input,
    new AbortController().signal,
    profile,
    root,
    undefined,
    {
      continuing: true,
      onSession: async (id, selected) => {
        assert.equal(id, "actual-new-id");
        mode = selected;
      },
    },
  );
  assert.equal(outcome.status, "completed");
  assert.equal(mode, "new-without-session-id");
  const unavailable = {
    ...profile,
    transport: {
      ...profile.transport,
      args: [
        "-e",
        'require("node:readline").createInterface({input:process.stdin}).on("line",l=>{const m=JSON.parse(l);console.log(JSON.stringify(m.method==="session/load"?{jsonrpc:"2.0",id:m.id,error:{code:-32000,message:"resume unavailable"}}:{jsonrpc:"2.0",id:m.id,result:m.method==="initialize"?{protocolVersion:1,agentCapabilities:{loadSession:true}}:m.method==="session/new"?{sessionId:"unexpected-new"}:{stopReason:"end_turn"}}));});',
      ],
    },
  };
  await assert.rejects(
    executeAcpAgent(input, new AbortController().signal, unavailable, root, undefined, {
      continuing: true,
      sessionId: "actual-old-id",
    }),
    /resume unavailable/,
  );
});

test("legacy continue records and cross-round CLI budgets fail explicitly", async () => {
  const directory = await mkdtemp(join(scratch, "pguide-test-"));
  try {
    const id = "00000000-0000-0000-0000-000000000000";
    const state = join(directory, "state");
    await mkdir(join(state, "regulations", id), { recursive: true });
    await writeFile(
      join(state, "regulations", id, "regulation.json"),
      JSON.stringify({ schemaVersion: 1 }),
    );
    const config = join(directory, "config.yaml");
    await writeFile(config, JSON.stringify({ schemaVersion: 2, stateDirectory: state }));
    const legacy = await run(bin("continue"), [id, "--config", config, "--format", "json"]);
    assert.equal(legacy.code, 2, legacy.stdout);
    assert.match(legacy.stdout, /Legacy continue records are incompatible/);
    for (const flag of ["--max-iterations", "--max-stalled-iterations", "--timeout", "--guide"]) {
      const old = await run(bin("regulate"), [flag, "1", "--format", "json"]);
      assert.equal(old.code, 2);
      assert.match(old.stdout, /Unknown option/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("per-Agent timeout includes ACP startup and invocation failures never start an Agent", async () => {
  const f = await fixture();
  try {
    const check = join(f.repository, "objective", "checks", "ready", "run.js");
    await writeFile(
      check,
      '#!/usr/bin/env node\nconsole.log(JSON.stringify({status:200,payload:{ok:false,problems:[{id:"not-ready",parameters:{}}]},message:""}));',
    );
    const commit = await f.commit();
    const agent = join(f.directory, "hang.mjs");
    const started = join(f.directory, "started");
    await writeFile(
      agent,
      'import{writeFileSync}from"node:fs";writeFileSync(process.env.STARTED,"yes");setInterval(()=>{},1000);',
    );
    const config = join(f.directory, "config.yaml");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        defaultAgent: "fixture",
        stateDirectory: join(f.directory, "state"),
        agents: {
          fixture: {
            connection: { type: "acp", protocolVersion: "1" },
            transport: {
              type: "stdio",
              command: process.execPath,
              args: [agent],
              env: ["STARTED"],
            },
          },
        },
      }),
    );
    const env = { ...process.env, STARTED: started };
    const args = [
      "--pilot",
      f.uri,
      "--revision",
      commit,
      "--subject-file",
      f.subject,
      "--target",
      "terminal",
      "--agent-timeout-ms",
      "500",
      "--config",
      config,
      "--format",
      "json",
    ];
    const limited = await run(bin("regulate"), args, env);
    assert.equal(limited.code, 5, limited.stdout + limited.stderr);
    assert.equal(JSON.parse(limited.stdout).outcome.stopReason, "exhausted");
    assert.equal(await readFile(started, "utf8"), "yes");
    await rm(started);
    await writeFile(check, "#!/usr/bin/env node\nconsole.log(JSON.stringify({pass:true}));");
    const invalidCommit = await f.commit();
    args[3] = invalidCommit;
    const failed = await run(bin("regulate"), args, env);
    assert.equal(failed.code, 6, failed.stdout + failed.stderr);
    assert.equal(JSON.parse(failed.stdout).status, "regulation-error");
    await assert.rejects(readFile(started), { code: "ENOENT" });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("one-shot regulation finishes at target without scheduling another observation", async () => {
  const f = await fixture();
  try {
    const commit = await f.commit();
    const config = join(f.directory, "one-shot.yaml");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        defaultAgent: "unused",
        stateDirectory: join(f.directory, "state"),
        regulationStrategy: {
          quota: { timeoutMs: 1500, maxAgentRuns: 2, maxStallRuns: 2 },
          probe: { timeoutMs: 1000, retry: { maxRetries: 0, delayMs: 0 } },
        },
        agents: {
          unused: {
            connection: { type: "acp", protocolVersion: "1" },
            transport: {
              type: "stdio",
              command: process.execPath,
              args: ["-e", 'throw Error("Agent must not start")'],
            },
          },
        },
      }),
    );
    const result = await run(bin("regulate"), [
      "--pilot",
      f.uri,
      "--revision",
      commit,
      "--subject-file",
      f.subject,
      "--target",
      "terminal",
      "--config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "target-reached");
    assert.equal(report.attempts[0].observations.length, 1);
    assert.deepEqual(report.attempts[0].actions, []);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("continue preserves local unpublished source metadata without changing the origin Objective identity", async () => {
  const f = await fixture();
  try {
    await git(
      f.repository,
      "remote",
      "set-url",
      "origin",
      "https://example.invalid/unpublished.git",
    );
    const commit = await f.commit();
    const identity = "git+https://example.invalid/unpublished.git#objective/pilot.yaml";
    const state = join(f.directory, "state");
    const config = join(f.directory, "config.yaml");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        defaultAgent: "unused",
        stateDirectory: state,
        agents: {
          unused: {
            connection: { type: "acp", protocolVersion: "1" },
            transport: {
              type: "stdio",
              command: process.execPath,
              args: ["-e", 'throw Error("Agent must not start")'],
            },
          },
        },
      }),
    );
    const created = await run(bin("regulate"), [
      "--pilot",
      f.manifest,
      "--subject-file",
      f.subject,
      "--target",
      "terminal",
      "--config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(created.code, 0, created.stdout + created.stderr);
    const report = JSON.parse(created.stdout);
    const persisted = JSON.parse(
      await readFile(join(state, "regulations", report.regulationId, "regulation.json"), "utf8"),
    );
    assert.equal(persisted.sourcePath, f.manifest);
    assert.equal(persisted.pilotUri, identity);
    await writeFile(join(f.repository, "advanced.txt"), "The current checkout has advanced.");
    assert.notEqual(await f.commit(), commit);
    const continued = await run(bin("continue"), [
      report.regulationId,
      "--config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(continued.code, 0, continued.stdout + continued.stderr);
    const current = JSON.parse(continued.stdout).outcome.latestObservation.payload;
    assert.equal(current.current.objectiveId, identity);
    assert.equal(current.versions[identity], commit);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
