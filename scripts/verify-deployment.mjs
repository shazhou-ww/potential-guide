import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { access, chmod, cp, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkPackageConsumers } from "./check-package-consumers.mjs";
import {
  assertLatestVersion,
  consumerManifest,
  consumerMode,
  verifyConsumerGraph,
} from "./deployment-consumer.mjs";
import { releasePackages } from "./release-packages.mjs";
import { createDeploymentWorkspace, execute } from "./verify-deployment-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const mode = consumerMode(process.argv.slice(2));
const workspace = await createDeploymentWorkspace();
const scratch = workspace.path;
const packs = join(scratch, "packs");
const consumer = join(scratch, "consumer");
const fixtureSource = join(root, "scripts", "fixtures", "deployment-acp");
const fixture = join(consumer, "fixture");
const objectiveUri = `git+${pathToFileURL(fixture).href}#guide/`;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const binExtension = process.platform === "win32" ? ".cmd" : "";
const packageDefinitions = releasePackages;
const installPublished = mode !== "packed";
const expectedVersions = new Map();
const consumerEntries = packageDefinitions
  .filter(({ bins }) => bins.length > 0)
  .map(({ name }) => name);

async function successful(command, args, options) {
  const result = await execute(command, args, { cwd: root, ...options });
  assert.equal(result.code, 0, `${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return result;
}

function executable(name) {
  return join(consumer, "node_modules", ".bin", `${name}${binExtension}`);
}

async function packAndInstall() {
  await mkdir(packs, { recursive: true });
  const tarballs = new Map();
  for (const definition of packageDefinitions) {
    const packageRoot = join(root, "packages", definition.directory);
    const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    assert.equal(packageManifest.name, definition.name);
    expectedVersions.set(definition.name, packageManifest.version);
    if (installPublished) {
      continue;
    }
    const packedResult = await successful(
      pnpm,
      ["--dir", packageRoot, "pack", "--pack-destination", packs, "--json"],
      { cwd: root },
    );
    const packed = JSON.parse(packedResult.stdout);
    assert.equal(packed.name, definition.name);
    assert.equal(packed.version, packageManifest.version);
    const paths = packed.files.map(({ path }) => path);
    for (const forbidden of definition.forbiddenFiles ?? []) {
      assert.ok(!paths.includes(forbidden), `${definition.name} contains retired ${forbidden}`);
    }
    for (const required of [
      "LICENSE",
      "README.md",
      "package.json",
      ...(definition.requiredExports === undefined ? [] : ["dist/index.js", "dist/index.d.ts"]),
    ]) {
      assert.ok(paths.includes(required), `${definition.name} is missing ${required}`);
    }
    assert.ok(
      paths.every(
        (path) =>
          !path.startsWith("src/") &&
          !path.startsWith("test/") &&
          !path.endsWith(".tsbuildinfo") &&
          !path.includes(".deployment-verification") &&
          !(
            (definition.forbiddenDependencies ?? []).includes("@potential-guide/cli-core") &&
            (path.startsWith("dist/bin/") || path.startsWith("dist/cli."))
          ),
      ),
      `${definition.name} includes development-only content`,
    );
    assert.deepEqual(Object.keys(packageManifest.bin ?? {}).sort(), [...definition.bins].sort());
    for (const dependency of definition.forbiddenDependencies ?? []) {
      assert.equal(
        packageManifest.dependencies?.[dependency],
        undefined,
        `${definition.name} must not depend on ${dependency}`,
      );
    }
    await access(packed.filename);
    tarballs.set(definition.name, resolve(packed.filename));
    console.log(`packed ${definition.name}: ${paths.length} files`);
  }

  if (!installPublished) {
    await checkPackageConsumers(
      root,
      scratch,
      packageDefinitions,
      tarballs,
      async (command, args, cwd, env = process.env, expectedCode = 0) => {
        const result = await execute(command, args, { cwd, env });
        assert.equal(
          result.code,
          expectedCode,
          `${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`,
        );
        return result.stdout;
      },
    );
  }
  await mkdir(consumer, { recursive: true });
  const manifest = consumerManifest(mode, expectedVersions, tarballs, consumerEntries);
  if (mode === "latest") {
    const latest = await successful(npm, ["view", "pguide@latest", "version", "--json"]);
    assertLatestVersion(JSON.parse(latest.stdout), expectedVersions.get("pguide"));
  }
  await writeFile(join(consumer, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await successful(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"],
    { cwd: consumer },
  );
  await verifyConsumerGraph(consumer, expectedVersions, consumerEntries);
  for (const definition of packageDefinitions) {
    const installedManifest = JSON.parse(
      await readFile(join(consumer, "node_modules", ...definition.name.split("/"), "package.json")),
    );
    assert.equal(installedManifest.name, definition.name);
    assert.equal(installedManifest.version, expectedVersions.get(definition.name));
    for (const forbidden of definition.forbiddenFiles ?? []) {
      await assert.rejects(
        access(join(consumer, "node_modules", ...definition.name.split("/"), forbidden)),
        { code: "ENOENT" },
      );
    }
    for (const dependency of Object.values(installedManifest.dependencies ?? {})) {
      assert.doesNotMatch(dependency, /^workspace:/);
    }
    for (const dependency of Object.keys(installedManifest.dependencies ?? {})) {
      if (packageDefinitions.some(({ name }) => name === dependency)) {
        await access(join(consumer, "node_modules", ...dependency.split("/"), "package.json"));
      }
    }
    for (const bin of definition.bins) await access(executable(bin));
  }
  const moduleSource = [
    'import assert from "node:assert/strict";',
    ...packageDefinitions
      .filter(({ requiredExports }) => requiredExports !== undefined)
      .flatMap(({ name, requiredExports }, index) => [
        `import * as library${index} from ${JSON.stringify(name)};`,
        ...requiredExports.map(
          (symbol) =>
            `assert.ok(Object.hasOwn(library${index}, ${JSON.stringify(symbol)}), ${JSON.stringify(`${name} must export ${symbol}`)});`,
        ),
      ]),
    'import { Effect, Exit, startEffect } from "@potential-guide/effects";',
    'assert.equal(await Effect.runPromise(Effect.succeed("ready")), "ready");',
    "const running = startEffect(Effect.never);",
    "running.cancel();",
    "assert.ok(Exit.hasInterrupts(await running.exit()));",
  ].join("\n");
  const smoke = join(consumer, "public-libraries.mjs");
  await writeFile(smoke, moduleSource);
  await successful(process.execPath, [smoke], { cwd: consumer });
  console.log(
    `${mode} selected-command consumer: transitive versions and library imports verified`,
  );
}

async function verifyCliContract() {
  const extensionDirectory = join(consumer, "extensions");
  await mkdir(extensionDirectory);
  const echoScript = join(extensionDirectory, "echo.mjs");
  await writeFile(
    echoScript,
    'if(process.argv[2]==="--pguide-command-metadata")console.log(JSON.stringify({protocol:"pguide-command-v1",command:"echo",description:"fixture",version:"1"}));else console.log(JSON.stringify(process.argv.slice(2)));\n',
  );
  const echoBin = join(extensionDirectory, `pguide-echo${binExtension}`);
  await writeFile(
    echoBin,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${echoScript}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${echoScript}" "$@"\n`,
  );
  if (process.platform !== "win32") await chmod(echoBin, 0o755);
  const rogue = join(consumer, `pguide-rogue${binExtension}`);
  await writeFile(
    rogue,
    process.platform === "win32" ? "@echo off\r\necho unsafe\r\n" : "#!/bin/sh\necho unsafe\n",
  );
  if (process.platform !== "win32") await chmod(rogue, 0o755);
  const hostPaths = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(
      (directory) =>
        directory &&
        !packageDefinitions
          .flatMap(({ bins }) => bins)
          .some((name) => existsSync(join(directory, `${name}${binExtension}`))),
    );
  const path = [extensionDirectory, join(consumer, "node_modules", ".bin"), ...hostPaths].join(
    delimiter,
  );
  const home = join(consumer, "home");
  const appData = join(home, "AppData", "Roaming");
  await mkdir(appData, { recursive: true });
  const env = {
    ...process.env,
    PATH: path,
    HOME: home,
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"),
  };

  const allBins = packageDefinitions.flatMap(({ bins }) => bins);
  for (const bin of allBins) {
    if (bin === "objective-contract-migrate") {
      await access(executable(bin));
      continue;
    }
    if (bin !== "pguide") {
      const metadata = await successful(executable(bin), ["--pguide-command-metadata"], {
        cwd: consumer,
        env,
      });
      assert.equal(JSON.parse(metadata.stdout).protocol, "pguide-command-v1");
    }
    const help = await successful(executable(bin), ["--help", "--format", "json"], {
      cwd: consumer,
      env,
    });
    assert.equal(JSON.parse(help.stdout).schemaVersion, 1);
  }

  const discovery = await successful(executable("pguide"), ["--help", "--format", "json"], {
    cwd: consumer,
    env,
  });
  const discovered = JSON.parse(discovery.stdout).commands.map(({ command }) => command);
  assert.ok(discovered.includes("echo"));
  assert.ok(!discovered.includes("rogue"), "the cwd must not be a discovery source");

  const boundary = await successful(
    executable("pguide"),
    ["echo", "literal", "--", "--format", "not-global"],
    { cwd: consumer, env },
  );
  assert.deepEqual(JSON.parse(boundary.stdout).slice(-2), ["--format", "not-global"]);

  const before = await successful(
    executable("pguide"),
    ["--format", "json", "config", "path", "--cwd", consumer],
    { cwd: consumer, env },
  );
  const after = await successful(
    executable("pguide"),
    ["config", "path", "--cwd", consumer, "--format", "json"],
    { cwd: consumer, env },
  );
  assert.deepEqual(JSON.parse(before.stdout), JSON.parse(after.stdout));

  await cp(fixtureSource, fixture, { recursive: true });
  if (process.platform !== "win32") {
    await chmod(join(fixture, "guide", "checks", "ready", "run.js"), 0o755);
  }
  const subject = join(fixture, "subject.json");
  await writeFile(subject, JSON.stringify({ marker: join(fixture, "ready") }));
  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "Deployment Fixture"],
    ["config", "user.email", "fixture@example.invalid"],
    ["remote", "add", "origin", pathToFileURL(fixture).href],
    ["add", "."],
    ["commit", "-qm", "Create committed deployment fixture"],
  ]) {
    await successful("git", ["-C", fixture, ...args], { cwd: consumer });
  }
  const direct = await successful(
    executable("pguide-probe"),
    ["--pilot", objectiveUri, "--subject-file", subject, "--format", "json"],
    { cwd: consumer, env },
  );
  const dispatched = await successful(
    executable("pguide"),
    ["probe", "--pilot", objectiveUri, "--subject-file", subject, "--format", "json"],
    { cwd: consumer, env },
  );
  const directObservation = JSON.parse(direct.stdout);
  const dispatchedObservation = JSON.parse(dispatched.stdout);
  assert.equal(directObservation.status, 200);
  assert.equal(dispatchedObservation.status, 200);
  assert.equal(directObservation.payload.current.objectiveId, objectiveUri);
  assert.equal(directObservation.payload.current.levelId, "initial");
  assert.equal(directObservation.payload.problems[0].ref.problemId, "not-ready");
  assert.deepEqual(dispatchedObservation.payload.current, directObservation.payload.current);
  const stdin = await successful(
    executable("pguide-probe"),
    ["--pilot", objectiveUri, "--subject-file", "-", "--format", "json"],
    { cwd: consumer, env, input: await readFile(subject, "utf8") },
  );
  assert.equal(JSON.parse(stdin.stdout).status, 200);
  assert.equal(JSON.parse(stdin.stdout).payload.problems[0].ref.problemId, "not-ready");

  const badOption = await execute(executable("pguide"), ["probe", "--unknown", "x"], {
    cwd: consumer,
    env,
  });
  assert.equal(badOption.code, 2);
  console.log(`CLI contract verified on ${process.platform}/${process.arch}`);
  return env;
}

async function writeConfig(path, state) {
  const agent = join(fixture, "agent.mjs");
  await writeConfiguration(
    path,
    `${JSON.stringify(
      {
        "agents.defaultAgent": "fixture",
        "cli-core.stateDirectory": state,
        "regulate.retentionDays": 1,
        "regulate.agentTimeoutMs": 30_000,
        agents: {
          fixture: {
            type: "acp",
            connection: { protocolVersion: "1" },
            transport: {
              type: "stdio",
              command: process.execPath,
              args: [agent],
              env: [
                "PGUIDE_ACTION_MARKER",
                "PGUIDE_FIXTURE_MODE",
                "PGUIDE_FIXTURE_SECRET",
                "PGUIDE_PROMPT_MARKER",
                "PGUIDE_RESUME_MARKER",
              ],
            },
            requirements: { sessionResume: true },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function writeConfiguration(path, source) {
  const config = JSON.parse(source);
  if (Object.hasOwn(config, "agents")) {
    const directory = join(consumer, ".pguide");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "agents.yaml"),
      JSON.stringify({
        $schema: "https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json",
        agents: config.agents,
      }),
      { mode: 0o600 },
    );
    delete config.agents;
  }
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
}

async function invokeRegulate(config, subject, report, env, extra = []) {
  return execute(
    executable("pguide"),
    [
      "regulate",
      "--cwd",
      dirname(dirname(config)),
      "--pilot",
      objectiveUri,
      "--subject-file",
      subject,
      "--target",
      "terminal",
      "--report",
      report,
      "--format",
      "json",
      ...extra,
    ],
    { cwd: consumer, env },
  );
}

async function verifyRegulation(baseEnv) {
  const state = join(fixture, "state");
  const marker = join(fixture, "ready");
  const resumeMarker = join(fixture, "resumed");
  const config = join(consumer, ".pguide", "config.jsonc");
  const subject = join(fixture, "subject.json");
  const report = join(fixture, "report.json");
  const secret = 'deployment-"secret"-雪';
  await writeConfig(config, state);
  const env = {
    ...baseEnv,
    PGUIDE_ACTION_MARKER: marker,
    PGUIDE_FIXTURE_MODE: "repair",
    PGUIDE_FIXTURE_SECRET: secret,
    PGUIDE_RESUME_MARKER: resumeMarker,
  };
  const regulated = await invokeRegulate(config, subject, report, env);
  assert.equal(regulated.code, 0, `${regulated.stderr}\n${regulated.stdout}`);
  const result = JSON.parse(regulated.stdout);
  assert.equal(result.status, "target-reached");
  const reportSource = await readFile(report, "utf8");
  assert.doesNotMatch(`${regulated.stdout}${regulated.stderr}${reportSource}`, new RegExp(secret));

  const continuationArgs = ["continue", "--cwd", consumer, result.regulationId, "--format", "json"];
  const stillSatisfied = await successful(executable("pguide"), continuationArgs, {
    cwd: consumer,
    env,
  });
  assert.equal(JSON.parse(stillSatisfied.stdout).status, "target-reached");

  await unlink(marker);
  const repaired = await successful(executable("pguide"), continuationArgs, {
    cwd: consumer,
    env,
  });
  assert.equal(JSON.parse(repaired.stdout).status, "target-reached");
  assert.equal(await readFile(resumeMarker, "utf8"), "resumed");

  const regulationRoot = join(state, "regulations", result.regulationId);
  const lineageSource = await readFile(join(regulationRoot, "regulation.json"), "utf8");
  const lineage = JSON.parse(lineageSource);
  assert.equal(lineage.attempts.length, 3);
  assert.equal(lineage.schemaVersion, 4);
  assert.equal(lineage.attempts[1].actions.length, 0);
  assert.ok(Date.parse(lineage.expiresAt) > Date.now());
  const transcript = await readFile(join(regulationRoot, "transcript.jsonl"), "utf8");
  assert.match(transcript, /session\/update/);
  assert.doesNotMatch(`${lineageSource}${transcript}`, new RegExp(secret));
  assert.match(`${lineageSource}${transcript}`, /\[REDACTED\]/);

  const expired = join(state, "regulations", "00000000-0000-4000-8000-000000000000");
  await mkdir(expired, { recursive: true });
  await writeFile(join(expired, "regulation.json"), '{"expiresAt":"2000-01-01T00:00:00.000Z"}\n');
  await successful(executable("pguide"), continuationArgs, { cwd: consumer, env });
  await assert.rejects(access(expired));

  const blockedMarker = join(fixture, "blocked-ready");
  const blockedSubject = join(fixture, "blocked-subject.json");
  await writeFile(blockedSubject, JSON.stringify({ marker: blockedMarker }));
  const blocked = await invokeRegulate(
    config,
    blockedSubject,
    join(fixture, "blocked-report.json"),
    { ...baseEnv, PGUIDE_FIXTURE_MODE: "blocked" },
  );
  assert.equal(blocked.code, 2);
  assert.equal(JSON.parse(blocked.stdout).status, "regulation-error");

  const legacyLimit = await invokeRegulate(
    config,
    blockedSubject,
    join(fixture, "stalled-report.json"),
    { ...baseEnv, PGUIDE_FIXTURE_MODE: "noop" },
    ["--max-stalled-iterations", "1"],
  );
  assert.equal(legacyLimit.code, 2);
  assert.match(`${legacyLimit.stdout}${legacyLimit.stderr}`, /max-stalled-iterations/);

  const timedOut = await invokeRegulate(
    config,
    blockedSubject,
    join(fixture, "timeout-report.json"),
    { ...baseEnv, PGUIDE_FIXTURE_MODE: "hang" },
    ["--agent-timeout-ms", "200"],
  );
  assert.equal(timedOut.code, 5);
  assert.equal(JSON.parse(timedOut.stdout).status, "exhausted");

  if (process.platform !== "win32") {
    const signalMarker = join(fixture, "signal-prompted");
    let child;
    let finished = false;
    let force;
    const signalled = execute(
      executable("pguide"),
      [
        "regulate",
        "--cwd",
        consumer,
        "--pilot",
        objectiveUri,
        "--subject-file",
        blockedSubject,
        "--target",
        "terminal",
        "--format",
        "json",
      ],
      {
        cwd: consumer,
        env: {
          ...baseEnv,
          PGUIDE_FIXTURE_MODE: "hang",
          PGUIDE_PROMPT_MARKER: signalMarker,
        },
        onSpawn: (spawned) => {
          child = spawned;
        },
      },
    ).then(
      (value) => {
        finished = true;
        return { ok: true, value };
      },
      (error) => {
        finished = true;
        return { ok: false, error };
      },
    );
    const stop = () => {
      if (!finished && child?.pid) {
        child.kill("SIGTERM");
        force ??= setTimeout(() => {
          if (!finished) child.kill("SIGKILL");
        }, 2_000);
      }
    };
    try {
      const deadline = Date.now() + 30_000;
      for (;;) {
        try {
          await access(signalMarker);
          break;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        if (finished) {
          const result = await signalled;
          if (!result.ok) throw result.error;
          throw new Error(`CLI exited before Agent readiness: ${JSON.stringify(result.value)}`);
        }
        assert.ok(Date.now() < deadline, "Agent prompt was not ready within 30 seconds.");
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      assert.ok(child?.pid);
      stop();
      const cancelled = await signalled;
      if (!cancelled.ok) throw cancelled.error;
      assert.equal(cancelled.value.code, 5);
      assert.equal(JSON.parse(cancelled.value.stdout).status, "cancelled");
    } finally {
      stop();
      await signalled;
      clearTimeout(force);
    }
  }
  console.log("ACP regulation, persistence, resume, retention, redaction and reports verified");
}

async function verifySupervisor(baseEnv) {
  const planner = join(fixture, "planner.mjs");
  const log = join(fixture, "planner-prompts.jsonl");
  await writeFile(
    planner,
    `
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
for await (const line of createInterface({input:process.stdin})) {
  const message=JSON.parse(line);
  if (!message.id) continue;
  let result={};
  if (message.method==="initialize") result={protocolVersion:1};
  if (message.method==="session/new") result={sessionId:"planner"};
  if (message.method==="session/prompt") {
    appendFileSync(${JSON.stringify(log)}, JSON.stringify(message.params)+"\\n");
    console.log(JSON.stringify({jsonrpc:"2.0",method:"session/update",params:{
      sessionId:"planner",update:{sessionUpdate:"agent_message_chunk",
        content:{type:"text",text:JSON.stringify({directives:[]})}}}}));
    result={stopReason:"end_turn"};
  }
  console.log(JSON.stringify({jsonrpc:"2.0",id:message.id,result}));
}
`,
  );
  const config = join(consumer, ".pguide", "config.jsonc");
  await writeConfiguration(
    config,
    JSON.stringify({
      agents: {
        planner: {
          type: "acp",
          connection: { protocolVersion: "1" },
          transport: { type: "stdio", command: process.execPath, args: [planner] },
        },
      },
    }),
  );
  const portfolio = join(fixture, "portfolio.json");
  await writeFile(
    portfolio,
    JSON.stringify({
      schemaVersion: 4,
      goals: [
        {
          id: "maintained",
          objective: objectiveUri,
          subject: { marker: join(fixture, "ready") },
          targetLevel: "terminal",
          priority: 1,
          observationIntervalMs: 1000,
        },
      ],
      resources: [],
    }),
  );
  const args = [
    "supervise",
    "--portfolio-file",
    portfolio,
    "--planner",
    "planner",
    "--cwd",
    consumer,
    "--format",
    "json",
  ];
  const planned = await successful(executable("pguide"), args, { cwd: consumer, env: baseEnv });
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.schemaVersion, 4);
  assert.equal(plan.status, "planned");
  assert.equal(plan.observations.maintained.payload.current.levelId, "ready");
  assert.deepEqual(plan.queue.demands, []);
  assert.deepEqual(plan.events, []);
  assert.match(await readFile(log, "utf8"), /maintained/);
  const execution = await successful(
    executable("pguide"),
    [...args, "--execute", "--duration-ms", "1500"],
    {
      cwd: consumer,
      env: baseEnv,
    },
  );
  const executed = JSON.parse(execution.stdout);
  assert.equal(executed.schemaVersion, 4);
  assert.equal(executed.status, "executed");
  assert.equal(executed.observations.maintained.payload.current.levelId, "ready");
  assert.deepEqual(executed.queue.demands, []);
  assert.deepEqual(executed.events, []);
  console.log("installed ACP planner and bounded supervisor lifecycle verified");
}

async function verifySetupObjective(baseEnv) {
  const setupRoot = join(consumer, "setup-objective");
  const setup = join(setupRoot, "packages", "objective-pguide-setup");
  await mkdir(setupRoot, { recursive: true });
  const pilotCopy = {
    recursive: true,
    filter: (source) => !["node_modules", ".turbo", "test"].includes(basename(source)),
  };
  await cp(join(root, "packages", "objective-pguide-setup"), setup, pilotCopy);
  await cp(
    join(root, "packages", "objective-pguide-self-check"),
    join(setupRoot, "packages", "objective-pguide-self-check"),
    pilotCopy,
  );
  await successful("git", ["init", "-q"], { cwd: setupRoot });
  await successful("git", ["config", "user.name", "Deployment Fixture"], { cwd: setupRoot });
  await successful("git", ["config", "user.email", "fixture@example.invalid"], { cwd: setupRoot });
  await successful("git", ["remote", "add", "origin", pathToFileURL(setupRoot).href], {
    cwd: setupRoot,
  });
  await successful("git", ["add", "."], { cwd: setupRoot });
  await successful("git", ["commit", "-qm", "Committed setup Objective"], { cwd: setupRoot });
  const revision = (
    await successful("git", ["rev-parse", "HEAD"], { cwd: setupRoot })
  ).stdout.trim();
  const setupUri = `git+${pathToFileURL(setupRoot).href}#packages/objective-pguide-setup/`;
  const agent = join(consumer, "setup-agent.mjs");
  await writeFile(
    agent,
    `
import { createInterface } from "node:readline";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
let cwd;
for await (const line of createInterface({input:process.stdin})) {
  const message=JSON.parse(line);if (!message.id) continue;
  let result={};
  if (message.method==="initialize") result={protocolVersion:1};
  if (message.method==="session/new") {cwd=message.params.cwd;result={sessionId:"setup-fixture"};}
  if (message.method==="session/prompt") {
    const text=message.params.prompt[0].text;
    const direct=text.includes("Self-check task: ");
    const subjectLine=text.split("\\n").find(line=>line.startsWith(direct?"Self-check task: ":"Subject: "));
    const subject=JSON.parse(subjectLine.slice(direct?"Self-check task: ".length:"Subject: ".length));
    if(direct)subject.marker=join(cwd,subject.marker);
    await appendFile(${JSON.stringify(join(consumer, "setup-prompts.jsonl"))},JSON.stringify({direct})+"\\n");
    await writeFile(subject.marker,subject.expected);
    result={stopReason:"end_turn",summary:"Exact nonce written"};
  }
  console.log(JSON.stringify({jsonrpc:"2.0",id:message.id,result}));
}
`,
  );
  const configPath = join(consumer, ".pguide", "config.jsonc");
  await writeConfiguration(
    configPath,
    JSON.stringify({
      "pguide.commandDirectories": [join(consumer, "node_modules", ".bin")],
      "agents.defaultAgent": "setup",
      // Opt in both budgets for the real installed Git Pilot; defaults remain unchanged.
      "pilot.probe": { timeoutMs: 75000, retry: { maxRetries: 0, delayMs: 0 } },
      agents: {
        setup: {
          type: "acp",
          connection: { protocolVersion: "1" },
          transport: { type: "stdio", command: process.execPath, args: [agent] },
        },
      },
    }),
  );
  // Nested Git snapshots need path headroom on Windows even with core.longpaths.
  const scratchDirectory = join(scratch, "s");
  const subject = join(consumer, "setup-subject.json");
  await writeFile(
    subject,
    JSON.stringify({
      workingDirectory: consumer,
      scratchDirectory,
      pguide: {
        command: process.execPath,
        args: [join(consumer, "node_modules", "pguide", "dist", "bin.js")],
      },
      desiredVersion: expectedVersions.get("pguide"),
      agent: "setup",
      userHome: consumer,
      allowSanity: true,
      timeoutMs: 60000,
    }),
  );
  const result = await successful(
    executable("pguide"),
    [
      "probe",
      "--pilot",
      setupUri,
      "--revision",
      revision,
      "--cwd",
      consumer,
      "--subject-file",
      subject,
      "--format",
      "json",
    ],
    // Only the runtime cache cwd is shorter; all installed/subject/config paths remain absolute.
    { cwd: process.platform === "win32" ? root : consumer, env: baseEnv },
  );
  const observation = JSON.parse(result.stdout);
  assert.equal(observation.status, 200, result.stdout);
  assert.equal(observation.payload.current.objectiveId, setupUri);
  assert.equal(observation.payload.current.levelId, "verified", result.stdout);
  const setupTree = await successful(
    "git",
    ["rev-parse", `${revision}:packages/objective-pguide-setup`],
    { cwd: setupRoot },
  );
  assert.equal(observation.payload.versions[setupUri], setupTree.stdout.trim());
  assert.equal(observation.payload.sources[setupUri].commit, revision);
  assert.deepEqual(observation.payload.problems, []);
  console.log("installed pguide loads committed setup subdirectory and verifies real nonce repair");
  const selfSubject = JSON.parse(await readFile(subject, "utf8"));
  delete selfSubject.allowSanity;
  selfSubject.timeoutMs = 24000;
  await writeFile(subject, JSON.stringify(selfSubject));
  const selfUri = setupUri.replace("/objective-pguide-setup/", "/objective-pguide-self-check/");
  const selfResult = await successful(
    executable("pguide"),
    [
      "probe",
      "--pilot",
      selfUri,
      "--revision",
      revision,
      "--cwd",
      consumer,
      "--subject-file",
      subject,
      "--format",
      "json",
    ],
    { cwd: consumer, env: baseEnv },
  );
  const selfObservation = JSON.parse(selfResult.stdout);
  assert.equal(selfObservation.status, 200, selfResult.stdout);
  assert.equal(selfObservation.payload.current.levelId, "verified", selfResult.stdout);
  const selfTree = await successful(
    "git",
    ["rev-parse", `${revision}:packages/objective-pguide-self-check`],
    { cwd: setupRoot },
  );
  assert.equal(selfObservation.payload.versions[selfUri], selfTree.stdout.trim());
  assert.equal(selfObservation.payload.sources[selfUri].commit, revision);
  assert.deepEqual(selfObservation.payload.problems, []);
  assert.deepEqual(
    (await readFile(join(consumer, "setup-prompts.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
    [{ direct: false }, { direct: true }],
  );
  console.log("installed pguide self-check snapshot verifies exactly one direct Agent repair");
}

async function verifyRegulationPermissions(baseEnv) {
  const marker = join(consumer, "authorized-marker.txt");
  const subject = join(consumer, "permission-subject.json");
  const config = join(consumer, ".pguide", "config.jsonc");
  const report = join(consumer, "permission-report.json");
  const stateDirectory = join(consumer, "permission-state");
  const policy = {
    ceiling: [{ id: "marker-edit", operation: "edit", resources: [marker] }],
    grants: [],
  };
  const configuration = {
    "agents.defaultAgent": "permission-fixture",
    "cli-core.stateDirectory": stateDirectory,
    "pguide.commandDirectories": [join(consumer, "node_modules", ".bin")],
    "regulate.permissions": policy,
    "regulate.quota": { timeoutMs: 30000, maxAgentRuns: 2, maxStallRuns: 2 },
    agents: {
      "permission-fixture": {
        type: "acp",
        connection: { protocolVersion: "1" },
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [join(fixture, "permission-agent.mjs")],
        },
      },
    },
  };
  await writeFile(subject, JSON.stringify({ marker }));
  await writeConfiguration(config, JSON.stringify(configuration));
  const denied = await invokeRegulate(config, subject, report, baseEnv);
  assert.equal(denied.code, 3, denied.stdout + denied.stderr);
  const deniedResult = JSON.parse(denied.stdout);
  assert.equal(deniedResult.status, "authorization-required");
  assert.equal(deniedResult.outcome.authorizationRequests[0].operation, "edit");
  assert.deepEqual(deniedResult.outcome.authorizationRequests[0].resources, [marker]);
  await assert.rejects(access(marker), { code: "ENOENT" });

  configuration["regulate.permissions"].grants = ["marker-edit"];
  await writeConfiguration(config, JSON.stringify(configuration));
  const args = ["continue", deniedResult.regulationId, "--cwd", consumer, "--format", "json"];
  const allowed = await successful(executable("pguide"), args, { cwd: consumer, env: baseEnv });
  assert.equal(JSON.parse(allowed.stdout).status, "target-reached");
  assert.equal(await readFile(marker, "utf8"), "permission-verified");

  await unlink(marker);
  configuration["regulate.permissions"] = { ceiling: [], grants: [] };
  await writeConfiguration(config, JSON.stringify(configuration));
  const revoked = await execute(executable("pguide"), args, { cwd: consumer, env: baseEnv });
  assert.equal(revoked.code, 3, revoked.stdout + revoked.stderr);
  assert.equal(JSON.parse(revoked.stdout).status, "authorization-required");
  await assert.rejects(access(marker), { code: "ENOENT" });
  console.log(
    "installed permissions deny, grant-on-continue, and current-ceiling revocation verified",
  );
}

const failures = [];
try {
  await packAndInstall();
  const env = await verifyCliContract();
  await verifyRegulation(env);
  await verifySupervisor(env);
  await verifySetupObjective(env);
  await verifyRegulationPermissions(env);
} catch (error) {
  failures.push(error);
}
try {
  await workspace.cleanup();
} catch (error) {
  failures.push(error);
}
if (failures.length === 1) throw failures[0];
if (failures.length > 1) {
  throw new AggregateError(failures, "Deployment verification and workspace cleanup failed.");
}
console.log("deployment verification passed");
