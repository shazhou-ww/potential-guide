import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { fileResources, loadPilotSpec } from "@potential-guide/objective-pilot";
import { bin, fixture, root, run } from "./fixtures.js";

const objective = join(root, "objectives", "pguide-setup");
const helper = join(objective, "setup-check.mjs");
const composition = join(root, "packages", "pguide", "dist", "bin.js");

interface CheckEnvelope {
  status: number;
  payload: null | { ok: boolean; problems: { id: string; parameters: unknown }[] };
  message: string;
}

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
import {appendFile,readFile,writeFile} from "node:fs/promises";
const mode=${JSON.stringify(mode)}, log=${JSON.stringify(log)};
for await (const line of createInterface({input:process.stdin})) {
  const m=JSON.parse(line); if(m.id===undefined)continue;
  await appendFile(log,JSON.stringify({method:m.method,cwd:m.params.cwd,pid:process.pid})+"\\n");
  if(mode==="malformed"){console.log("not JSON");continue;}
  if(mode==="timeout"){setInterval(()=>{},1000);continue;}
  let result={};
  if(m.method==="initialize") {
    if(mode==="home" && await readFile(process.env.USERPROFILE+"/logged-in","utf8")!=="existing")throw Error("No login");
    result={protocolVersion:"1",agentCapabilities:{loadSession:true}};
  }
  if(m.method==="session/new")result={sessionId:"real-fixture-session"};
  if(m.method==="session/prompt") {
    if(mode==="prompt-timeout"){setInterval(()=>{},1000);continue;}
    const text=m.params.prompt[0].text;
    const subject=JSON.parse(text.split("\\nSubject: ")[1].split("\\nComplete observation: ")[0]);
    if(mode==="fix" || mode==="home")await writeFile(subject.marker,subject.expected);
    if(mode==="wrong")await writeFile(subject.marker,"a different successful-looking marker");
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
    desiredVersion: "0.3.0-rc.0",
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
  assert.deepEqual(envelope.payload, { ok: false, problems: [{ id, parameters: {} }] });
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
      `console.log(JSON.stringify(process.argv.includes("--version")?{schemaVersion:1,name:"pguide",version:"0.3.0-rc.0"}:{commands:[],conflicts:{}}));`,
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
    for (const { pid } of messages) assert.throws(() => process.kill(pid, 0));
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
      const envelope = await f.direct("sanity", { ...f.subject, allowSanity: true });
      if (mode === "fix") passed(envelope);
      else isProblem(envelope, "sanity-failed");
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
    const envelope = await f.direct("sanity", {
      ...f.subject,
      allowSanity: true,
      timeoutMs: 10000,
    });
    assert.equal(envelope.status, 504, JSON.stringify(envelope));
    const entries = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(entries.filter(({ method }) => method === "session/prompt").length, 1);
    for (const { pid } of entries) assert.throws(() => process.kill(pid, 0));
    assert.deepEqual(await readdir(f.work), []);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("Git subdirectory snapshot runs dependency-free checks and existing file-auth ACP to terminal", async () => {
  const f = await setup("home");
  try {
    await writeFile(join(f.home, "logged-in"), "existing");
    f.config.agents.fixture.transport.env = ["USERPROFILE"];
    await f.updateConfig();
    await cp(objective, join(f.repository, "objectives", "pguide-setup"), { recursive: true });
    const revision = await f.commit();
    await writeFile(f.subjectFile, JSON.stringify({ ...f.subject, allowSanity: true }));
    const uri = `git+${pathToFileURL(f.repository).href}#objectives/pguide-setup/pilot.yaml`;
    const probeEnv: NodeJS.ProcessEnv = { ...f.env };
    delete probeEnv.GIT_DIR;
    delete probeEnv.GIT_INDEX_FILE;
    const result = await run(
      bin("probe"),
      ["--pilot", uri, "--revision", revision, "--subject-file", f.subjectFile, "--format", "json"],
      probeEnv,
    );
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
    passed(await f.direct("configuration"));
    const sanitized = await run(
      bin("probe"),
      ["--pilot", uri, "--revision", revision, "--subject-file", f.subjectFile, "--format", "json"],
      probeEnv,
    );
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
