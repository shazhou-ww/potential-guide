import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const idea = ".silvermoon/ideas/01M65AH22HXJXNC7BQNVD0ZTHB";
const acceptedCommit = "b54b44400925f9853323115c459079bafb405827";
const acceptedPackages = "8c7910f64171b2392e4bf9c399382a552714bbef";
const acceptedInner = "d874dd9608e4c17935b6d81e578d2dc509c0620a";
const argv = process.argv.slice(2);
const proof = {
  status: "running",
  runId: randomUUID(),
  startedAt: new Date().toISOString(),
  sourceRoot: root,
  acceptedCommit,
  acceptedPackages,
  acceptedInner,
  runtime: { node: process.versions.node, platform: process.platform, architecture: process.arch },
  commands: [],
  packages: [],
  helpers: [],
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (parent, candidate) => {
  const delta = relative(parent, candidate);
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`));
};
const deadline = Date.now() + 30 * 60_000;
let external;
let marked = false;
let created = false;
let consumer;
const commands = [];
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  for (const item of commands) if (!item.closed) item.kill();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
async function bounded(operation, ms) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("Owned command did not finish within cleanup budget.")), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function run(command, args, cwd, maximum = 120_000) {
  assert.equal(interrupted, false, "Verification interrupted.");
  const started = performance.now();
  const timeoutMs = Math.min(maximum, deadline - Date.now());
  assert.ok(timeoutMs > 0, "Overall verification budget exhausted.");
  let executable = command;
  let commandArgs = args;
  const windowsPnpm = command === "pnpm" && process.platform === "win32";
  if (windowsPnpm) {
    assert.ok(args.every((arg) => !/["\r\n&|<>%!^]/.test(arg)), "Unsafe cmd argument.");
    executable = process.env.ComSpec;
    commandArgs = ["/d", "/s", "/c", `pnpm ${args.map((arg) => `"${arg}"`).join(" ")}`];
  }
  const entry = {
    command: [command, ...args], cwd, startedAt: new Date().toISOString(), timeoutMs,
  };
  proof.commands.push(entry);
  const child = spawn(executable, commandArgs, {
    cwd, windowsHide: true, detached: process.platform !== "win32",
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
    windowsVerbatimArguments: windowsPnpm, stdio: ["ignore", "pipe", "pipe"],
  });
  entry.pid = child.pid;
  const item = { child, entry };
  commands.push(item);
  let stdout = "", stderr = "";
  let timedOut = false;
  const kill = () => {
    if (item.closed || !child.pid) return;
    if (process.platform === "win32")
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 15_000 });
    else {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  };
  item.kill = kill;
  const capture = (which, chunk) => {
    if (which === "stdout") stdout += chunk;
    else stderr += chunk;
    if (stdout.length + stderr.length > 4 * 1024 * 1024) {
      entry.outputLimitExceeded = true;
      kill();
    }
  };
  child.stdout.setEncoding("utf8").on("data", (chunk) => capture("stdout", chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => capture("stderr", chunk));
  item.done = new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      item.closed = true;
      done({ code, signal });
    });
  });
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  try {
    const outcome = await Promise.race([
      item.done,
      new Promise((_, reject) => {
        item.killTimer = setTimeout(() => reject(Error("Owned command did not exit after bounded kill.")), timeoutMs + 20_000);
      }),
    ]);
    Object.assign(entry, outcome, {
      timedOut, finishedAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - started),
      stdoutSha256: sha(stdout), stderrSha256: sha(stderr),
      stderrTail: stderr.slice(-4000),
    });
    assert.ok(!timedOut && !entry.outputLimitExceeded, "Owned command exceeded its budget.");
    assert.equal(outcome.code, 0, `${command}: ${stderr.slice(-4000)}\n${stdout.slice(-4000)}`);
    return stdout.trim();
  } catch (error) {
    entry.error = String(error.stack ?? error);
    throw error;
  } finally {
    entry.finishedAt ??= new Date().toISOString();
    entry.elapsedMs ??= Math.round(performance.now() - started);
    clearTimeout(timer);
    clearTimeout(item.killTimer);
  }
}
const git = (...args) => run("git", ["--no-pager", ...args], root);
const definitions = [
  "task-protocol", "task-engine", "task-engine-http", "task-engine-storage",
  "task-engine-server", "check-runtime-files", "check-artifacts", "check-task", "probe-task",
];
const helperFiles = ["helpers.mjs", "fixtures.mjs", "scenario.mjs", "server-child.mjs", "worker-probe.cjs", "checker.cjs"];
async function inventory(directory, versions) {
  const visited = new Set();
  const graph = [];
  async function visit(name, from, parent, optional = false) {
    let path, manifest;
    for (const search of createRequire(from).resolve.paths(`${name}/package.json`) ?? []) {
      const candidate = join(search, ...name.split("/"), "package.json");
      if (!inside(directory, candidate)) continue;
      try {
        path = await realpath(candidate);
        assert.ok(inside(directory, path), "Dependency realpath escaped independent consumer.");
        manifest = JSON.parse(await readFile(path, "utf8"));
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!manifest && optional) return;
    assert.ok(manifest, `Missing independent dependency ${name}`);
    if (visited.has(path)) return;
    visited.add(path);
    if (name.startsWith("@potential-guide/")) {
      assert.ok(versions.has(name), `Unexpected internal dependency: ${name}`);
      assert.equal(manifest.version, versions.get(name));
    }
    assert.ok(!/potential-guide\/(?:checker-host|objective-host|objective-pilot|objective-regulator|regulation-coordinator|.*agents)/.test(name));
    graph.push({ name, version: manifest.version, parent, manifestRealpath: path, manifestSha256: sha(await readFile(path)) });
    for (const [dependency, range] of Object.entries({
      ...manifest.peerDependencies, ...manifest.dependencies, ...manifest.optionalDependencies,
    })) {
      assert.ok(!range.startsWith("workspace:"));
      await visit(dependency, path, `${name}@${manifest.version}`,
        Object.hasOwn(manifest.optionalDependencies ?? {}, dependency) ||
        manifest.peerDependenciesMeta?.[dependency]?.optional === true);
    }
  }
  for (const name of versions.keys()) await visit(name, join(directory, "package.json"), "consumer");
  assert.equal(graph.filter((entry) => entry.name.startsWith("@potential-guide/")).length, 9);
  return graph;
}
try {
  assert.deepEqual([argv.length, argv[0], argv[2]], [4, "--external-root", "--revision"]);
  assert.match(argv[3], /^[a-f0-9]{40}$/);
  proof.testedDeploymentRevision = argv[3];
  assert.ok(isAbsolute(argv[1]), "external-root must be absolute.");
  external = resolve(argv[1]);
  assert.ok(!existsSync(external), "external-root must be new and nonexistent.");
  const parent = await realpath(dirname(external));
  for (let ancestor = parent; ; ancestor = dirname(ancestor)) {
    assert.ok(!existsSync(join(ancestor, ".git")), "Consumer parent is inside a Git checkout.");
    if (dirname(ancestor) === ancestor) break;
  }
  external = join(parent, external.slice(dirname(external).length + 1));
  assert.ok(!existsSync(external));
  proof.externalRoot = external;
  const worktrees = (await git("worktree", "list", "--porcelain", "-z"))
    .split("\0").filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9));
  for (const worktree of worktrees) {
    const physical = await realpath(worktree).catch((error) => {
      if (error.code === "ENOENT") return resolve(worktree);
      throw error;
    });
    assert.ok(!inside(physical, external) && !inside(external, physical), "Consumer overlaps a repository worktree.");
  }
  assert.equal(await git("status", "--porcelain"), "", "Synchronize protocol/harness before execution.");
  proof.sourceCommit = await git("rev-parse", "HEAD");
  proof.sourcePackagesTree = await git("rev-parse", "HEAD:packages");
  assert.equal(proof.sourcePackagesTree, acceptedPackages);
  assert.equal(await git("rev-parse", `${acceptedCommit}:packages`), acceptedPackages);
  assert.equal(await git("rev-parse", `HEAD:${idea}/outer/inner`), acceptedInner);
  assert.equal(await git("rev-parse", `HEAD:${idea}/outer`), argv[3]);
  await git("merge-base", "--is-ancestor", acceptedCommit, "HEAD");
  proof.pnpm = await run("pnpm", ["--version"], root);
  await mkdir(external);
  created = true;
  await writeFile(join(external, ".probe-deployment-owner.json"), JSON.stringify({ runId: proof.runId, sourceCommit: proof.sourceCommit }));
  marked = true;
  const packs = join(external, "packs");
  consumer = join(external, "consumer");
  await mkdir(packs);
  await mkdir(consumer);
  const overrides = {};
  const versions = new Map();
  for (const directory of definitions) {
    const packageRoot = join(root, "packages", directory);
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    for (const hook of ["prepack", "postpack", "prepare"])
      assert.equal(manifest.scripts?.[hook], undefined, "This protocol requires prebuilt packages without packaging hooks.");
    const packed = JSON.parse(await run("pnpm", ["--dir", packageRoot, "pack", "--pack-destination", packs, "--json"], root));
    assert.equal(packed.name, manifest.name);
    assert.equal(packed.version, manifest.version);
    const archive = await realpath(packed.filename);
    assert.ok(inside(packs, archive));
    assert.ok(packed.files.every(({ path }) => !/^(?:src|test)\//.test(path)));
    const files = [];
    for (const { path } of packed.files.filter(({ path }) => /^dist\/.*\.(?:js|cjs)$/.test(path)))
      files.push({ path, sha256: sha(await readFile(join(packageRoot, path))) });
    assert.ok(files.length, "Built runtime files must already exist.");
    versions.set(manifest.name, manifest.version);
    overrides[manifest.name] = pathToFileURL(archive).href;
    proof.packages.push({
      name: manifest.name, version: manifest.version, archive, archiveSha256: sha(await readFile(archive)),
      sourceTree: await git("rev-parse", `${proof.sourceCommit}:packages/${directory}`), runtimeFiles: files,
    });
  }
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "independent-probe-deployment", private: true, type: "module", dependencies: overrides,
  }, null, 2));
  await writeFile(join(consumer, "pnpm-workspace.yaml"), `packages: []\noverrides: ${JSON.stringify(overrides)}\n`);
  for (const name of helperFiles) {
    const source = join(here, name);
    await copyFile(source, join(consumer, name));
    proof.helpers.push({ name, sha256: sha(await readFile(source)) });
  }
  await run("pnpm", ["install", "--ignore-scripts", "--prefer-offline", "--no-frozen-lockfile", "--reporter=append-only"], consumer, 600_000);
  proof.installedGraph = await inventory(consumer, versions);
  for (const pkg of proof.packages) {
    const installed = proof.installedGraph.find((entry) => entry.name === pkg.name);
    for (const file of pkg.runtimeFiles)
      assert.equal(sha(await readFile(join(dirname(installed.manifestRealpath), file.path))), file.sha256);
  }
  proof.lockfileSha256 = sha(await readFile(join(consumer, "pnpm-lock.yaml")));
  await run(process.execPath, ["scenario.mjs"], consumer, 480_000);
  proof.consumer = JSON.parse(await readFile(join(consumer, "result.json"), "utf8"));
  assert.equal(proof.consumer.status, "passed");
  assert.equal(proof.consumer.cleanup.allAbsent, true);
  assert.equal(await git("rev-parse", "HEAD"), proof.sourceCommit, "Source HEAD changed during verification.");
  assert.equal(await git("status", "--porcelain"), "", "Source worktree changed during verification.");
  proof.status = "passed";
} catch (error) {
  proof.status = "failed";
  proof.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  if (created && !marked)
    cleanupErrors.push("Created external directory could not be marked; retained rather than deleting an unverified path.");
  for (const item of commands) {
    if (!item.closed) {
      try {
        item.kill();
        await bounded(item.done, 20_000);
      } catch (error) { cleanupErrors.push(String(error)); }
    }
  }
  if (consumer) {
    for (const [key, name] of [["consumer", "result.json"], ["ownedProcesses", "owned-processes.jsonl"], ["workerEvents", "worker-events.jsonl"], ["executionJournal", "execution.jsonl"], ["downloads", "downloads.jsonl"]]) {
      try {
        const text = await readFile(join(consumer, name), "utf8");
        proof[key] = name.endsWith(".jsonl") ? text.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : JSON.parse(text);
      } catch (error) { if (error.code !== "ENOENT") cleanupErrors.push(String(error)); }
    }
    const latest = new Map((proof.ownedProcesses ?? []).map((row) => [row.pid, row]));
    for (const row of latest.values()) {
      if (row.event !== "spawn") continue;
      try {
        process.kill(row.pid, 0);
        cleanupErrors.push(`Unconfirmed owned descendant PID ${row.pid}; marked directory retained.`);
      } catch (error) {
        if (error.code !== "ESRCH") cleanupErrors.push(String(error));
      }
    }
  }
  if (marked) {
    try {
      const marker = JSON.parse(await readFile(join(external, ".probe-deployment-owner.json"), "utf8"));
      assert.equal(marker.runId, proof.runId);
      if (!cleanupErrors.length) await rm(external, { recursive: true, force: true });
    } catch (error) { cleanupErrors.push(String(error)); }
  }
  proof.cleanup = { marked, externalRootRemoved: marked && !existsSync(external), errors: cleanupErrors };
  proof.interrupted = interrupted;
  if (interrupted || cleanupErrors.length || (marked && !proof.cleanup.externalRootRemoved)) {
    proof.status = "failed";
    process.exitCode = 1;
  }
  proof.finishedAt = new Date().toISOString();
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  await writeFile(join(here, "results.json"), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ status: proof.status, results: join(here, "results.json"), cleanup: proof.cleanup }));
}
