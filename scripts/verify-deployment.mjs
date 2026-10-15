import assert from "node:assert/strict";
import { access, chmod, cp, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeploymentWorkspace, execute } from "./verify-deployment-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const workspace = await createDeploymentWorkspace();
const scratch = workspace.path;
const packs = join(scratch, "packs");
const consumer = join(scratch, "consumer");
const fixtureSource = join(root, "scripts", "fixtures", "deployment-acp");
const fixture = join(consumer, "fixture");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const binExtension = process.platform === "win32" ? ".cmd" : "";
const packageDefinitions = [
  {
    directory: "pguide-cli-core",
    name: "@potential-guide/cli-core",
    exports: true,
    bins: [],
  },
  {
    directory: "objective-guide",
    name: "@potential-guide/objective-guide",
    exports: true,
    bins: [],
    forbiddenDependencies: ["@potential-guide/cli-core"],
  },
  {
    directory: "objective-regulator",
    name: "@potential-guide/objective-regulator",
    exports: true,
    bins: [],
    forbiddenDependencies: ["@potential-guide/cli-core"],
  },
  {
    directory: "objective-portfolio-supervisor",
    name: "@potential-guide/objective-portfolio-supervisor",
    exports: true,
    bins: [],
    forbiddenDependencies: ["@potential-guide/cli-core"],
  },
  {
    directory: "pguide-config",
    name: "@potential-guide/config",
    bins: ["pguide-config"],
  },
  {
    directory: "pguide",
    name: "pguide",
    bins: [
      "pguide",
      "pguide-continue",
      "pguide-probe",
      "pguide-regulate",
      "pguide-scaffold",
      "pguide-supervise",
      "pguide-validate",
    ],
  },
];

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
  const tarballs = [];
  for (const definition of packageDefinitions) {
    const packageRoot = join(root, "packages", definition.directory);
    const packedResult = await successful(
      pnpm,
      ["--dir", packageRoot, "pack", "--pack-destination", packs, "--json"],
      { cwd: root },
    );
    const packed = JSON.parse(packedResult.stdout);
    assert.equal(packed.name, definition.name);
    const paths = packed.files.map(({ path }) => path);
    for (const required of [
      "LICENSE",
      "README.md",
      "package.json",
      ...(definition.exports ? ["dist/index.js", "dist/index.d.ts"] : []),
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
    const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(packageManifest.bin ?? {}).sort(), [...definition.bins].sort());
    for (const dependency of definition.forbiddenDependencies ?? []) {
      assert.equal(
        packageManifest.dependencies?.[dependency],
        undefined,
        `${definition.name} must not depend on ${dependency}`,
      );
    }
    await access(packed.filename);
    tarballs.push(resolve(packed.filename));
    console.log(`packed ${definition.name}: ${paths.length} files`);
  }

  await mkdir(consumer, { recursive: true });
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "pguide-deployment-consumer", private: true }, null, 2)}\n`,
  );
  await successful(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", ...tarballs],
    { cwd: consumer },
  );
  for (const definition of packageDefinitions) {
    const installedManifest = JSON.parse(
      await readFile(join(consumer, "node_modules", ...definition.name.split("/"), "package.json")),
    );
    assert.equal(installedManifest.name, definition.name);
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
}

async function verifyCliContract() {
  const allBins = packageDefinitions.flatMap(({ bins }) => bins);
  for (const bin of allBins) {
    if (bin !== "pguide") {
      const metadata = await successful(executable(bin), ["--pguide-command-metadata"], {
        cwd: consumer,
      });
      assert.equal(JSON.parse(metadata.stdout).protocol, "pguide-command-v1");
    }
    const help = await successful(executable(bin), ["--help", "--format", "json"], {
      cwd: consumer,
    });
    assert.equal(JSON.parse(help.stdout).schemaVersion, 1);
  }

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
  const path = `${extensionDirectory}${delimiter}${join(consumer, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`;
  const env = { ...process.env, PATH: path };

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
  const guide = join(fixture, "guide", "objective-guide.yaml");
  if (process.platform !== "win32") {
    await chmod(join(fixture, "guide", "checks", "ready", "run.js"), 0o755);
  }
  const subject = join(fixture, "subject.json");
  await writeFile(subject, JSON.stringify({ marker: join(fixture, "ready") }));
  const direct = await successful(
    executable("pguide-probe"),
    ["--guide", guide, "--subject-file", subject, "--format", "json"],
    { cwd: consumer, env },
  );
  const dispatched = await successful(
    executable("pguide"),
    ["probe", "--guide", guide, "--subject-file", subject, "--format", "json"],
    { cwd: consumer, env },
  );
  assert.equal(JSON.parse(direct.stdout).status, JSON.parse(dispatched.stdout).status);
  const stdin = await successful(
    executable("pguide-probe"),
    ["--guide", guide, "--subject-file", "-", "--format", "json"],
    { cwd: consumer, env, input: await readFile(subject, "utf8") },
  );
  assert.equal(JSON.parse(stdin.stdout).status, "observed");

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
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultAgent: "fixture",
        stateDirectory: state,
        retentionDays: 1,
        agents: {
          fixture: {
            connection: { type: "acp", protocolVersion: "1" },
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

async function invokeRegulate(config, subject, report, env, extra = []) {
  return execute(
    executable("pguide"),
    [
      "regulate",
      "--config",
      config,
      "--guide",
      join(fixture, "guide", "objective-guide.yaml"),
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
  const config = join(fixture, "config.json");
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

  const continuationArgs = [
    "continue",
    "--config",
    config,
    result.regulationId,
    "--format",
    "json",
  ];
  const stillSatisfied = await successful(executable("pguide"), continuationArgs, {
    cwd: consumer,
    env,
  });
  assert.equal(JSON.parse(stillSatisfied.stdout).status, "still-satisfied");

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
  assert.equal(lineage.attempts[1].resumeMode, "not-needed");
  assert.equal(lineage.attempts[2].resumeMode, "resumed");
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
  assert.equal(blocked.code, 3);
  assert.equal(JSON.parse(blocked.stdout).status, "action-blocked");

  const stalled = await invokeRegulate(
    config,
    blockedSubject,
    join(fixture, "stalled-report.json"),
    { ...baseEnv, PGUIDE_FIXTURE_MODE: "noop" },
    ["--max-stalled-iterations", "1"],
  );
  assert.equal(stalled.code, 4);
  assert.equal(JSON.parse(stalled.stdout).status, "no-progress");

  const timedOut = await invokeRegulate(
    config,
    blockedSubject,
    join(fixture, "timeout-report.json"),
    { ...baseEnv, PGUIDE_FIXTURE_MODE: "hang" },
    ["--timeout", "200ms"],
  );
  assert.equal(timedOut.code, 5);
  assert.equal(JSON.parse(timedOut.stdout).status, "timed-out");

  if (process.platform !== "win32") {
    const signalMarker = join(fixture, "signal-prompted");
    let child;
    const signalled = execute(
      executable("pguide"),
      [
        "regulate",
        "--config",
        config,
        "--guide",
        join(fixture, "guide", "objective-guide.yaml"),
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
    );
    for (let attempts = 0; attempts < 100; attempts += 1) {
      try {
        await access(signalMarker);
        break;
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
    }
    await access(signalMarker);
    assert.ok(child?.pid);
    process.kill(child.pid, "SIGTERM");
    const cancelled = await signalled;
    assert.equal(cancelled.code, 5);
    assert.equal(JSON.parse(cancelled.stdout).status, "cancelled");
  }
  console.log("ACP regulation, persistence, resume, retention, redaction and reports verified");
}

try {
  await packAndInstall();
  const env = await verifyCliContract();
  await verifyRegulation(env);
  console.log("deployment verification passed");
} finally {
  await workspace.cleanup();
}
