import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import spawn from "cross-spawn";

const root = process.cwd();
const runRoot = dirname(fileURLToPath(import.meta.url));
assert.ok(relative(root, runRoot).startsWith(join(".cache", "terminated-outer-")));
const evidence = join(
  root,
  ".silvermoon",
  "ideas",
  "01M66MH9YKNJ406ESX7J1HTY7J",
  "outer",
  "evidence",
);
const sourceCommit = "bdb498318a7840ced083ccc23d0d7e71b88c459e";
const targetRevision = "85a1b0636b37b22ef77dcee349067d10d4bab54b";
const packages = ["task-protocol", "task-engine", "task-engine-storage"];
const scripts = ["controller.mjs", "consumer.mjs", "harness.mjs", "storage-child.mjs"];
const active = new Map();
const commands = [];
const result = {
  targetRevision,
  sourceCommit,
  implementationCommit: "a9180578f7276a16edf3c94b5470e68e4f88da84",
  runId: runRoot.split(sep).at(-1),
  startedAt: new Date().toISOString(),
  node: process.version,
  artifacts: [],
  scripts: [],
  commands,
  storage: [],
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const env = { ...process.env };
delete env.NODE_PATH;
delete env.NODE_OPTIONS;

function run(command, args, cwd = root, expected = 0, timeoutMs = 180_000) {
  return new Promise((accept, reject) => {
    const entry = { command, args, cwd: relative(root, cwd), expectedExitCode: expected };
    commands.push(entry);
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false });
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    entry.pid = child.pid;
    if (child.pid) active.set(child.pid, child);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      entry.timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      active.delete(child.pid);
      entry.error = error.message;
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      active.delete(child.pid);
      entry.exitCode = code;
      entry.signal = signal;
      entry.durationMs = Date.now() - started;
      entry.stdoutSha256 = hash(stdout);
      entry.stderrSha256 = hash(stderr);
      if (code !== expected || entry.timedOut) {
        entry.stderr = stderr.slice(-6000);
        entry.stdout = stdout.slice(-6000);
        reject(new Error(`${command} exited ${code}; ${stderr}\n${stdout}`));
      } else {
        if (stdout.length < 1500) entry.stdout = stdout.trim();
        accept(stdout);
      }
    });
  });
}

const packs = join(runRoot, "packs");
const consumer = join(runRoot, "consumer");
const fixtures = join(runRoot, "fixtures");
const outputs = join(runRoot, "outputs");
try {
  for (const path of [packs, consumer, fixtures, outputs]) await mkdir(path, { recursive: true });
  result.packagingCommit = (await run("git", ["rev-parse", "HEAD"])).trim();
  await run("git", [
    "diff",
    "--exit-code",
    sourceCommit,
    "HEAD",
    "--",
    ...packages.map((name) => join("packages", name)),
  ]);
  await run("git", [
    "diff",
    "--exit-code",
    "--",
    ...packages.map((name) => join("packages", name)),
  ]);
  result.sourceComparison =
    "target package trees unchanged from sourceCommit; no unstaged product changes";
  result.pnpm = (await run("pnpm", ["--version"])).trim();
  for (const script of scripts) {
    const bytes = await readFile(join(runRoot, script));
    assert.deepEqual(
      bytes,
      await readFile(join(evidence, script)),
      `Executed ${script} differs from retained evidence`,
    );
    result.scripts.push({ file: script, bytes: bytes.length, sha256: hash(bytes) });
  }
  await run("pnpm", [
    "exec",
    "turbo",
    "run",
    "build",
    "--force",
    ...packages.map((name) => `--filter=@potential-guide/${name}`),
    "--output-logs=errors-only",
  ]);
  const dependencies = {};
  for (const name of packages) {
    const packed = JSON.parse(
      await run("pnpm", [
        "--dir",
        join(root, "packages", name),
        "pack",
        "--pack-destination",
        packs,
        "--json",
      ]),
    );
    const bytes = await readFile(packed.filename);
    result.artifacts.push({
      name: packed.name,
      version: packed.version,
      file: relative(runRoot, packed.filename),
      bytes: bytes.length,
      sha256: hash(bytes),
    });
    dependencies[packed.name] = pathToFileURL(packed.filename).href;
  }
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "terminated-outer-independent-consumer",
        private: true,
        type: "module",
        dependencies,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(consumer, "pnpm-workspace.yaml"),
    `packages: []\noverrides: ${JSON.stringify(dependencies)}\n`,
  );
  await run("pnpm", ["install", "--offline", "--ignore-scripts", "--no-frozen-lockfile"], consumer);
  for (const name of scripts.filter((name) => name !== "controller.mjs"))
    await copyFile(join(runRoot, name), join(consumer, name));
  const consumerOutput = join(outputs, "consumer.json");
  await run(process.execPath, ["consumer.mjs", consumerOutput], consumer, 0, 60_000);
  result.consumer = JSON.parse(await readFile(consumerOutput, "utf8"));
  assert.ok(result.consumer.scenarios.length >= 16);
  assert.ok(
    result.consumer.scenarios.every(
      (scenario) => scenario.status === "passed" && scenario.checks.length > 0 && scenario.closed,
    ),
  );
  for (const outcome of ["completed", "failed", "interrupted"]) {
    const directory = join(fixtures, outcome);
    await mkdir(directory);
    const database = join(directory, "new.sqlite");
    const receipt = join(outputs, `${outcome}-write.json`);
    const recovered = join(outputs, `${outcome}-read.json`);
    await run(
      process.execPath,
      ["storage-child.mjs", "write", outcome, database, receipt],
      consumer,
      17,
      30_000,
    );
    await run(
      process.execPath,
      ["storage-child.mjs", "read", outcome, database, recovered, receipt],
      consumer,
      0,
      30_000,
    );
    const write = JSON.parse(await readFile(receipt, "utf8"));
    const read = JSON.parse(await readFile(recovered, "utf8"));
    assert.equal(write.status, "passed");
    assert.equal(read.status, "passed");
    assert.notEqual(write.pid, read.pid);
    result.storage.push({ id: `restart-${outcome}`, write, read });
  }
  for (const kind of ["zero", "v1", "unknown", "checkpoint", "facts", "binding", "live-wal"]) {
    const directory = join(fixtures, `old-${kind}`);
    await mkdir(directory);
    const output = join(outputs, `format-${kind}.json`);
    await run(
      process.execPath,
      ["storage-child.mjs", "format", kind, join(directory, "old.sqlite"), output],
      consumer,
      0,
      30_000,
    );
    const proof = JSON.parse(await readFile(output, "utf8"));
    assert.equal(proof.status, "passed");
    result.storage.push({ id: `reject-${kind}`, proof });
  }
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = { name: error.name, message: error.message, stack: error.stack };
  const available = await readdir(outputs).catch(() => []);
  result.partialOutputs = {};
  for (const file of available) {
    if (file.endsWith(".json"))
      result.partialOutputs[file] = JSON.parse(await readFile(join(outputs, file), "utf8"));
  }
  process.exitCode = 1;
} finally {
  const pending = [...active.values()];
  for (const child of pending) child.kill("SIGKILL");
  await Promise.all(pending.map((child) => new Promise((done) => child.once("close", done))));
  result.cleanup = { remainingOwnedPids: [...active.keys()], directory: relative(root, runRoot) };
  try {
    await rm(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    result.cleanup.directoryAbsent = !(await stat(runRoot).catch(() => undefined));
    assert.equal(result.cleanup.directoryAbsent, true);
    assert.equal(active.size, 0);
  } catch (error) {
    result.cleanup.error = error.message;
    result.status = "failed";
    process.exitCode = 1;
  }
  result.finishedAt = new Date().toISOString();
  result.scenarioCount = (result.consumer?.scenarios.length ?? 0) + result.storage.length;
  result.assertionCount =
    (result.consumer?.scenarios.reduce((sum, item) => sum + item.checks.length, 0) ?? 0) +
    result.storage.reduce(
      (sum, item) =>
        sum +
        (item.proof?.checks.length ?? 0) +
        (item.write?.checks.length ?? 0) +
        (item.read?.checks.length ?? 0),
      0,
    );
  await writeFile(join(evidence, `${result.runId}.json`), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        status: result.status,
        scenarioCount: result.scenarioCount,
        assertionCount: result.assertionCount,
        artifacts: result.artifacts,
        cleanup: result.cleanup,
      },
      null,
      2,
    ),
  );
}
