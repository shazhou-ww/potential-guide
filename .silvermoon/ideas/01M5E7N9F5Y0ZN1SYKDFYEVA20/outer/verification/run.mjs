import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import spawn from "cross-spawn";
import { verifyConsumerGraph } from "../../../../../scripts/deployment-consumer.mjs";
import { releasePackages } from "../../../../../scripts/release-packages.mjs";

const root = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const outer = ".silvermoon/ideas/01M5E7N9F5Y0ZN1SYKDFYEVA20/outer";
const directory = fileURLToPath(new URL(".", import.meta.url));
const resultPath = join(directory, "Result.json");
const acceptedInner = "271a21e6881e739c6cb9100dac298a0a4deb8bdf";
const acceptedCommit = "f441ae05bedffb80ec6b1b888672d5947d367f8f";
const entries = [
  "@potential-guide/effects",
  "@potential-guide/regulation-coordinator",
  "@potential-guide/objective-portfolio-supervisor",
];
const inputFiles = ["../Deployment.md", "run.mjs", "consumer.test.mjs", "consumer.ts"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const repoPath = (path) => relative(root, path).split(sep).join("/");
const normalized = (path) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
assert.equal(normalized(process.cwd()), normalized(root), "Run only from this worktree root");

async function hashes() {
  return Object.fromEntries(await Promise.all(inputFiles.map(async (path) => {
    const file = resolve(directory, path);
    return [repoPath(file), hash(await readFile(file))];
  })));
}

if (process.argv[2] === "--check-evidence") {
  assert.equal(process.argv.length, 3);
  const bytes = await readFile(resultPath);
  const report = JSON.parse(bytes);
  assert.equal(report.outcome, "passed");
  assert.equal(report.implementationRevision, acceptedInner);
  assert.deepEqual(report.inputs, await hashes(), "Contract or fixture changed after execution");
  assert.equal(report.cleanup.directoryExistsAfter, false);
  assert.equal(existsSync(report.isolationDirectory), false);
  assert.ok(report.commands.every((command) => command.closed && !command.timedOut && command.exitCode === 0));
  assert.equal(report.runtime.activeExecutions, 0);
  assert.equal(report.runtime.totals.acquisitions, report.runtime.totals.releases);
  assert.equal(report.runtime.totals.subscriptionsOpened, report.runtime.totals.subscriptionsClosed);
  assert.equal(report.runtime.totals.scopesOpened, report.runtime.totals.scopesClosed);
  console.log(JSON.stringify({ outcome: "passed", resultSha256: hash(bytes), contractRevision: report.contractRevision }));
  process.exit(0);
}

assert.equal(process.argv[2], "--contract-revision");
assert.equal(process.argv.length, 4);
const contractRevision = process.argv[3];
assert.match(contractRevision, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const isolation = join(root, ".cache", `regulation-coordinator-deployment-${Date.now()}-${process.pid}`);
assert.equal(existsSync(isolation), false, "Never reuse or remove an unknown directory");
const report = {
  outcome: "running", startedAt: new Date().toISOString(), contractRevision,
  implementationRevision: acceptedInner, acceptedCommit,
  runnerKind: "deterministic-in-process", realAgentProcessIntegration: false,
  isolationDirectory: isolation, inputs: await hashes(), commands: [], packages: [], thirdPartyPackages: [],
  cleanup: { directoryExistsAfter: true },
};
let created = false;
async function run(command, args, cwd = root, env = process.env, timeoutMs = 180000) {
  const record = { command, args, cwd, exitCode: null, timedOut: false, closed: false };
  report.commands.push(record);
  const output = await new Promise((yes, no) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false });
    record.pid = child.pid ?? null;
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (part) => { stdout += part; });
    child.stderr.on("data", (part) => { stderr += part; });
    const timer = setTimeout(() => {
      record.timedOut = true;
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } else child.kill("SIGTERM");
    }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); no(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      record.exitCode = code;
      record.signal = signal;
      record.closed = true;
      record.stdoutSha256 = hash(stdout);
      record.stdoutSummary = stdout.length > 6000 ? `${stdout.slice(0, 1500)}\n...\n${stdout.slice(-4500)}` : stdout;
      record.stderrSummary = stderr.slice(-2000);
      if (code === 0 && !record.timedOut) yes(stdout);
      else no(new Error(`${command} failed: exit=${code}, timedOut=${record.timedOut}\n${stdout.slice(-4500)}\n${stderr.slice(-2000)}`));
    });
  });
  return output;
}

try {
  report.sourceCommit = (await run("git", ["rev-parse", "HEAD"])).trim();
  assert.equal((await run("git", ["rev-parse", `HEAD:${outer}`])).trim(), contractRevision, "Synchronize this exact deployment contract before running");
  assert.equal((await run("git", ["rev-parse", `HEAD:${outer}/inner`])).trim(), acceptedInner);
  assert.equal(
    (await run("git", ["rev-parse", "HEAD:packages/regulation-coordinator"])).trim(),
    (await run("git", ["rev-parse", `${acceptedCommit}:packages/regulation-coordinator`])).trim(),
    "Do not silently change accepted deliverables during deployment",
  );
  await run("git", ["diff", "--exit-code", "HEAD", "--", "packages", "scripts"]);
  await mkdir(isolation, { recursive: false });
  created = true;
  const packs = join(isolation, "packs"), consumer = join(isolation, "consumer");
  await mkdir(packs);
  await mkdir(consumer);
  const npmConfig = join(isolation, "npm-pack.npmrc");
  await writeFile(npmConfig, "ignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\n");
  const packEnv = {
    ...process.env, npm_config_userconfig: npmConfig,
    npm_config_cache: join(isolation, "npm-cache"),
    npm_config_update_notifier: "false",
  };
  await run(process.execPath, ["--check", join(directory, "consumer.test.mjs")]);
  await run(process.execPath, ["--check", join(directory, "run.mjs")]);
  report.nodeVersion = process.version;
  report.pnpmVersion = (await run("pnpm", ["--version"])).trim();
  await run("pnpm", ["exec", "turbo", "run", "build", "--filter=@potential-guide/regulation-coordinator..."]);
  const definitions = new Map(releasePackages.map((entry) => [entry.name, entry]));
  const manifests = new Map();
  async function visit(name) {
    if (manifests.has(name)) return;
    const definition = definitions.get(name);
    assert.ok(definition, `Missing release inventory definition ${name}`);
    const manifest = JSON.parse(await readFile(join(root, "packages", definition.directory, "package.json"), "utf8"));
    manifests.set(name, manifest);
    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
      if (definitions.has(dependency)) await visit(dependency);
      else assert.ok(!range.startsWith("workspace:"), `Missing internal dependency ${dependency}`);
    }
  }
  for (const entry of entries) await visit(entry);
  assert.equal(manifests.size, 6);
  const tarballs = new Map(), versions = new Map();
  const thirdParty = new Map(), visitedInstalled = new Set();
  async function installedDependencies(packageRoot) {
    const physical = realpathSync(packageRoot);
    const location = relative(root, physical);
    assert.ok(!isAbsolute(location) && location !== ".." && !location.startsWith(`..${sep}`));
    assert.ok(normalized(physical).startsWith(`${normalized(root)}${sep}`), "Installed dependency must remain inside this worktree");
    if (visitedInstalled.has(physical)) return;
    visitedInstalled.add(physical);
    const manifest = JSON.parse(await readFile(join(physical, "package.json")));
    if (!manifests.has(manifest.name)) {
      const prior = thirdParty.get(manifest.name);
      assert.ok(!prior || prior.manifest.version === manifest.version, "Conflicting installed dependency versions need explicit selectors");
      thirdParty.set(manifest.name, { physical, manifest });
    }
    const require = createRequire(join(physical, "package.json"));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const found = (require.resolve.paths(name) ?? [])
        .map((base) => join(base, ...name.split("/")))
        .find((path) => existsSync(join(path, "package.json")));
      assert.ok(found, `Missing installed production dependency ${name}`);
      await installedDependencies(found);
    }
  }
  for (const name of entries)
    await installedDependencies(join(root, "packages", definitions.get(name).directory));
  report.workspaceLockSha256 = hash(await readFile(join(root, "pnpm-lock.yaml")));
  for (const [name, manifest] of manifests) {
    const definition = definitions.get(name);
    const packageRoot = join(root, "packages", definition.directory);
    const packed = JSON.parse(await run("pnpm", ["--dir", packageRoot, "pack", "--pack-destination", packs, "--json"]));
    assert.equal(packed.name, name);
    assert.equal(packed.version, manifest.version);
    const files = packed.files.map(({ path }) => path);
    for (const required of ["dist/index.js", "dist/index.d.ts", "README.md", "LICENSE", "package.json"])
      assert.ok(files.includes(required), `${name} missing ${required}`);
    assert.ok(files.every((file) => !file.startsWith("src/") && !file.startsWith("test/") && !file.endsWith(".tsbuildinfo")));
    versions.set(name, manifest.version);
    tarballs.set(name, packed.filename);
    report.packages.push({
      name, version: manifest.version, sourceDirectory: repoPath(packageRoot),
      sourceTree: (await run("git", ["rev-parse", `HEAD:packages/${definition.directory}`])).trim(),
      tarball: basename(packed.filename), tarballSha256: hash(await readFile(packed.filename)),
      entrySha256: hash(await readFile(join(packageRoot, "dist", "index.js"))),
      declarationsSha256: hash(await readFile(join(packageRoot, "dist", "index.d.ts"))),
      packedFileCount: files.length, developmentFilesExcluded: true,
    });
  }
  await mkdir(join(isolation, "third-party"));
  for (const [name, { physical, manifest }] of thirdParty) {
    const staging = join(isolation, "third-party", name.replace(/[@/]/g, "-"));
    await cp(physical, staging, {
      recursive: true, dereference: true,
      filter(source) {
        const parts = relative(physical, source).split(sep);
        if (parts.includes("node_modules") || parts.includes(".git")) return false;
        assert.ok(normalized(realpathSync(source)).startsWith(`${normalized(root)}${sep}`));
        return true;
      },
    });
    const packed = JSON.parse(await run("npm", [
      "pack", "--ignore-scripts", "--pack-destination", packs, "--json", staging,
    ], root, packEnv))[0];
    assert.equal(packed.name, name);
    assert.equal(packed.version, manifest.version);
    const filename = join(packs, packed.filename);
    for (const file of packed.files) {
      if (file.path !== "package.json")
        assert.equal(file.size, (await stat(join(staging, file.path))).size, "Repacked distribution must not turn hardlinked content into empty archive entries");
    }
    tarballs.set(name, filename);
    report.thirdPartyPackages.push({
      name, version: manifest.version,
      provenance: "installed-distribution-inside-this-worktree",
      sourceDirectory: repoPath(physical), manifestSha256: hash(await readFile(join(physical, "package.json"))),
      tarball: packed.filename, tarballSha256: hash(await readFile(filename)),
      packedFileCount: packed.files.length, lifecycleScriptsDisabled: true,
      materializedRegularFilesBeforePack: true, packedFileSizesVerified: true,
    });
  }
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "regulation-coordinator-isolated-deployment", private: true, type: "module",
    dependencies: Object.fromEntries(entries.map((name) => [name, pathToFileURL(tarballs.get(name)).href])),
  }, null, 2));
  await writeFile(join(consumer, "pnpm-workspace.yaml"),
    `packages: []\noverrides: ${JSON.stringify(Object.fromEntries([...tarballs].map(([name, path]) => [name, pathToFileURL(path).href])))}\n`);
  await writeFile(join(consumer, ".npmrc"), "link-workspace-packages=false\nprefer-workspace-packages=false\nauto-install-peers=false\n");
  const installEnv = { ...process.env, npm_config_userconfig: join(consumer, ".npmrc") };
  await run("pnpm", [
    "install", "--offline", "--ignore-scripts", "--no-frozen-lockfile", "--reporter=append-only",
    "--store-dir", join(isolation, "pnpm-store"),
  ], consumer, installEnv);
  report.consumerLockSha256 = hash(await readFile(join(consumer, "pnpm-lock.yaml")));
  await verifyConsumerGraph(consumer, versions, entries);
  report.physicalGraph = { verified: true, internalPackages: manifests.size, entries, escapedConsumer: false, workspaceRangesRemaining: false };
  await copyFile(join(directory, "consumer.test.mjs"), join(consumer, "consumer.test.mjs"));
  await copyFile(join(directory, "consumer.ts"), join(consumer, "consumer.ts"));
  await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: true, types: [] },
    files: ["consumer.ts"],
  }));
  const env = {
    ...installEnv, HOME: join(consumer, "user"), APPDATA: join(consumer, "user"),
    XDG_CONFIG_HOME: join(consumer, "user"), NODE_PATH: "", NODE_OPTIONS: "",
  };
  await run(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", consumer, "--pretty", "false"], consumer, env, 60000);
  await run(process.execPath, ["--test", "--test-concurrency=1", join(consumer, "consumer.test.mjs")], consumer, env, 60000);
  report.runtime = JSON.parse(await readFile(join(consumer, "runtime-evidence.json")));
  for (const resolved of report.runtime.resolvedEntrypoints)
    assert.equal(resolved.sha256, report.packages.find((entry) => entry.name === resolved.name).entrySha256);
  await run("git", ["diff", "--exit-code", "HEAD", "--", "packages", "scripts"]);
  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (created) await rm(isolation, { recursive: true, force: true });
  report.cleanup = {
    directoryExistsAfter: existsSync(isolation),
    operationOwnedDirectoryRemoved: created && !existsSync(isolation),
    commandProcessesClosed: report.commands.every((command) => command.closed),
    globalInstallPublishLinkOrConfigurationWrite: false,
  };
  report.finishedAt = new Date().toISOString();
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    outcome: report.outcome, contractRevision, packages: report.packages.length,
    cleanup: report.cleanup, error: report.error,
  }, null, 2));
}
