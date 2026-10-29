import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpath, readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { at, isTimedOut } from "@potential-guide/task-protocol";
import { newId } from "@potential-guide/task-engine";
import { bounded, epoch } from "./support.mjs";
import { verifyCore } from "./core.mjs";

const root = process.cwd();
const repository = resolve(process.argv[2]);
const planRevision = process.argv[3];
assert.equal(process.env.NODE_PATH, undefined);
assert.equal(process.env.NODE_OPTIONS, undefined);
assert.equal(process.execArgv.length, 0);
const checks = [], children = [], streams = [], hostPorts = [];
const report = {
  schemaVersion: 1, planRevision, node: process.version, platform: process.platform,
  operationRoot: root, checks, modules: [], cleanup: { children: [], portsClosed: [], streamsClosed: false },
};
const within = (parent, child) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
const record = (name, facts) => { checks.push({ name, passed: true, facts }); };
for (const name of ["@potential-guide/task-protocol", "@potential-guide/task-engine", "@potential-guide/task-engine/pool", "@potential-guide/task-engine/testing",
  "@potential-guide/task-engine-http", "@potential-guide/task-engine-storage"]) {
  const path = await realpath(fileURLToPath(import.meta.resolve(name)));
  assert.ok(within(root, path));
  assert.equal(within(repository, path), false);
  report.modules.push({ name, realpath: path });
}
for (const name of ["task-protocol", "task-engine", "task-engine-http", "task-engine-storage"]) {
  const modulePath = fileURLToPath(import.meta.resolve(`@potential-guide/${name}`));
  const manifest = JSON.parse(await readFile(join(dirname(modulePath), "..", "package.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), name === "task-protocol" ? [] : ["@potential-guide/task-protocol"]);
}
record("installation:external-realpaths", { modules: report.modules.length, noWorkspaceSourceOrLoaders: true });
function childProcess(file, args = [], env = {}) {
  const child = fork(join(root, file), args, {
    cwd: root, silent: true, execArgv: [],
    env: { ...process.env, ...env },
  });
  const messages = [];
  const waiters = [];
  const pending = new Map();
  let counter = 0, stderr = "";
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-8192); });
  child.on("message", message => {
    if (message?.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(Object.assign(Error(message.error.message), { code: message.error.code }));
      else resolve(message.result);
    } else if (waiters.length) waiters.shift()(message);
    else messages.push(message);
  });
  const exited = new Promise(resolveExit => child.once("exit", (code, signal) => {
    for (const { reject } of pending.values()) reject(Error(`子进程退出: ${code}/${signal}; ${stderr}`));
    pending.clear();
    resolveExit({ pid: child.pid, code, signal });
  }));
  const handle = {
    child, exited,
    next: () => bounded(messages.length ? Promise.resolve(messages.shift()) : new Promise(resolveMessage => waiters.push(resolveMessage)), `${file} 握手`),
    rpc: (action, values = {}) => bounded(new Promise((resolveResult, reject) => {
      const id = ++counter;
      pending.set(id, { resolve: resolveResult, reject });
      child.send({ id, action, ...values });
    }), `${file}:${action}`),
    async kill() { if (child.exitCode === null && child.signalCode === null) child.kill(); return bounded(exited, `${file} exit`); },
  };
  children.push(handle);
  return handle;
}
async function portClosed(port) {
  await bounded(new Promise((resolveCheck, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); reject(Error(`端口仍在监听: ${port}`)); });
    socket.once("error", error => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolveCheck();
      else reject(error);
    });
  }), "端口已释放");
  report.cleanup.portsClosed.push(port);
}
async function host(database, now, version = "1") {
  const credentials = { a: randomBytes(24).toString("hex"), b: randomBytes(24).toString("hex") };
  const process = childProcess("host.mjs", [database, String(now), version], { DEPLOYMENT_CREDENTIALS: JSON.stringify(credentials) });
  const ready = await process.next();
  assert.equal(ready.ready, true);
  for (const entry of ready.modules) {
    const path = await realpath(fileURLToPath(entry.resolved));
    assert.ok(within(root, path) && !within(repository, path));
  }
  hostPorts.push(ready.port);
  const request = async (path, { method = "GET", body, requestId, scope = "a", auth = true, headers = {} } = {}) => {
    const response = await fetch(`${ready.url}${path}`, {
      method,
      headers: {
        ...(auth ? { Authorization: `Bearer ${credentials[scope]}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(requestId ? { "Idempotency-Key": requestId } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, data: await response.json() };
  };
  const readyResponse = await request(`/tasks/${newId()}`, { auth: false });
  assert.equal(readyResponse.status, 401);
  record("http:ready", { pid: ready.pid, port: ready.port, unauthenticated: 401, currentVersion: version });
  const submit = async (body, requestId = newId()) => {
    const response = await request("/tasks", { method: "POST", body, requestId });
    assert.equal(response.status, 202, JSON.stringify(response.data));
    return { snapshot: response.data, body, requestId };
  };
  const task = async id => {
    const response = await request(`/tasks/${id}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  const subscribe = async (taskId, cursor) => {
    const abort = new AbortController();
    const response = await fetch(`${ready.url}/events?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${credentials.a}`, ...(cursor ? { "Last-Event-ID": cursor } : {}) },
      signal: abort.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let text = "";
    const stream = {
      async next() {
        while (!text.includes("\n\n")) {
          const chunk = await bounded(reader.read(), "SSE frame");
          assert.equal(chunk.done, false);
          text += decoder.decode(chunk.value, { stream: true });
        }
        const index = text.indexOf("\n\n"), frame = text.slice(0, index);
        text = text.slice(index + 2);
        const id = /^id: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        assert.ok(id && data);
        return { id, observation: JSON.parse(data) };
      },
      async close() { await reader.cancel().catch(() => {}); abort.abort(); },
    };
    streams.push(stream);
    return stream;
  };
  return { process, request, submit, task, subscribe, ready };
}

try {
  await verifyCore(record);
  const database = join(root, "tasks.sqlite");
  let live = await host(database, epoch);
  const ended = await live.submit({ type: "echo", text: "ended", timeoutMs: 100 });
  const unknown = await live.submit({ type: "echo", text: "unknown", timeoutMs: 1000 });
  const future = await live.submit({ type: "echo", text: "future", timeoutMs: 100, eligibleAt: at(epoch + 500) });
  await live.process.rpc("turn", { ms: 1 });
  assert.equal((await live.task(unknown.snapshot.taskId)).stage, "running");
  const denied = await live.request(`/tasks/${unknown.snapshot.taskId}`, { scope: "b" });
  assert.equal(denied.status, 403);
  const stream = await live.subscribe(unknown.snapshot.taskId);
  const first = await stream.next();
  const page = await live.request(`/event-history?taskId=${unknown.snapshot.taskId}&limit=1`);
  assert.equal(page.status, 200);
  assert.ok(page.data.next);
  await live.process.rpc("progress", { text: "unknown", marker: "after-watermark" });
  const secondPage = await live.request(`/event-history?taskId=${unknown.snapshot.taskId}&cursor=${encodeURIComponent(page.data.next)}`);
  assert.equal(secondPage.status, 200);
  assert.ok(secondPage.data.events.every(event => event.sequence <= page.data.watermark));
  await stream.close();
  await live.process.rpc("streamsIdle");
  assert.equal((await live.task(unknown.snapshot.taskId)).canceledAt, undefined);
  const resumed = await live.subscribe(unknown.snapshot.taskId, first.id);
  const replay = await resumed.next();
  assert.ok(replay.observation.events.some(event => event.type === "execution.progress" && event.data.progress.marker === "after-watermark"));
  assert.equal(new Set(replay.observation.events.map(event => event.sequence)).size, replay.observation.events.length);
  await resumed.close(); await live.process.rpc("streamsIdle");
  record("http:sse-history-auth", { unauthorized: 401, crossScope: 403, fixedWatermark: true, replayedProgress: true, disconnectCanceledTask: false });
  const competitor = childProcess("probe.mjs", [database, "store_owned"]);
  assert.deepEqual(await competitor.next(), { expectedCode: "store_owned", actual: "store_owned", closed: true });
  assert.equal((await competitor.exited).code, 0);
  record("sqlite:second-process-owner-denied", { code: "store_owned" });
  const late = await live.submit({ type: "echo", text: "late", timeoutMs: 5 });
  await live.process.rpc("turn", { ms: 1 });
  await live.process.rpc("turn", { ms: 5 });
  assert.equal((await live.task(late.snapshot.taskId)).stage, "running");
  assert.ok(isTimedOut(await live.task(late.snapshot.taskId)));
  await live.process.rpc("finish", { text: "late", result: { text: "late final" } });
  assert.ok(isTimedOut(await live.task(late.snapshot.taskId)));
  await live.process.rpc("turn", { ms: 0 });
  const lateFinal = await live.task(late.snapshot.taskId);
  assert.equal(lateFinal.stage, "completed");
  assert.ok(isTimedOut(lateFinal));
  assert.deepEqual(lateFinal.result, { text: "late final" });
  await live.process.rpc("collect");
  assert.equal((await live.task(unknown.snapshot.taskId)).stage, "running");
  record("http:late-result-and-protected-retention", { runningTimedOut: true, completedTimedOut: true, activeHistoryRetained: true });
  await live.process.rpc("finish", { text: "ended", result: { text: "durable ended" } });
  const lagging = await live.task(ended.snapshot.taskId);
  assert.equal(lagging.stage, "running");
  assert.ok(lagging.execution.completedAt);
  assert.equal(lagging.termination, undefined);
  const firstPid = live.ready.pid;
  const stopped = await live.process.kill();
  assert.equal(stopped.pid, firstPid);
  await portClosed(live.ready.port);
  live = await host(database, epoch + 20, "2");
  const restoredEnd = await live.task(ended.snapshot.taskId);
  const restoredUnknown = await live.task(unknown.snapshot.taskId);
  const restoredFuture = await live.task(future.snapshot.taskId);
  assert.equal(restoredEnd.stage, "completed");
  assert.deepEqual(restoredEnd.result, { text: "durable ended" });
  assert.equal(isTimedOut(restoredEnd), false);
  assert.equal(restoredUnknown.stage, "execution_failed");
  assert.equal(restoredUnknown.error.code, "execution_interrupted");
  assert.equal(restoredFuture.stage, "initial");
  assert.equal(restoredFuture.eligibleAt, future.snapshot.eligibleAt);
  assert.equal(restoredFuture.deadlineAt, future.snapshot.deadlineAt);
  assert.ok(isTimedOut(await live.task(late.snapshot.taskId)));
  assert.deepEqual((await live.process.rpc("stats")).starts, []);
  const retry = await live.submit(unknown.body, unknown.requestId);
  assert.equal(retry.snapshot.taskId, unknown.snapshot.taskId);
  assert.deepEqual((await live.request(`/requests/${unknown.requestId}`)).data, { ...unknown.body, requestId: unknown.requestId });
  const oldHistory = await live.request(`/event-history?taskId=${unknown.snapshot.taskId}`);
  assert.equal(oldHistory.data.events.find(event => event.type === "task.created").data.task.binding.version, "1");
  const newer = await live.submit({ type: "echo", text: "v2:new", timeoutMs: 100 });
  const newHistory = await live.request(`/event-history?taskId=${newer.snapshot.taskId}`);
  assert.equal(newHistory.data.events.find(event => event.type === "task.created").data.task.binding.version, "2");
  const canceled = await live.request(`/tasks/${newer.snapshot.taskId}/cancel`, { method: "POST" });
  assert.equal(canceled.status, 200);
  assert.ok(canceled.data.canceledAt);
  await live.process.rpc("turn", { ms: 481 });
  const stats = await live.process.rpc("stats");
  assert.deepEqual(stats.starts.map(item => item.text), ["future"]);
  assert.equal(stats.preparation[0].version, "1");
  await live.process.rpc("finish", { text: "future" });
  await live.process.rpc("turn", { ms: 1 });
  assert.equal((await live.task(future.snapshot.taskId)).stage, "completed");
  record("sqlite:kill-restart-original-version", {
    oldPid: firstPid, newPid: live.ready.pid, durableFinalAdopted: true,
    unknownCode: restoredUnknown.error.code, rerunUnknown: false, originalRequestIdentity: true,
    futureOriginalDeadline: restoredFuture.deadlineAt, futureVersion: "1", newRequestVersion: "2",
  });
  const closed = await live.process.rpc("close");
  assert.deepEqual(closed, { closed: true, activeStreams: 0 });
  assert.equal((await live.process.exited).code, 0);
  await portClosed(live.ready.port);
  const unsupported = childProcess("probe.mjs", [database, "unsupported_version"]);
  assert.deepEqual(await unsupported.next(), { expectedCode: "unsupported_version", actual: "unsupported_version", closed: true });
  assert.equal((await unsupported.exited).code, 0);
  record("sqlite:missing-original-version", { code: "unsupported_version" });
  live = await host(database, epoch + 1000, "2");
  await live.process.rpc("collect");
  const expired = await live.request(`/events?taskId=${unknown.snapshot.taskId}`, {
    headers: { "Last-Event-ID": oldHistory.data.cursor },
  });
  assert.equal(expired.status, 410);
  assert.equal(expired.data.error.code, "history_expired");
  assert.deepEqual(await live.process.rpc("close"), { closed: true, activeStreams: 0 });
  assert.equal((await live.process.exited).code, 0);
  await portClosed(live.ready.port);
  record("sqlite:http-expired-cursor", { status: 410, code: "history_expired" });
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = { name: error.name, code: error.code, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  for (const stream of streams) await stream.close();
  report.cleanup.streamsClosed = true;
  for (const child of children) report.cleanup.children.push(await child.kill());
  for (const port of hostPorts) if (!report.cleanup.portsClosed.includes(port)) await portClosed(port);
  await writeFile(join(root, "consumer-result.json"), JSON.stringify(report, null, 2));
}
