import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { access, chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkPackageConsumers } from "./check-package-consumers.mjs";
import {
  assertLatestVersion,
  consumerManifest,
  consumerMode,
  consumerVersions,
  verifyConsumerGraph,
} from "./deployment-consumer.mjs";
import { verificationPackages } from "./release-packages.mjs";
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
const packageDefinitions = verificationPackages;
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
  const manifests = new Map();
  for (const definition of packageDefinitions) {
    const packageRoot = join(root, definition.workspace ?? "packages", definition.directory);
    const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    assert.equal(packageManifest.name, definition.name);
    manifests.set(definition.name, packageManifest);
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
  const selectedVersions = consumerVersions(manifests, consumerEntries);
  const selectedDefinitions = packageDefinitions.filter(({ name }) => selectedVersions.has(name));
  await verifyConsumerGraph(consumer, selectedVersions, consumerEntries);
  for (const definition of selectedDefinitions) {
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
    ...selectedDefinitions
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
  const direct = await execute(
    executable("pguide-probe"),
    ["--pilot", objectiveUri, "--subject-file", subject, "--format", "json"],
    { cwd: consumer, env },
  );
  const dispatched = await execute(
    executable("pguide"),
    ["probe", "--pilot", objectiveUri, "--subject-file", subject, "--format", "json"],
    { cwd: consumer, env },
  );
  for (const result of [direct, dispatched]) {
    assert.equal(result.code, 2);
    assert.match(result.stdout + result.stderr, /Legacy Pilot execution is retired/);
  }
  const stdin = await execute(
    executable("pguide-probe"),
    ["--pilot", objectiveUri, "--subject-file", "-", "--format", "json"],
    { cwd: consumer, env, input: await readFile(subject, "utf8") },
  );
  assert.equal(stdin.code, 2);
  assert.match(stdin.stdout + stdin.stderr, /Legacy Pilot execution is retired/);

  const badOption = await execute(executable("pguide"), ["probe", "--unknown", "x"], {
    cwd: consumer,
    env,
  });
  assert.equal(badOption.code, 2);
  console.log(`CLI contract verified on ${process.platform}/${process.arch}`);
  return env;
}

async function verifySupervisorRetirement(baseEnv) {
  const result = await execute(
    executable("pguide"),
    ["supervise", "--execute", "--format", "json"],
    {
      cwd: consumer,
      env: baseEnv,
    },
  );
  assert.equal(result.code, 2);
  assert.match(result.stdout, /Unknown command.*supervise/u);
  assert.doesNotMatch(result.stdout, /pguide-supervise|Install/u);
  console.log(
    "installed CLI rejects retired Supervisor without replacement or installation advice",
  );
}

const failures = [];
try {
  await packAndInstall();
  const env = await verifyCliContract();
  await verifySupervisorRetirement(env);
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
