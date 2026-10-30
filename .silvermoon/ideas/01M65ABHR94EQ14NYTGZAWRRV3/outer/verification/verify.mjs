import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const args = process.argv.slice(2);
assert.equal(args.length, 4);
assert.equal(args[0], "--external-root");
assert.equal(args[2], "--revision");
const external = resolve(args[1]);
const revision = args[3];
const inside = (parent, path) => {
  const delta = relative(parent, path);
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`));
};
assert.ok(!inside(root, external) && !inside(external, root), "Consumer must be independent of source.");
assert.ok(!existsSync(external), "External root must not exist.");
const result = {
  status: "running", startedAt: new Date().toISOString(),
  testedDeploymentRevision: revision, sourceRoot: root, externalRoot: external,
  runtime: { node: process.versions.node, platform: process.platform, architecture: process.arch },
  commands: [], packages: [], consumers: [],
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function run(command, args, cwd, timeoutMs = 600000) {
  let executable = command;
  let argv = args;
  if (command === "pnpm" && process.platform === "win32") {
    assert.ok(args.every((arg) => !/["\r\n&|<>]/.test(arg)));
    executable = process.env.ComSpec;
    argv = ["/d", "/s", "/c", `pnpm ${args.map((arg) => `"${arg}"`).join(" ")}`];
  }
  const started = performance.now();
  const child = spawn(executable, argv, {
    cwd, windowsHide: true, detached: process.platform !== "win32",
    windowsVerbatimArguments: command === "pnpm" && process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "", timedOut = false;
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const outcome = await new Promise((done, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32")
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      else process.kill(-child.pid, "SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => { clearTimeout(timer); done({ code, signal }); });
  });
  result.commands.push({
    command: [command, ...args], cwd, pid: child.pid, ...outcome, timedOut,
    elapsedMs: Math.round(performance.now() - started), stdoutSha256: sha(stdout), stderrSha256: sha(stderr),
  });
  assert.equal(timedOut, false, `${command} exceeded its bound.`);
  assert.equal(outcome.code, 0, `${command} failed:\n${stderr.slice(-6000)}\n${stdout.slice(-6000)}`);
  return stdout.trim();
}
const git = (...args) => run("git", ["--no-pager", ...args], root);
const sourceCommit = await git("rev-parse", "HEAD");
assert.equal(await git("status", "--porcelain"), "", "Synchronize the harness before checks.");
assert.equal(await git("rev-parse", "HEAD:.silvermoon/ideas/01M65ABHR94EQ14NYTGZAWRRV3/outer"), revision);
assert.equal(await git("rev-parse", "HEAD:packages"), "fb74721446963a327991a621d88e1ff14a8adc39");
assert.equal(await git("rev-parse", "HEAD:.silvermoon/ideas/01M65ABHR94EQ14NYTGZAWRRV3/outer/inner"), "5bea45766484d599e0a2bab86b25da05ec2447de");
result.sourceCommit = sourceCommit;
result.implementationRevision = "5bea45766484d599e0a2bab86b25da05ec2447de";
result.sourcePackagesTree = "fb74721446963a327991a621d88e1ff14a8adc39";
const ownedMarker = randomUUID();
await mkdir(external);
await writeFile(join(external, ".deployment-owner.json"), JSON.stringify({ ownedMarker, sourceCommit }));
const definitions = [
  "task-protocol", "task-engine", "task-engine-http", "task-engine-storage",
  "task-engine-server", "check-runtime-files", "check-artifacts", "check-task",
];
const packs = new Map();
const versions = new Map();
async function graph(directory, entries) {
  const visited = new Set(), inventory = [];
  async function visit(name, from, parent, optional = false) {
    const require = createRequire(from);
    let path, manifest;
    for (const search of require.resolve.paths(`${name}/package.json`) ?? []) {
      const candidate = join(search, ...name.split("/"), "package.json");
      if (!inside(directory, candidate)) continue;
      try {
        manifest = JSON.parse(await readFile(candidate, "utf8"));
        path = await realpath(candidate);
        assert.ok(inside(directory, path), "Installed dependency escaped consumer.");
        break;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (!path && optional) return;
    assert.ok(path, `Missing independent dependency ${name}`);
    if (visited.has(path)) return;
    visited.add(path);
    if (versions.has(name)) assert.equal(manifest.version, versions.get(name));
    assert.ok(!["@potential-guide/checker-host", "@potential-guide/objective-host"].includes(name));
    inventory.push({ name, version: manifest.version, firstReachedFrom: parent, installedManifest: relative(directory, path) });
    const dependencies = { ...manifest.peerDependencies, ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const [dependency, range] of Object.entries(dependencies)) {
      assert.ok(!range.startsWith("workspace:"));
      await visit(dependency, path, `${name}@${manifest.version}`,
        Object.hasOwn(manifest.optionalDependencies ?? {}, dependency) ||
        manifest.peerDependenciesMeta?.[dependency]?.optional === true);
    }
  }
  for (const entry of entries) await visit(entry, join(directory, "package.json"), "consumer");
  return inventory;
}
try {
  const packRoot = join(external, "packs");
  await mkdir(packRoot);
  for (const directory of definitions) {
    const packageRoot = join(root, "packages", directory);
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    const packed = JSON.parse(await run("pnpm", ["--dir", packageRoot, "pack", "--pack-destination", packRoot, "--json"], root));
    assert.equal(packed.name, manifest.name);
    assert.equal(packed.version, manifest.version);
    assert.ok(packed.files.every(({ path }) => !path.startsWith("src/") && !path.startsWith("test/")));
    packs.set(manifest.name, packed.filename);
    versions.set(manifest.name, manifest.version);
    result.packages.push({
      name: manifest.name, version: manifest.version, archive: packed.filename,
      sha256: sha(await readFile(packed.filename)),
      sourceTree: await git("rev-parse", `${sourceCommit}:packages/${directory}`),
    });
  }
  for (const [label, entries, files, scenario] of [
    ["contracts", ["@potential-guide/check-artifacts"], ["pure-scenario.mjs"], "pure-scenario.mjs"],
    ["generic", ["@potential-guide/task-engine-server", "@potential-guide/task-engine", "@potential-guide/task-protocol"],
      ["generic-scenario.mjs", "generic-config.mjs", "fatal-config.mjs", "server-child.mjs", "helpers.mjs"], "generic-scenario.mjs"],
    ["check", ["@potential-guide/check-task", "@potential-guide/task-engine-server", "@potential-guide/task-engine", "@potential-guide/task-protocol", "@potential-guide/check-artifacts"],
      ["check-scenario.mjs", "file-scenario.mjs", "check-config.mjs", "server-child.mjs", "helpers.mjs", "worker-probe.cjs", "checker.cjs"], "check-scenario.mjs"],
  ]) {
    const directory = join(external, label);
    await mkdir(directory);
    await writeFile(join(directory, "package.json"), JSON.stringify({
      name: `independent-deployment-${label}`, private: true, type: "module",
      dependencies: Object.fromEntries(entries.map((name) => [name, pathToFileURL(packs.get(name)).href])),
    }, null, 2));
    await writeFile(join(directory, "pnpm-workspace.yaml"), `packages: []\noverrides: ${JSON.stringify(Object.fromEntries([...packs].map(([name, path]) => [name, pathToFileURL(path).href])))}\n`);
    await run("pnpm", ["install", "--ignore-scripts", "--prefer-offline", "--no-frozen-lockfile", "--reporter=append-only"], directory);
    const inventory = await graph(directory, entries);
    const names = inventory.map((entry) => entry.name);
    if (label === "generic") assert.ok(names.every((name) => name.startsWith("@potential-guide/task-")));
    else {
      assert.ok(names.includes("esbuild"));
      assert.ok(names.includes("tar"));
    }
    const consumer = { label, directory, entries, inventory };
    result.consumers.push(consumer);
    for (const file of files) await copyFile(join(here, file), join(directory, file));
    if (label !== "contracts") {
      const help = JSON.parse(await run("pnpm", ["exec", "task-engine-server", "--help", "--format", "json"], directory));
      assert.equal(help.schemaVersion, 1);
      consumer.executableHelp = help;
    }
    const stdout = await run(process.execPath, [scenario], directory, 120000);
    consumer.proof = label === "contracts" ? JSON.parse(stdout) : JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    assert.equal(consumer.proof.status, "passed");
    if (label === "check") {
      await run(process.execPath, ["file-scenario.mjs"], directory, 180000);
      consumer.fileProof = JSON.parse(await readFile(join(directory, "file-result.json"), "utf8"));
      assert.equal(consumer.fileProof.status, "passed");
    }
    console.log(JSON.stringify({ consumer: label, status: "passed", installedPackages: inventory.length }));
  }
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = String(error.stack ?? error);
  for (const consumer of result.consumers) {
    if (!consumer.proof && existsSync(join(consumer.directory, "result.json")))
      consumer.proof = JSON.parse(await readFile(join(consumer.directory, "result.json"), "utf8"));
    if (existsSync(join(consumer.directory, "file-result.json")))
      consumer.fileProof = JSON.parse(await readFile(join(consumer.directory, "file-result.json"), "utf8"));
  }
  process.exitCode = 1;
} finally {
  const marker = JSON.parse(await readFile(join(external, ".deployment-owner.json"), "utf8"));
  assert.equal(marker.ownedMarker, ownedMarker);
  await rm(external, { recursive: true, force: true });
  result.cleanup = { markerMatched: true, externalRootRemoved: !existsSync(external) };
  assert.equal(result.cleanup.externalRootRemoved, true);
  result.finishedAt = new Date().toISOString();
  await writeFile(join(here, "local-file-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, cleanup: result.cleanup }));
}
