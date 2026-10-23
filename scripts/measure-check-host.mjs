import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  closePrivateFileBackend,
  connectHost,
  createPrivateDirectory,
  readArtifact,
} from "../packages/check-host/dist/index.js";

const repository = resolve(import.meta.dirname, "..");
const execute = promisify(execFile);
const parent = join(repository, ".cache", "check-host-measurements");
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, "e2e-"));
console.log(`Measurement root: ${root}`);
const scratch = join(root, "scratch");
await mkdir(scratch);
const previousTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP };
process.env.TEMP = scratch;
process.env.TMP = scratch;
const journal = join(root, "owned-processes.jsonl");
const preload = join(root, "measure-owned-processes.mjs");
const main = join(repository, "packages", "check-host", "dist", "main.js");
const hosts = new Set();
const round = (value) => Math.round(value * 100) / 100;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function entries() {
  const text = await readFile(journal, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const record = JSON.parse(line);
      assert.equal(record.root, root);
      assert.ok(Number.isSafeInteger(record.pid) && record.pid > 0 && record.pid !== process.pid);
      return record;
    });
}
async function waitGone(pids) {
  const end = Date.now() + 10_000;
  while (pids.some(alive)) {
    assert.ok(Date.now() < end, "An operation-owned service or permission helper did not exit.");
    await new Promise((done) => setTimeout(done, 25));
  }
}
async function stop(directory) {
  const records = await entries();
  const owned = records.filter(
    (record) => record.kind === "host" && record.directory === directory,
  );
  if (owned.length === 0) return;
  assert.equal(owned.length, 1);
  const pid = owned[0].pid;
  if (alive(pid)) process.kill(pid, "SIGTERM");
  await waitGone([
    pid,
    ...records
      .filter((record) => record.kind === "helper" && record.parent === pid)
      .map((record) => record.pid),
  ]);
}
async function memory(directory) {
  assert.equal(
    process.platform,
    "win32",
    "This RSS collector uses native Windows process metrics.",
  );
  const records = await entries();
  const host = records.find((record) => record.kind === "host" && record.directory === directory);
  assert.ok(host);
  const pids = [
    host.pid,
    ...records
      .filter((record) => record.kind === "helper" && record.parent === host.pid)
      .map((record) => record.pid),
  ];
  assert.equal(pids.length, 2, "Include the service's real Windows permission helper.");
  const script = `$ErrorActionPreference='Stop';$items=@((${pids.join(",")}) | ForEach-Object {
    $p=[Diagnostics.Process]::GetProcessById($_);
    @{pid=$p.Id;rssMiB=$p.WorkingSet64/1048576;privateMiB=$p.PrivateMemorySize64/1048576}
  });ConvertTo-Json -Compress -InputObject $items`;
  const output = await execute(
    join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 15_000, env: { ...process.env, TEMP: scratch, TMP: scratch } },
  );
  const processes = JSON.parse(output.stdout);
  return {
    processes: processes.map((entry) => ({
      role: entry.pid === host.pid ? "host" : "permission-helper",
      rssMiB: round(entry.rssMiB),
      privateMiB: round(entry.privateMiB),
    })),
    rssMiB: round(processes.reduce((sum, entry) => sum + entry.rssMiB, 0)),
    privateMiB: round(processes.reduce((sum, entry) => sum + entry.privateMiB, 0)),
    workerInitializations: records.filter(
      (record) => record.kind === "ready" && record.pid === host.pid,
    ).length,
  };
}
try {
  assert.equal(process.platform, "win32", "Do not label Windows RSS collection as POSIX evidence.");
  await writeFile(
    preload,
    `import cp from "node:child_process";
import wt from "node:worker_threads";
import {appendFileSync} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const record=value=>appendFileSync(${JSON.stringify(journal)},JSON.stringify({root:${JSON.stringify(root)},...value})+"\\n");
const spawn=cp.spawn;
cp.spawn=(program,args=[],options={})=>{
  const host=program===process.execPath && args[0]===${JSON.stringify(main)};
  const helper=program.toLowerCase().endsWith("\\\\windowspowershell\\\\v1.0\\\\powershell.exe");
  const child=spawn(program,host?["--import",${JSON.stringify(pathToFileURL(preload).href)},...args]:args,options);
  if(host||helper)child.once("spawn",()=>record({kind:host?"host":"helper",pid:child.pid,parent:process.pid,directory:host?args[1]:null}));
  return child;
};
const Worker=wt.Worker;
wt.Worker=class extends Worker{
  constructor(...args){super(...args);this.on("message",message=>{
    if(message.type==="ready")record({kind:"ready",pid:process.pid,threadId:this.threadId});
  })}
};
syncBuiltinESMExports();`,
  );
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source);
  await cp(
    join(repository, "packages", "objective-monorepo-standard", "package-standard"),
    join(source, "objective"),
    { recursive: true },
  );
  const files = {
    "package.json": JSON.stringify({ name: "independent-target", private: true }),
    "README.md": "# Independent",
    "pnpm-workspace.yaml": "packages: [packages/*]",
    "turbo.json": JSON.stringify({
      tasks: { build: { outputs: ["dist/**"], dependsOn: ["^build"] }, check: { outputs: [] } },
    }),
    "packages/shared/package.json": JSON.stringify({
      name: "shared",
      private: true,
      scripts: { build: "MUST_NOT_EXECUTE", check: "MUST_NOT_EXECUTE" },
    }),
    "packages/shared/README.md": "# Shared",
    "packages/shared/src/index.ts": "export const value = 1;",
    ".pguide/config.jsonc": JSON.stringify({
      "pilot.reportsEnabled": false,
      "cli-core.stateDirectory": join(root, "state"),
    }),
  };
  for (const [name, text] of Object.entries(files)) {
    const path = join(target, ...name.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, text);
  }
  const git = async (...args) =>
    (await execute("git", ["-C", source, ...args], { windowsHide: true })).stdout.trim();
  await git("init", "-q");
  await git("config", "user.name", "Fixture");
  await git("config", "user.email", "fixture@example.invalid");
  await git("add", ".");
  await git("commit", "-qm", "Fixed real checker measurement input");
  const revision = await git("rev-parse", "HEAD");
  const subject = {
    root: target,
    directory: "packages/shared",
    roles: ["internal"],
    runtime: "universal",
    allows: [],
    entries: ["src/index.ts"],
    generated: [],
    joins: [],
    deliveries: [],
  };
  const subjectFile = join(root, "subject.json");
  await writeFile(subjectFile, JSON.stringify(subject));
  const artifact = await readArtifact(join(source, "objective", "checks", "structure"));
  const baselineScript = join(root, "baseline.cjs");
  await writeFile(
    baselineScript,
    `const worker=require(process.argv[2]);
(async()=>{
let text="";for await(const chunk of process.stdin)text+=chunk;
await worker.initialize?.();
const result=await worker.execute(JSON.parse(text),{
signal:new AbortController().signal,defer:()=>{},data:{resolutions:[]},deadline:Date.now()+30000,progress:()=>{}
});
await worker.dispose?.();console.log(JSON.stringify({result,rssMiB:process.memoryUsage().rss/1048576}));
})().catch(error=>{console.error(error);process.exitCode=1});`,
  );
  const baseline = [];
  for (let n = 0; n < 7; n++) {
    const started = performance.now();
    const child = spawn(
      process.execPath,
      [baselineScript, join(artifact.directory, "worker.cjs")],
      {
        windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: "" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    try {
      const code = await new Promise((done, reject) => {
        child.once("error", reject);
        child.once("close", done);
        child.stdin.end(JSON.stringify(subject));
      });
      assert.equal(code, 0, stderr);
      const value = JSON.parse(stdout);
      assert.equal(value.result.payload.ok, true);
      baseline.push({ ms: round(performance.now() - started), rssMiB: round(value.rssMiB) });
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }
  const invoke = async (directory) => {
    const started = performance.now();
    const result = await execute(
      process.execPath,
      [
        join(repository, "packages", "pguide-pilot", "dist", "bin", "probe.js"),
        "--pilot",
        `git+${pathToFileURL(source).href}#objective/`,
        "--revision",
        revision,
        "--subject-file",
        subjectFile,
        "--cwd",
        target,
        "--format",
        "json",
      ],
      {
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
          PGUIDE_CHECK_HOST_DIRECTORY: directory,
          HOME: join(root, "home"),
          APPDATA: join(root, "config"),
          XDG_CONFIG_HOME: join(root, "config"),
        },
      },
    );
    const ms = round(performance.now() - started);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.status, 200, result.stdout);
    assert.equal(envelope.payload.current.levelId, "standardized", result.stdout);
    const client = await connectHost(directory);
    assert.equal(new URL(client.address.endpoint).hostname, "127.0.0.1");
    const owned = (await entries()).filter(
      (record) => record.kind === "host" && record.directory === directory,
    );
    assert.equal(owned.length, 1);
    assert.equal(client.address.pid, owned[0].pid);
    return { ms, memory: await memory(directory) };
  };
  const shared = await createPrivateDirectory(root, "shared-");
  hosts.add(shared);
  const cold = await invoke(shared);
  const fresh = [];
  for (let n = 0; n < 3; n++) {
    const directory = await createPrivateDirectory(root, "fresh-");
    hosts.add(directory);
    fresh.push(await invoke(directory));
    await stop(directory);
    hosts.delete(directory);
  }
  const hot = [];
  for (let n = 0; n < 6; n++) hot.push(await invoke(shared));
  const rssBudgetMiB = round(cold.memory.rssMiB * 2);
  assert.ok(hot.every(({ memory }) => memory.rssMiB <= rssBudgetMiB));
  assert.ok(hot.every(({ memory }) => memory.workerInitializations === 2));
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        artifactRevision: artifact.revision,
        inputBytes: Buffer.byteLength(JSON.stringify(subject)),
        fixture: "unmodified real package-standard Objective, structure and deliveries",
        baseline: {
          scope: "fresh Node process + real checker only, no CLI/Git/discovery",
          samples: baseline,
          medianMs: round(median(baseline.map(({ ms }) => ms))),
        },
        endToEnd: {
          scope: "real probe CLI + Git binding + discovery + authenticated HTTP + real checker",
          order: "process baseline, shared cold, three fresh-service CLIs, six shared hot CLIs",
          cold,
          freshService: fresh,
          freshServiceMedianMs: round(median(fresh.map(({ ms }) => ms))),
          sharedHot: hot,
          sharedHotMedianMs: round(median(hot.map(({ ms }) => ms))),
          rssBudgetMiB,
          rssBudgetBasis:
            "2x observed cold full-service RSS; short-run growth guard, not a leak SLA",
        },
      },
      null,
      2,
    ),
  );
} finally {
  for (const directory of hosts) await stop(directory);
  await closePrivateFileBackend();
  const records = await entries();
  await waitGone(
    records
      .filter((record) => record.kind === "host" || record.kind === "helper")
      .map(({ pid }) => pid),
  );
  for (const [name, value] of Object.entries(previousTemp)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
