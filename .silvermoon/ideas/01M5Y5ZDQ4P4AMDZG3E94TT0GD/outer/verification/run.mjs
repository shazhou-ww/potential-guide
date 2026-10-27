import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { platform, release } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CoordinatorModel as M, RequestModel as R } from "@potential-guide/regulation-coordinator";
import { alive, command, limits, readJson, writeJson } from "./fixture.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const profile = join(root, "profile");
const operationsPath = join(profile, "workers", "operations.jsonl");
const hosts = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const startedAt = new Date().toISOString();
let sequence = 0;
function operations() {
  try {
    return readFileSync(operationsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function until(get, predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await get();
    if (predicate(value)) return value;
    assert.ok(Date.now() < deadline, `等待超时：${label}`);
    await sleep(30);
  }
}
async function host(epoch) {
  const child = spawn(process.execPath, [join(root, "host.mjs"), profile], {
    cwd: root, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  const pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", () => {});
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      readyReject(new Error(`Host ${epoch} 提前退出：${code}/${signal}\n${stderr}`));
      for (const waiter of pending.values()) waiter.reject(new Error(`Host 已退出：${stderr}`));
      pending.clear();
      resolve({ code, signal });
    });
  });
  child.on("message", (message) => {
    if (message.type === "ready") {
      readyResolve(message);
      return;
    }
    const waiter = pending.get(message.id);
    assert.ok(waiter, "Host 响应必须匹配请求");
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error));
    else waiter.resolve(message.value);
  });
  const item = {
    child, exit, epoch,
    request(type, properties = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Host 消息超时：${type}`));
        }, 8000);
        pending.set(id, { resolve, reject, timer });
        child.send({ id, type, ...properties });
      });
    },
  };
  hosts.push(item);
  const startupTimer = setTimeout(() => readyReject(new Error(`Host ${epoch} 未能启动：${stderr}`)), 8000);
  try {
    item.ready = await ready;
  } finally {
    clearTimeout(startupTimer);
  }
  assert.deepEqual(item.ready.diagnostics, []);
  return item;
}
async function inspect(item) {
  const state = await item.request("snapshot");
  assert.deepEqual(state.diagnostics, []);
  return state;
}
function active(snapshot) {
  return M.runViews(snapshot.state).filter(({ phase }) => phase !== "ended");
}
async function workerStarted(runId) {
  return until(async () => operations(), (entries) =>
    entries.some((entry) => entry.type === "start" && entry.runId === runId), "实际 worker 启动");
}

let result;
try {
  const entries = {};
  for (const name of ["@potential-guide/regulation-coordinator", "@potential-guide/effects"]) {
    const path = realpathSync(fileURLToPath(import.meta.resolve(name)));
    const inside = relative(root, path);
    assert.ok(!inside.startsWith(`..${sep}`) && !inside.includes(`${sep}packages${sep}`));
    entries[name] = inside;
  }
  const compiler = spawnSync(process.execPath, [
    join(root, "node_modules", "typescript", "bin", "tsc"),
    "-p", join(root, "tsconfig.json"), "--pretty", "false",
  ], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(compiler.status, 0, compiler.stdout + compiler.stderr);
  const config = readJson(join(root, "tsconfig.json"));
  assert.equal(config.compilerOptions.paths, undefined);
  const inventory = readJson(join(root, "package-inventory.json"));
  const lockfile = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  for (const name of ["@potential-guide/objective-portfolio-supervisor", "@potential-guide/pguide-supervise"]) {
    assert.ok(!inventory.some((entry) => entry.name === name));
    assert.ok(!lockfile.includes(name), `安装 lockfile 中仍有退役包：${name}`);
  }
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("pguide/package.json")), "dist", "bin.js");
  const settings = {
    ...process.env, PATH: "",
    HOME: join(root, "isolated-home"),
    USERPROFILE: join(root, "isolated-home"),
    APPDATA: join(root, "isolated-config"),
    XDG_CONFIG_HOME: join(root, "isolated-config"),
  };
  const cliResults = [];
  for (const args of [
    ["supervise", "--format", "json"],
    ["--help"],
    ["complete", "--shell", "powershell"],
    ["regulate", "--help"],
    ["continue", "--help"],
    ["probe", "--help"],
  ]) {
    const execution = spawnSync(process.execPath, [cli, ...args], {
      cwd: root, env: settings, encoding: "utf8", windowsHide: true,
    });
    const text = execution.stdout + execution.stderr;
    if (args[0] === "supervise") {
      assert.equal(execution.status, 2, text);
      assert.match(text, /Unknown command.*supervise/u);
      assert.doesNotMatch(text, /pguide-supervise|npm install|pnpm add/u);
    } else {
      assert.equal(execution.status, 0, text);
      assert.doesNotMatch(text, /pguide-supervise|supervise\.agentTimeoutMs/u);
      if (args[0] === "--help" || args[0] === "complete") assert.doesNotMatch(text, /\bsupervise\b/u);
    }
    cliResults.push({ args, exit: execution.status, output: execution.stdout, stderr: execution.stderr });
  }
  mkdirSync(profile);
  let input = R.reduceRegulationRequests(command("periodic-root", true), R.createRegulationRequests());
  writeJson(join(profile, "input.json"), input);

  const first = await host("initial");
  const firstRun = active(first.ready)[0];
  assert.ok(firstRun);
  assert.equal(firstRun.run.requestRef, "periodic-root");
  await workerStarted(firstRun.run.id);
  await first.request("finish", {
    runId: firstRun.run.id,
    outcome: { kind: "exhausted", reason: "agent-runs", message: "本次调用额度耗尽。", usage: { agentRuns: 3 } },
  });
  const exhausted = await until(() => inspect(first), (value) => value.exhaustion.length === 1 && active(value).length === 0, "首次耗尽");
  const notification = exhausted.exhaustion[0];
  const replay1 = await first.request("events", { afterRevision: 0 });
  const replay2 = await first.request("events", { afterRevision: 0 });
  assert.deepEqual(replay1, replay2);
  const exhaustedFact = replay1.find((event) => event.revision === notification.revision);
  assert.equal(exhaustedFact.fact.outcome.reason, "agent-runs");
  assert.ok(Date.now() < Date.parse(notification.nextEligibleAt), "额外请求必须在下个周期前提交");
  const extraRef = `extra:${notification.id}`;
  input = R.reduceRegulationRequests(command(extraRef, false), input);
  writeJson(join(profile, "input.json"), input);
  await first.request("update", { requests: input });
  await first.request("update", { requests: input });
  const extra = await until(() => inspect(first), (value) =>
    active(value).some(({ run }) => run.requestRef === extraRef), "额外一次性请求");
  const extraRun = active(extra).find(({ run }) => run.requestRef === extraRef);
  await workerStarted(extraRun.run.id);
  assert.equal(operations().filter((entry) => entry.type === "start" && entry.requestRef === extraRef).length, 1);
  assert.ok(!M.requestClosed(extra.state, notification.successorRequestRef));
  await first.request("finish", { runId: extraRun.run.id, outcome: { kind: "target-reached" } });
  await until(() => inspect(first), (value) => M.requestClosed(value.state, extraRef), "额外请求完成");

  const beforeCrash = await until(() => inspect(first), (value) =>
    active(value).some(({ run }) => run.requestRef === notification.successorRequestRef), "周期后继启动");
  const ongoing = active(beforeCrash)[0].run;
  await workerStarted(ongoing.id);
  const externalWorker = operations().find((entry) => entry.type === "start" && entry.runId === ongoing.id);
  const startsBeforeCrash = operations().filter((entry) => entry.type === "start").length;
  assert.ok(first.child.kill("SIGKILL"));
  const crashed = await first.exit;
  assert.ok(crashed.code !== 0 || crashed.signal !== null);
  assert.ok(alive(externalWorker.pid), "Host 退出后外部执行仍然存活");

  const second = await host("recovered");
  assert.notEqual(second.child.pid, first.child.pid);
  assert.equal(active(second.ready).length, 1);
  assert.equal(active(second.ready)[0].run.id, ongoing.id);
  assert.equal(second.ready.recoveries[0].workerPid, externalWorker.pid);
  assert.deepEqual(active(second.ready)[0].run.limits, ongoing.limits);
  assert.equal(operations().filter((entry) => entry.type === "start").length, startsBeforeCrash);
  M.restoreCoordinatorState(readJson(join(profile, "coordinator-state.json")));
  await second.request("finish", {
    runId: ongoing.id,
    outcome: { kind: "exhausted", reason: "stall-runs", message: "本次执行未继续取得进展。", usage: { stallRuns: 2 } },
  });
  const resumedEnd = await until(() => inspect(second), (value) =>
    value.exhaustion.length === 2 && active(value).length === 0, "恢复后的原 Run 终结");
  const replayAfterRestart = await second.request("events", { afterRevision: 0 });
  assert.ok(replayAfterRestart.some((event) => event.revision === notification.revision));
  assert.equal(resumedEnd.exhaustion[0].id, notification.id);
  assert.equal(operations().filter((entry) => entry.type === "start" && entry.runId === ongoing.id).length, 1);
  const successor = resumedEnd.exhaustion[1];
  const cancelled = await second.request("cancel", { requestRef: "periodic-root" });
  assert.ok(cancelled.state.requests.requests.filter((request) => request.ref !== extraRef)
    .every((request) => M.requestCancelled(cancelled.state, request.ref)));
  const countAtStop = operations().filter((entry) => entry.type === "start").length;
  await sleep(Math.max(150, Date.parse(successor.nextEligibleAt) - Date.now() + 150));
  const afterDeadline = await inspect(second);
  assert.equal(active(afterDeadline).length, 0);
  assert.equal(operations().filter((entry) => entry.type === "start").length, countAtStop);
  await second.request("shutdown");
  assert.equal((await second.exit).code, 0);

  const third = await host("stopped-restart");
  await sleep(150);
  const final = await inspect(third);
  assert.equal(active(final).length, 0);
  assert.equal(final.state.revision, afterDeadline.state.revision);
  assert.equal(operations().filter((entry) => entry.type === "start").length, countAtStop);
  await third.request("shutdown");
  assert.equal((await third.exit).code, 0);
  const log = operations();
  const occupied = new Set();
  for (const entry of log) {
    if (entry.type === "start") {
      assert.equal(occupied.size, 0, "同 Target 实际执行不能重叠");
      occupied.add(entry.runId);
    } else {
      assert.ok(occupied.delete(entry.runId), "退出必须对应已启动执行");
    }
  }
  assert.equal(occupied.size, 0);
  assert.equal(countAtStop, 3);
  const pids = [...new Set(log.map(({ pid }) => pid))];
  assert.ok(pids.every((pid) => !alive(pid)));
  assert.ok(hosts.every(({ child }) => !alive(child.pid)));
  result = {
    verifiedContractCommit: process.argv[2],
    startedAt, finishedAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), release: release(), typescript: readJson(join(root, "node_modules", "typescript", "package.json")).version },
    packages: inventory,
    consumer: {
      entries, noSourceAliases: true, typecheckExit: compiler.status,
      coordinatorClosure: readJson(join(root, "coordinator-closure.json")),
      retiredPackagesAbsent: true, cliResults,
    },
    hostEpochs: hosts.map(({ epoch, child }) => ({ epoch, pid: child.pid })),
    notifications: final.exhaustion,
    replay: { identicalInitialReads: true, originalEventVisibleAfterRestart: true, deduplicatedExtraRequestRef: extraRef },
    recovery: { runId: ongoing.id, workerPid: externalWorker.pid, startsBeforeCrash, startsAfterRecovery: startsBeforeCrash, limits },
    cancellation: { observedAfter: new Date().toISOString(), nextEligibleAt: successor.nextEligibleAt, stoppedRevision: afterDeadline.state.revision, restartedRevision: final.state.revision },
    requests: final.state.requests.requests.map((request) => ({
      ...request, locallyClosed: M.requestClosed(final.state, request.ref), cancelled: M.requestCancelled(final.state, request.ref),
    })),
    runs: M.runViews(final.state),
    operations: log,
    assertions: { workerStarts: 3, workerEnds: 3, noTargetOverlap: true, noRemainingProcesses: true, noAutomaticQuotaContinuation: true },
  };
} finally {
  for (const { child, exit } of hosts) {
    if (alive(child.pid)) child.kill("SIGKILL");
    await exit;
  }
  for (const pid of new Set(operations().map((entry) => entry.pid))) {
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
}
writeJson(join(root, "verification-results.json"), result);
console.log(JSON.stringify({ passed: true, hostEpochs: result.hostEpochs.length, workerStarts: result.assertions.workerStarts, typecheckExit: result.consumer.typecheckExit }));
