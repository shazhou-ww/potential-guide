import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  createProcessCheckProbe,
  fileResources,
  loadPilotSpec,
} from "@potential-guide/objective-pilot";
import { bin, fixture, git, root, run } from "./fixtures.js";

const objective = join(root, "objectives", "pguide-setup");
const helper = join(objective, "setup-check.mjs");
const composition = join(root, "packages", "pguide", "dist", "bin.js");

interface CheckEnvelope {
  status: number;
  payload: null | { ok: boolean; problems: { id: string; parameters: unknown }[] };
  message: string;
}

test("ACP-only setup reports an AHP selection as unsupported without starting an Agent", async () => {
  const f = await setup();
  try {
    await writeFile(
      f.subject.configPath,
      JSON.stringify({
        ...f.config,
        agents: {
          fixture: {
            type: "ahp",
            connection: { protocolVersion: "1.0.0", agent: "generic-provider" },
            transport: { type: "websocket", url: "ws://127.0.0.1:1" },
          },
        },
      }),
    );
    const envelope = await f.direct("configuration");
    assert.equal(envelope.status, 200);
    assert.equal(envelope.payload?.problems[0]?.id, "acp-unavailable");
    assert.match(JSON.stringify(envelope.payload), /ACP stdio readiness only/);
    assert.equal(existsSync(f.log), false);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

async function setup(mode = "fix") {
  const f = await fixture();
  const work = join(f.directory, "work");
  const scratch = join(f.directory, "setup-scratch");
  const home = join(f.directory, "home");
  await mkdir(work);
  await mkdir(scratch);
  await mkdir(home);
  const commands = join(f.directory, "commands");
  await mkdir(commands);
  for (const [name, script] of Object.entries({
    config: join(root, "packages", "pguide-config", "dist", "bin.js"),
    probe: bin("probe"),
    regulate: bin("regulate"),
  })) {
    await writeFile(
      join(commands, `pguide-${name}${process.platform === "win32" ? ".cmd" : ""}`),
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
      { mode: 0o755 },
    );
  }
  const log = join(f.directory, "acp.jsonl");
  const agent = join(f.directory, "agent.mjs");
  await writeFile(
    agent,
    `import {createInterface} from "node:readline";
import {spawn} from "node:child_process";
import {appendFile,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
const mode=${JSON.stringify(mode)}, log=${JSON.stringify(log)};
let cwd, pendingPrompt;
for await (const line of createInterface({input:process.stdin})) {
  const m=JSON.parse(line); if(m.id===undefined)continue;
  if(mode==="prompt-timeout" && m.method==="session/prompt"){
    const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
    await appendFile(log,JSON.stringify({method:"fixture/descendant",pid:child.pid})+"\\n");
  }
  await appendFile(log,JSON.stringify({method:m.method??"permission-response",cwd:m.params?.cwd,protocolVersion:m.params?.protocolVersion,text:m.params?.prompt?.[0]?.text,pid:process.pid})+"\\n");
  if(m.method===undefined) {
    console.log(JSON.stringify({jsonrpc:"2.0",id:pendingPrompt,result:{stopReason:"end_turn",summary:"SECRET-MODEL-TEXT"}}));
    continue;
  }
  if(mode==="malformed"){console.log("not JSON");continue;}
  if(mode==="timeout"){setInterval(()=>{},1000);continue;}
  let result={};
  if(m.method==="initialize") {
    if(m.params.protocolVersion!==1)throw Error("initialize requires a numeric protocolVersion");
    if(mode==="rejected"){console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,error:{code:-32000,message:"SECRET-SERVER-TEXT"}}));continue;}
    if(mode==="home" && await readFile(process.env.USERPROFILE+"/logged-in","utf8")!=="existing")throw Error("No login");
    result={protocolVersion:mode==="string-version"?"1":1,agentCapabilities:{loadSession:true}};
  }
  if(m.method==="session/new"){cwd=m.params.cwd;result={sessionId:"real-fixture-session"};}
  if(m.method==="session/prompt") {
    if(mode==="prompt-timeout"){setInterval(()=>{},1000);continue;}
    const text=m.params.prompt[0].text;
    const direct=text.includes("Self-check task: ");
    const subject=direct?JSON.parse(text.split("Self-check task: ")[1].split("\\n")[0]):JSON.parse(text.split("\\nSubject: ")[1].split("\\nComplete observation: ")[0]);
    if(direct)subject.marker=join(cwd,subject.marker);
    if(mode==="fix" || mode==="home" || mode==="denied" || mode==="incomplete")await writeFile(subject.marker,subject.expected);
    if(mode==="wrong")await writeFile(subject.marker,"a different successful-looking marker");
    if(mode==="denied"){
      pendingPrompt=m.id;
      console.log(JSON.stringify({jsonrpc:"2.0",id:"permission",method:"session/request_permission",params:{sessionId:"real-fixture-session",toolCall:{toolCallId:"write",kind:"edit",locations:[{path:subject.marker}],rawInput:{path:subject.marker}},options:[{optionId:"yes",name:"Yes",kind:"allow_once"}]}}));
      continue;
    }
    if(mode==="overflow"){console.log("x".repeat(220000));setInterval(()=>{},1000);continue;}
    if(mode==="incomplete"){console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{stopReason:"max_tokens"}}));continue;}
    result={stopReason:"end_turn",summary:"Done"};
  }
  console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));
}`,
  );
  const configPath = join(f.directory, "config.json");
  const config = {
    schemaVersion: 2,
    commandDirectories: [commands],
    defaultAgent: "fixture",
    agents: {
      fixture: {
        connection: { type: "acp", protocolVersion: "1" },
        transport: { type: "stdio", command: process.execPath, args: [agent], env: [] as string[] },
      },
    },
  };
  await writeFile(configPath, JSON.stringify(config));
  const subject = {
    workingDirectory: work,
    configPath,
    scratchDirectory: scratch,
    pguide: { command: process.execPath, args: [composition] },
    desiredVersion: "0.4.0-rc.0",
    userHome: home,
    allowSanity: false,
    timeoutMs: 24000,
  };
  const env = {
    ...process.env,
    PATH: [
      dirname(process.execPath),
      ...(process.env.PATH ?? "")
        .split(delimiter)
        .filter((path) => existsSync(join(path, process.platform === "win32" ? "git.exe" : "git"))),
      ...(process.platform === "win32"
        ? [join(process.env.SystemRoot as string, "System32")]
        : ["/usr/bin", "/bin"]),
    ].join(delimiter),
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    XDG_CONFIG_HOME: home,
    PGUIDE_SETUP_TEST_AUTH: "non-secret-fixture-value",
    PGUIDE_STATE_DIRECTORY: join(f.directory, "must-not-be-used"),
    GIT_DIR: join(f.repository, ".git"),
    GIT_INDEX_FILE: join(f.directory, "must-not-use-index"),
  };
  async function direct(stage: string, value: unknown = subject, script = helper) {
    await writeFile(f.subject, JSON.stringify(value));
    const result = await run(script, [stage, "--subject-file", f.subject], env);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout) as CheckEnvelope;
    assert.deepEqual(await readdir(scratch), [], "owned scratch must be cleaned");
    await assert.rejects(lstat(join(f.directory, "must-not-be-used")), { code: "ENOENT" });
    await assert.rejects(lstat(join(f.directory, "must-not-use-index")), { code: "ENOENT" });
    return envelope;
  }
  async function updateConfig() {
    await writeFile(configPath, JSON.stringify(config));
  }
  return {
    ...f,
    subjectFile: f.subject,
    work,
    scratch,
    home,
    agent,
    log,
    config,
    subject,
    env,
    direct,
    updateConfig,
  };
}

function isProblem(envelope: CheckEnvelope, id: string) {
  assert.equal(envelope.status, 200, envelope.message);
  assert.equal(envelope.payload?.ok, false);
  assert.deepEqual(
    envelope.payload?.problems.map((entry) => entry.id),
    [id],
  );
  assert.equal(typeof envelope.payload?.problems[0]?.parameters, "object");
}
function passed(envelope: CheckEnvelope) {
  assert.equal(envelope.status, 200, envelope.message);
  assert.deepEqual(envelope.payload, { ok: true, problems: [] });
}

test("setup Pilot strictly loads with all level-scoped check and problem wiki coverage", async () => {
  const spec = await loadPilotSpec(join(objective, "pilot.yaml"), fileResources);
  assert.deepEqual(
    spec.manifest.levels.map(({ id }) => id),
    ["initial", "installed", "configured"],
  );
  for (const level of spec.manifest.levels) {
    for (const check of level.advancement.checks) {
      const scope = `levels/${level.id}/checks/${check.id}`;
      assert.ok(spec.locales["zh-CN"]?.[scope]);
      for (const id of check.problems)
        assert.ok(spec.locales["zh-CN"]?.[`${scope}/problems/${id}`]);
    }
  }
  const result = await run(bin("validate"), [
    "pilot",
    join(objective, "pilot.yaml"),
    "--format",
    "json",
  ]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
});

test("native setup bootstrap distinguishes missing/unusable installation and exact versions", async () => {
  const f = await setup();
  try {
    passed(await f.direct("installation"));
    isProblem(
      await f.direct("installation", {
        ...f.subject,
        pguide: { command: join(f.directory, "missing-executable") },
      }),
      "installation-missing",
    );
    isProblem(
      await f.direct("installation", {
        ...f.subject,
        pguide: { command: process.execPath, args: ["-e", "process.exit(9)"] },
      }),
      "installation-unusable",
    );
    isProblem(
      await f.direct("installation", { ...f.subject, desiredVersion: "not-this-version" }),
      "version-mismatch",
    );
    assert.equal(
      (
        await f.direct("installation", {
          ...f.subject,
          pguide: { command: process.execPath, args: ["-e", "console.log('not JSON')", "--"] },
        })
      ).status,
      502,
    );
    assert.equal(
      (await f.direct("installation", { ...f.subject, scratchDirectory: "relative" })).status,
      400,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("configuration reports missing/invalid config, unsupported commands, absent Agent and missing env", async () => {
  const f = await setup();
  try {
    isProblem(
      await f.direct("configuration", {
        ...f.subject,
        configPath: join(f.directory, "absent.json"),
      }),
      "configuration-missing",
    );
    await writeFile(f.subject.configPath, "schemaVersion: 1");
    isProblem(await f.direct("configuration"), "configuration-invalid");
    await f.updateConfig();
    const fake = join(f.directory, "unsupported.cjs");
    await writeFile(
      fake,
      `console.log(JSON.stringify(process.argv.includes("--version")?{schemaVersion:1,name:"pguide",version:"0.4.0-rc.0"}:{commands:[],conflicts:{}}));`,
    );
    isProblem(
      await f.direct("configuration", {
        ...f.subject,
        pguide: { command: process.execPath, args: [fake] },
      }),
      "command-unavailable",
    );
    isProblem(await f.direct("configuration", { ...f.subject, agent: "unknown" }), "agent-missing");
    f.config.agents.fixture.transport.env = ["PGUIDE_SETUP_MISSING_AUTH_REFERENCE"];
    await f.updateConfig();
    isProblem(await f.direct("configuration"), "environment-unavailable");
    f.config.agents.fixture.transport.env = [];
    f.config.agents.fixture.transport.command = join(f.directory, "missing-agent");
    await f.updateConfig();
    isProblem(await f.direct("configuration"), "acp-unavailable");
    await assert.rejects(readFile(f.log), { code: "ENOENT" });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("configuration performs real ACP initialize and session/new without prompting", async () => {
  const f = await setup();
  try {
    passed(await f.direct("configuration"));
    const messages = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      messages.map(({ method }) => method),
      ["initialize", "session/new"],
    );
    assert.ok(messages[1].cwd.startsWith(f.scratch));
    assert.equal(messages[0].protocolVersion, 1);
    for (const { pid } of messages) assert.throws(() => process.kill(pid, 0));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("setup ACP rejects string negotiation and emits only safe rejection diagnostics", async () => {
  for (const mode of ["string-version", "rejected"]) {
    const f = await setup(mode);
    try {
      const envelope = await f.direct("configuration");
      assert.equal(envelope.payload?.problems[0]?.id, "acp-unavailable");
      assert.deepEqual(envelope.payload?.problems[0]?.parameters, {
        stage: "initialize",
        reason: mode === "rejected" ? "agent-rejected" : "incompatible-capabilities",
      });
      assert.doesNotMatch(JSON.stringify(envelope), /SECRET-SERVER-TEXT/);
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  }
});

test("local target is backward compatible; long direct deadlines are rejected by Pilot guard", async () => {
  const f = await setup();
  try {
    passed(
      await f.direct("installation", {
        ...f.subject,
        target: { type: "local" },
        timeoutMs: 180000,
      }),
    );
    const { check } = await import(pathToFileURL(helper).href);
    const envelope = await check(
      "installation",
      { ...f.subject, timeoutMs: 180000 },
      { pilot: true },
    );
    assert.equal(envelope.status, 400);
    assert.match(envelope.message, /outer-timeout/);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("local Pilot deadlines require valid coordinated runtime metadata and a cleanup reserve", async () => {
  const f = await setup();
  const previous = process.env.PGUIDE_PROBE_TIMEOUT_MS;
  try {
    const { check } = await import(pathToFileURL(helper).href);
    for (const [metadata, timeoutMs, accepted] of [
      [undefined, 24000, true],
      [undefined, 60000, false],
      ["30000", 24000, true],
      ["29999", 24000, false],
      ["65000", 60000, false],
      ["66000", 60000, true],
      ["75000", 60000, true],
      ["305999", 300000, false],
      ["306000", 300000, true],
      ...[
        "",
        "garbage",
        "0",
        "-1",
        "75000.5",
        "7.5e4",
        " 75000",
        "75000\n",
        "075000",
        "+75000",
        "NaN",
        "Infinity",
        "2147483648",
        "9007199254740992",
      ].map((metadata) => [metadata, 100, false] as const),
    ] as const) {
      if (metadata === undefined) delete process.env.PGUIDE_PROBE_TIMEOUT_MS;
      else process.env.PGUIDE_PROBE_TIMEOUT_MS = metadata;
      const result = await check("installation", { ...f.subject, timeoutMs }, { pilot: true });
      if (accepted) passed(result);
      else {
        assert.equal(result.status, 400, `${metadata}: ${JSON.stringify(result)}`);
        assert.match(result.message, /outer-timeout/);
      }
      assert.deepEqual(await readdir(f.scratch), []);
    }
    process.env.PGUIDE_PROBE_TIMEOUT_MS = "75000";
    const ssh = await check(
      "installation",
      { ...remoteSubject, timeoutMs: 15000 },
      { pilot: true },
    );
    assert.equal(ssh.status, 400);
    assert.match(ssh.message, /outer-timeout/);
  } finally {
    if (previous === undefined) delete process.env.PGUIDE_PROBE_TIMEOUT_MS;
    else process.env.PGUIDE_PROBE_TIMEOUT_MS = previous;
    await rm(f.directory, { recursive: true, force: true });
  }
});

const remoteSubject = {
  target: {
    type: "ssh",
    host: "worker@target-alias",
    shell: "posix",
    node: "/usr/bin/node",
    port: 2222,
  },
  workingDirectory: "/home/worker",
  configPath: "/home/worker/.config/pguide/config.yaml",
  scratchDirectory: "/home/worker/setup-scratch",
  pguide: { command: "pguide" },
  timeoutMs: 1000,
};
const transportModule = () => import(pathToFileURL(join(objective, "ssh-target.mjs")).href);

test("SSH adapter quotes code and rejects injection, forwards no control subject paths or environment", async () => {
  const { sshRequest } = await transportModule();
  const request = await sshRequest("installation", remoteSubject);
  assert.equal(request.command, "ssh");
  assert.deepEqual(request.args.slice(-3, -1), ["--", "worker@target-alias"]);
  for (const option of [
    "BatchMode=yes",
    "StrictHostKeyChecking=yes",
    "SendEnv=-*",
    "SetEnv=PGUIDE_SETUP_REMOTE=1",
    "ForwardAgent=no",
    "PermitLocalCommand=no",
  ])
    assert.ok(request.args.includes(option));
  assert.ok(request.args.includes("2222"));
  assert.match(request.args.at(-1), /command -v '\/usr\/bin\/node'/);
  const payload = JSON.parse(request.input);
  assert.equal(payload.subject.target, undefined);
  assert.equal(payload.subject.userHome, undefined);
  assert.equal(payload.subject.configPath, remoteSubject.configPath);
  assert.doesNotMatch(request.input, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(Object.keys(payload.files).length, 10);
  for (const target of [
    { ...remoteSubject.target, host: "-oProxyCommand=bad" },
    { ...remoteSubject.target, host: "user@host;touch-bad" },
    { ...remoteSubject.target, node: "node -e bad" },
    { ...remoteSubject.target, node: "/node'bad" },
    { ...remoteSubject.target, shell: "powershell" },
    { ...remoteSubject.target, port: 0 },
    { ...remoteSubject.target, env: { SECRET: "bad" } },
  ])
    await assert.rejects(
      sshRequest("installation", { ...remoteSubject, target }),
      /invalid-target/,
    );
  const { check } = await import(pathToFileURL(helper).href);
  assert.equal(
    (await check("installation", { ...remoteSubject, userHome: "/control/home" })).status,
    400,
  );
  const blocked = await check("sanity", { ...remoteSubject, allowSanity: false });
  isProblem(blocked, "sanity-consent-required");
});

test("SSH unreachable, missing Node and helper faults never fall back to local evidence", async () => {
  const { checkSsh } = await transportModule();
  for (const [code, message] of [
    [255, /ssh-unreachable/],
    [69, /remote-node-missing/],
    [70, /remote-helper-failed/],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      checkSsh("installation", remoteSubject, async () => {
        calls++;
        return { code, stdout: "SECRET SERVER DIAGNOSTIC" };
      }),
      message,
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    checkSsh("installation", remoteSubject, async () => ({ code: 0, stdout: "not-json" })),
    /remote-helper-protocol/,
  );
  const envelope = await checkSsh("installation", remoteSubject, async () => ({
    code: 0,
    stdout: JSON.stringify({
      identity: { hostname: "actual-target-name", user: "worker" },
      result: {
        status: 200,
        payload: { ok: false, problems: [{ id: "installation-missing", parameters: {} }] },
        message: "",
      },
    }),
  }));
  isProblem(envelope, "installation-missing");
  assert.deepEqual(JSON.parse(envelope.message).target, {
    type: "ssh",
    connection: "worker@target-alias",
    hostname: "actual-target-name",
    user: "worker",
  });
});

test("shipped Node bootstrap runs independently and cleans target payload and timed out children", async () => {
  const f = await setup();
  const { sshRequest, remoteBootstrap, runSsh } = await transportModule();
  try {
    const request = await sshRequest("installation", remoteSubject);
    const payload = JSON.parse(request.input);
    const { userHome: _home, ...subject } = f.subject;
    payload.subject = { ...subject, pguide: { command: join(f.directory, "absent-on-target") } };
    const result = await runSsh({
      command: process.execPath,
      args: ["-e", remoteBootstrap],
      input: JSON.stringify(payload),
      timeoutMs: 5000,
    });

    assert.equal(result.code, 0, result.stdout);
    const response = JSON.parse(result.stdout);
    isProblem(response.result, "installation-missing");
    assert.ok(response.identity.hostname);
    assert.ok(response.identity.user);
    assert.deepEqual(await readdir(f.scratch), []);
    const sleeper = join(f.directory, "remote-sleeper.cjs");
    await writeFile(sleeper, "setInterval(()=>{},1000);");
    payload.subject = {
      ...subject,
      timeoutMs: 500,
      pguide: { command: process.execPath, args: [sleeper] },
    };
    const timed = await runSsh({
      command: process.execPath,
      args: ["-e", remoteBootstrap],
      input: JSON.stringify(payload),
      timeoutMs: 7000,
    });
    assert.equal(JSON.parse(timed.stdout).result.status, 504);
    assert.deepEqual(await readdir(f.scratch), []);
    await assert.rejects(
      runSsh({
        command: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
        input: "",
        timeoutMs: 100,
      }),
      /ssh-timeout/,
    );
    await assert.rejects(
      runSsh({
        command: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(300000));setInterval(()=>{},1000)"],
        input: "",
        timeoutMs: 5000,
      }),
      /ssh-output-limit/,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("remote payload uses target authentication and performs actual nonce sanity, not control evidence", async () => {
  const f = await setup("home");
  const { sshRequest, remoteBootstrap, runSsh } = await transportModule();
  try {
    await writeFile(join(f.home, "logged-in"), "existing");
    f.config.agents.fixture.transport.env = ["USERPROFILE"];
    await f.updateConfig();
    const payload = JSON.parse((await sshRequest("sanity", remoteSubject)).input);
    const { userHome: _home, ...subject } = f.subject;
    // Direct transport semantics include cold CLI startup, not the SSH Pilot cap.
    payload.subject = { ...subject, allowSanity: true, timeoutMs: 60000 };
    const result = await runSsh({
      command: process.execPath,
      args: ["-e", remoteBootstrap],
      input: JSON.stringify(payload),
      timeoutMs: payload.subject.timeoutMs + 10000,
      env: f.env,
    });
    assert.equal(result.code, 0, result.stdout);
    passed(JSON.parse(result.stdout).result);
    const entries = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(entries.filter(({ method }) => method === "session/prompt").length, 1);
    assert.ok(entries.filter(({ cwd }) => cwd).every(({ cwd }) => cwd.startsWith(f.scratch)));
    assert.deepEqual(await readdir(f.scratch), []);
    assert.equal(await readFile(join(f.home, "logged-in"), "utf8"), "existing");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("malformed ACP is an invocation fault rather than false configuration readiness", async () => {
  const f = await setup("malformed");
  try {
    const envelope = await f.direct("configuration");
    assert.equal(envelope.status, 502);
    assert.equal(envelope.payload, null);
    assert.match(envelope.message, /protocol/);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("sanity without explicit consent never starts even the pguide or ACP process", async () => {
  const f = await setup();
  try {
    isProblem(
      await f.direct("sanity", {
        ...f.subject,
        pguide: { command: join(f.directory, "absent") },
      }),
      "sanity-consent-required",
    );
    await assert.rejects(readFile(f.log), { code: "ENOENT" });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

for (const mode of ["noop", "wrong", "fix"]) {
  test(`real sanity ${mode === "fix" ? "verifies a finite repair" : `rejects ${mode} Agent completion`}`, async () => {
    const f = await setup(mode);
    try {
      const original = await readFile(f.subject.configPath, "utf8");
      const envelope = await f.direct("sanity", {
        ...f.subject,
        allowSanity: true,
        // All finite business outcomes include cold CLI startups, not a Pilot deadline test.
        timeoutMs: 60000,
      });
      if (mode === "fix") passed(envelope);
      else {
        isProblem(envelope, "sanity-failed");
        assert.deepEqual(envelope.payload?.problems[0]?.parameters, {
          stage: "regulate",
          reason: "quota-exhausted",
          exhaustedBy: "stall",
        });
      }
      const messages = (await readFile(f.log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(messages.filter(({ method }) => method === "session/prompt").length, 1);
      assert.equal(await readFile(f.subject.configPath, "utf8"), original);
      assert.deepEqual(await readdir(f.work), []);
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });
}

test("setup timeout kills its entire owned process tree and cleans scratch", async () => {
  const f = await setup();
  try {
    const sleeper = join(f.directory, "sleeper.cjs");
    const pidFile = join(f.directory, "pids.json");
    await writeFile(
      sleeper,
      `const{spawn}=require("node:child_process");const{writeFileSync}=require("node:fs");const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`,
    );
    const start = Date.now();
    const envelope = await f.direct("installation", {
      ...f.subject,
      timeoutMs: 1000,
      pguide: { command: process.execPath, args: [sleeper] },
    });
    assert.equal(envelope.status, 504);
    assert.equal(envelope.payload, null);
    assert.ok(Date.now() - start < 6000);
    for (const pid of JSON.parse(await readFile(pidFile, "utf8")))
      assert.throws(() => process.kill(pid, 0));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("external Pilot cancellation cleans nested setup scratch and its hanging child tree", async () => {
  const f = await setup();
  const controller = new AbortController();
  let operation: Promise<unknown> | undefined;
  try {
    const runner = join(f.directory, "pilot-check.mjs");
    const sleeper = join(f.directory, "pilot-sleeper.cjs");
    const pidFile = join(f.directory, "pilot-pids.json");
    await writeFile(
      runner,
      `import {main} from ${JSON.stringify(pathToFileURL(helper).href)};
process.stderr.write(process.env.PGUIDE_PROBE_TEMP_DIR);
await main("installation",{pilot:true});`,
    );
    await writeFile(
      sleeper,
      `const{spawn}=require("node:child_process");const{writeFileSync}=require("node:fs");
const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,child.pid]));
setInterval(()=>{},1000);`,
    );
    let directory = "";
    operation = createProcessCheckProbe({
      command: process.execPath,
      args: [runner],
      timeoutMs: 75000,
      log: (text) => {
        directory += text;
      },
    })(
      {
        ...f.subject,
        timeoutMs: 60000,
        pguide: { command: process.execPath, args: [sleeper] },
      },
      controller.signal,
    );
    const deadline = Date.now() + 10000;
    while (!existsSync(pidFile)) {
      assert.ok(Date.now() < deadline, "hanging setup child must start");
      await delay(25);
    }
    const pids = JSON.parse(await readFile(pidFile, "utf8")) as number[];
    assert.equal((await readdir(directory)).length, 1, "setup scratch belongs to the runtime");
    controller.abort(new Error("external setup cancellation"));
    await assert.rejects(operation, /external setup cancellation/);
    for (const pid of pids) assert.throws(() => process.kill(pid, 0));
    await assert.rejects(lstat(directory), { code: "ENOENT" });
    assert.deepEqual(await readdir(f.scratch), []);
  } finally {
    controller.abort();
    await operation?.catch(() => {});
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("oversized child output is bounded and reported as invocation fault", async () => {
  const f = await setup();
  try {
    const noisy = join(f.directory, "noisy.cjs");
    await writeFile(noisy, "process.stdout.write('x'.repeat(300000));setInterval(()=>{},1000);");
    const envelope = await f.direct("installation", {
      ...f.subject,
      pguide: { command: process.execPath, args: [noisy] },
    });

    assert.equal(envelope.status, 502);
    assert.match(envelope.message, /output-limit/);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("sanity timeout during an actual ACP prompt cleans isolated config, state and descendants", async () => {
  const f = await setup("prompt-timeout");
  try {
    const runner = join(f.directory, "prompt-deadline.mjs");
    await writeFile(
      runner,
      `import {readFile} from "node:fs/promises";
import {main} from ${JSON.stringify(pathToFileURL(helper).href)};
const controller = new AbortController();
const timer = setInterval(async () => {
  try {
    const log = await readFile(${JSON.stringify(f.log)}, "utf8");
    if (log.includes('"method":"session/prompt"')) {
      clearInterval(timer);
      setTimeout(() => controller.abort(), 100);
    }
  } catch (error) { if(error.code !== "ENOENT") throw error; }
}, 25);
try { await main(undefined, {signal: controller.signal}); } finally { clearInterval(timer); }
`,
    );
    const original = await readFile(f.subject.configPath, "utf8");
    const envelope = await f.direct(
      "sanity",
      {
        ...f.subject,
        allowSanity: true,
        // Startup is bounded separately; trigger the deadline only after the real
        // hanging prompt is observed, not after an assumed machine startup time.
        timeoutMs: 60000,
      },
      runner,
    );
    assert.equal(envelope.status, 504, JSON.stringify(envelope));
    const entries = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(entries.filter(({ method }) => method === "session/prompt").length, 1);
    for (const { pid } of entries) assert.throws(() => process.kill(pid, 0));
    assert.equal(await readFile(f.subject.configPath, "utf8"), original);
    assert.deepEqual(await readdir(f.work), []);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("Git subdirectory snapshot coordinates long local budgets and existing file-auth ACP to terminal", async () => {
  const f = await setup("home");
  try {
    await writeFile(join(f.home, "logged-in"), "existing");
    f.config.agents.fixture.transport.env = ["USERPROFILE"];
    await f.updateConfig();
    const writeProbeConfig = () =>
      writeFile(
        f.subject.configPath,
        JSON.stringify({
          ...f.config,
          regulationStrategy: {
            probe: { timeoutMs: 75000, retry: { maxRetries: 0, delayMs: 0 } },
          },
        }),
      );
    await writeProbeConfig();
    await cp(objective, join(f.repository, "objectives", "pguide-setup"), { recursive: true });
    const revision = await f.commit();
    await writeFile(
      f.subjectFile,
      JSON.stringify({ ...f.subject, allowSanity: true, timeoutMs: 60000 }),
    );
    const uri = `git+${pathToFileURL(f.repository).href}#objectives/pguide-setup/pilot.yaml`;
    const probeEnv: NodeJS.ProcessEnv = { ...f.env };
    delete probeEnv.GIT_DIR;
    delete probeEnv.GIT_INDEX_FILE;
    const probeArgs = [
      "--pilot",
      uri,
      "--revision",
      revision,
      "--subject-file",
      f.subjectFile,
      "--config",
      f.subject.configPath,
      "--format",
      "json",
    ];
    const result = await run(bin("probe"), probeArgs, probeEnv);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 200, result.stdout);
    assert.equal(report.payload.current.levelId, "terminal", result.stdout);
    assert.deepEqual(report.payload.problems, []);
    assert.equal(report.payload.versions[uri], revision);
    assert.deepEqual(await readdir(f.scratch), []);
    assert.equal(await readFile(join(f.home, "logged-in"), "utf8"), "existing");
    f.config.agents.fixture.transport.env = ["USERPROFILE", "PGUIDE_SETUP_TEST_AUTH"];
    await f.updateConfig();
    await writeProbeConfig();
    passed(await f.direct("configuration"));
    const sanitized = await run(bin("probe"), probeArgs, probeEnv);
    assert.equal(sanitized.code, 0, sanitized.stdout + sanitized.stderr);
    const blocked = JSON.parse(sanitized.stdout);
    assert.equal(blocked.payload.current.levelId, "installed");
    assert.equal(blocked.payload.problems[0].ref.problemId, "environment-unavailable");
    assert.deepEqual(await readdir(f.scratch), []);
    const entries = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(entries.filter(({ method }) => method === "session/prompt").length, 1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("check wrapper reads the subject JSON from stdin", async () => {
  const f = await setup();
  try {
    const output = await new Promise<string>((done, reject) => {
      const child = spawn(process.execPath, [join(objective, "checks", "sanity", "run.cjs")], {
        cwd: root,
        env: f.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? done(stdout) : reject(new Error(`exit ${code}`)),
      );
      child.stdin.end(JSON.stringify(f.subject));
    });
    isProblem(JSON.parse(output), "sanity-consent-required");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("Windows installed command and ACP npm shims preserve spaces without shell interpolation", {
  skip: process.platform !== "win32",
}, async () => {
  const f = await setup();
  try {
    const cli = join(f.directory, "pguide installed.cmd");
    const acp = join(f.directory, "agent installed.cmd");
    await writeFile(cli, `@echo off\r\n"${process.execPath}" "${composition}" %*\r\n`);
    await writeFile(acp, `@echo off\r\n"${process.execPath}" "${f.agent}" %*\r\n`);
    f.config.agents.fixture.transport.command = acp;
    f.config.agents.fixture.transport.args = [];
    await f.updateConfig();
    passed(await f.direct("configuration", { ...f.subject, pguide: { command: cli } }));
    const envelope = await f.direct("installation", {
      ...f.subject,
      pguide: { command: cli, args: ["%unsafe%"] },
    });
    assert.equal(envelope.status, 502);
    assert.match(envelope.message, /unsupported-command/);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

const selfObjective = join(root, "objectives", "pguide-self-check");
const selfHelper = join(selfObjective, "self-check.mjs");
function selfSubject(f: Awaited<ReturnType<typeof setup>>) {
  const { allowSanity: _, ...subject } = f.subject;
  return subject;
}

test("self-check manifest loads local-only input, implicit terminal and every reference", async () => {
  const spec = await loadPilotSpec(join(selfObjective, "pilot.yaml"), fileResources);
  assert.deepEqual(
    spec.manifest.levels.map(({ id }) => id),
    ["initial", "installed", "configured"],
  );
  for (const level of spec.manifest.levels) {
    assert.equal(level.advancement.checks.length, 1);
    for (const check of level.advancement.checks) {
      const scope = `levels/${level.id}/checks/${check.id}`;
      assert.ok(spec.locales["zh-CN"]?.[scope]);
      for (const id of check.problems) {
        assert.ok(spec.locales["zh-CN"]?.[`${scope}/problems/${id}`]);
        assert.notEqual(id, "sanity-consent-required");
        assert.notEqual(id, "git-unavailable");
      }
    }
  }
  const validated = await run(bin("validate"), [
    "pilot",
    join(selfObjective, "pilot.yaml"),
    "--format",
    "json",
  ]);
  assert.equal(validated.code, 0, validated.stdout + validated.stderr);
  const f = await setup();
  try {
    const subject = selfSubject(f);
    passed(await f.direct("installation", subject, selfHelper));
    for (const extra of [
      { target: { type: "local" } },
      { target: remoteSubject.target },
      { allowSanity: true },
      { allowSanity: false },
    ])
      assert.equal((await f.direct("sanity", { ...subject, ...extra }, selfHelper)).status, 400);
    await assert.rejects(readFile(f.log), { code: "ENOENT" });
    const { check } = await import(
      pathToFileURL(join(selfObjective, "runtime", "setup-check.mjs")).href
    );
    assert.equal(
      (await check("sanity", { ...subject, timeoutMs: 30000 }, { selfCheck: true, pilot: true }))
        .status,
      400,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("self-check reuses installation/configuration failures without executing a prompt", async () => {
  const f = await setup();
  try {
    const subject = selfSubject(f);
    isProblem(
      await f.direct("installation", { ...subject, desiredVersion: "other" }, selfHelper),
      "version-mismatch",
    );
    isProblem(
      await f.direct("sanity", { ...subject, configPath: join(f.directory, "absent") }, selfHelper),
      "configuration-missing",
    );
    isProblem(
      await f.direct("sanity", { ...subject, agent: "missing" }, selfHelper),
      "agent-missing",
    );
    await writeFile(subject.configPath, "schemaVersion: 1");
    isProblem(await f.direct("configuration", subject, selfHelper), "configuration-invalid");
    await assert.rejects(readFile(f.log), { code: "ENOENT" });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("self-check defaults to exactly one direct repair, no nested regulate or Git, and preserves config", async () => {
  const f = await setup();
  try {
    const { timeoutMs: _, ...subject } = selfSubject(f);
    const original = await readFile(subject.configPath, "utf8");
    const forbidden = join(f.directory, "forbidden.cjs");
    await writeFile(
      forbidden,
      `if(process.argv.includes("--pguide-command-metadata"))console.log(JSON.stringify({protocol:"pguide-command-v1",command:"regulate",version:"fixture",description:"fixture"}));else process.exit(91);`,
    );
    const commands = f.config.commandDirectories[0] as string;
    await writeFile(
      join(commands, `pguide-regulate${process.platform === "win32" ? ".cmd" : ""}`),
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${forbidden}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${forbidden}" "$@"\n`,
      { mode: 0o755 },
    );
    const noGit = join(f.directory, "no-git");
    await mkdir(noGit);
    await writeFile(
      join(noGit, process.platform === "win32" ? "git.cmd" : "git"),
      process.platform === "win32" ? "@exit /b 92\r\n" : "#!/bin/sh\nexit 92\n",
      { mode: 0o755 },
    );
    f.env.PATH = `${noGit}${delimiter}${f.env.PATH}`;
    passed(await f.direct("sanity", subject, selfHelper));
    assert.equal(await readFile(subject.configPath, "utf8"), original);
    const messages = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const prompts = messages.filter(({ method }) => method === "session/prompt");
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].text, /Self-check task: /);
    assert.doesNotMatch(prompts[0].text, /Potential Guide regulation|Complete observation:/);
    assert.deepEqual(
      messages.map(({ method }) => method),
      ["initialize", "session/new", "initialize", "session/new", "session/prompt"],
    );
    for (const { pid } of messages) assert.throws(() => process.kill(pid, 0));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("self-check wrong, summary-only, denied, incomplete and oversized Agent runs cannot pass", async () => {
  for (const [mode, reason] of [
    ["wrong", "nonce-mismatch"],
    ["summary", "nonce-mismatch"],
    ["denied", "denied"],
    ["incomplete", "blocked"],
    ["overflow", "output-limit"],
  ]) {
    const f = await setup(mode);
    try {
      const result = await f.direct("sanity", selfSubject(f), selfHelper);
      isProblem(result, "sanity-failed");
      const parameters = result.payload?.problems[0]?.parameters as { reason: string } | undefined;
      assert.equal(parameters?.reason, reason);
      assert.doesNotMatch(JSON.stringify(result), /SECRET-MODEL-TEXT/);
      const messages = (await readFile(f.log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(messages.filter(({ method }) => method === "session/prompt").length, 1);
      for (const { pid } of messages) assert.throws(() => process.kill(pid, 0));
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  }
});

test("self-check bounded timeout cleans owned task/state and preserves unrelated scratch", async () => {
  const f = await setup("prompt-timeout");
  try {
    const subject = { ...selfSubject(f), timeoutMs: 7000 };
    const sentinel = join(f.scratch, "user-owned");
    await writeFile(sentinel, "preserve");
    await writeFile(f.subjectFile, JSON.stringify(subject));
    const started = Date.now();
    const result = await run(selfHelper, ["sanity", "--subject-file", f.subjectFile], f.env);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.status, 504, result.stdout + result.stderr);
    assert.ok(Date.now() - started < 15000);
    assert.equal(await readFile(sentinel, "utf8"), "preserve");
    assert.deepEqual(await readdir(f.scratch), ["user-owned"]);
    await assert.rejects(lstat(join(f.directory, "must-not-be-used")), { code: "ENOENT" });
    for (const message of (await readFile(f.log, "utf8")).trim().split("\n"))
      assert.throws(() => process.kill(JSON.parse(message).pid, 0));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("self-check preserves a shorter configured Agent execution timeout", async () => {
  const f = await setup("prompt-timeout");
  try {
    await writeFile(
      f.subject.configPath,
      JSON.stringify({ ...f.config, agentExecutionLimits: { timeoutMs: 500 } }),
    );
    const result = await f.direct("sanity", selfSubject(f), selfHelper);
    assert.equal(result.status, 504);
    assert.match(result.message, /direct Agent exceeded its deadline/);
    const messages = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(messages.filter(({ method }) => method === "session/prompt").length, 1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("self-check committed Git subdirectory snapshot is dependency-free and reaches terminal with one prompt", async () => {
  const f = await setup();
  try {
    const snapshot = join(f.repository, "objectives", "pguide-self-check");
    await cp(selfObjective, snapshot, { recursive: true });
    await git(f.repository, "add", ".");
    await git(f.repository, "commit", "-qm", "Self-check snapshot");
    const revision = await git(f.repository, "rev-parse", "HEAD");
    const uri = `git+${pathToFileURL(f.repository).href}#objectives/pguide-self-check/pilot.yaml`;
    await writeFile(f.subjectFile, JSON.stringify(selfSubject(f)));
    const result = await run(
      composition,
      [
        "probe",
        "--pilot",
        uri,
        "--revision",
        revision,
        "--subject-file",
        f.subjectFile,
        "--config",
        f.subject.configPath,
        "--format",
        "json",
      ],
      f.env,
    );
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 200);
    assert.equal(report.payload.current.levelId, "terminal");
    assert.equal(report.payload.versions[uri], revision);
    assert.deepEqual(report.payload.problems, []);
    assert.deepEqual(await readdir(f.scratch), []);
    const messages = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(messages.filter(({ method }) => method === "session/prompt").length, 1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
