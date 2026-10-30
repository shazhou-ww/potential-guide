import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { newId } from "@potential-guide/task-engine";

const proof = {
  controllerPid: process.pid,
  consumer: process.cwd(),
  checks: [],
  services: [],
  cleanup: [],
};
let child;
let exited;
let url;
let rpcId = 0;
const pending = new Map();
let now = Date.parse("2026-10-30T00:00:00.000Z");
const base = now;
const iso = (offset) => new Date(base + offset).toISOString();
const passed = (id, evidence) => proof.checks.push({ id, evidence });
function control(command, value) {
  const id = ++rpcId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`IPC 超时: ${command}`));
    }, 15_000);
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    child.send({ id, command, value });
  });
}
async function request(path, { body, client = "alpha", requestId, method, headers = {} } = {}) {
  const response = await fetch(`${url}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(client ? { "x-proof-client": client } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(requestId ? { "Idempotency-Key": requestId } : {}),
      Connection: "close",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}
async function ok(path, options) {
  const result = await request(path, options);
  assert.equal(result.status, 200, JSON.stringify(result));
  return result.body;
}
async function list(query = {}, page = {}, client = "alpha") {
  return ok(`/tasks?${new URLSearchParams({ ...query, ...page })}`, { client });
}
async function failure(path, status, code, options) {
  const result = await request(path, options);
  assert.equal(result.status, status, JSON.stringify(result));
  assert.equal(result.body.error.code, code);
  return { status: result.status, code: result.body.error.code };
}
async function until(read, predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(25);
  }
  throw new Error("HTTP/测试控制观察超时");
}
async function start(version) {
  child = fork("host.mjs", [], {
    cwd: process.cwd(),
    env: { ...process.env, PROOF_TIME: String(now), PROOF_VERSION: version },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  exited = once(child, "exit");
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors = `${errors}${chunk}`.slice(-8_000);
  });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务未 ready: ${errors}`)), 15_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`服务启动退出 ${code}: ${errors}`));
    });
    child.on("message", (message) => {
      if (message.ready) {
        clearTimeout(timer);
        resolve(message);
      } else {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(JSON.stringify(message.error)));
        else waiter?.resolve(message.result);
      }
    });
  });
  url = ready.url;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  assert.notEqual(ready.pid, process.pid);
  const discovery = await ok("/task-types");
  proof.services.push({ ...ready, version, httpReadyStatus: 200, discovery });
}
async function portClosed(address) {
  const port = Number(new URL(address).port);
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(2_000);
    socket.on("connect", () => {
      socket.destroy();
      reject(new Error(`端口未关闭: ${port}`));
    });
    socket.on("error", (error) => {
      if (error.code === "ECONNREFUSED") resolve();
      else reject(error);
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`端口检查超时: ${port}`));
    });
  });
}
async function stop() {
  if (!child) return;
  const pid = child.pid;
  const address = url;
  if (child.exitCode === null && child.signalCode === null) await control("close");
  const [code, signal] = await exited;
  assert.equal(code, 0, `服务退出: ${code}/${signal}`);
  if (address) await portClosed(address);
  proof.cleanup.push({ pid, code, signal, url: address, portClosed: true });
  child = undefined;
}
async function time(offset) {
  now = base + offset;
  await control("time", now);
}
const payload = {
  type: "echo",
  text: "shared",
  amount: 7,
  metadata: { literal: "007", nested: { untouched: true }, array: [1, "1", null] },
  timeoutMs: 600_000,
  eligibleAt: iso(150),
};
async function submit(body = payload, client = "alpha", headers = {}) {
  const requestId = newId();
  const result = await request("/tasks", { body, client, requestId, headers });
  assert.equal(result.status, 202, JSON.stringify(result));
  return result.body;
}
const ids = (page) => page.tasks.map((item) => item.taskId);
const detail = (task) => ok(`/tasks/${task.taskId}`);
async function running(task) {
  return until(
    () => detail(task),
    (value) => value.stage === "running",
  );
}
async function finish() {
  await control("finish");
  await until(
    () => control("stats"),
    (value) => value.active === 0,
  );
  await delay(100);
}
try {
  await start("1");
  const one = await submit();
  await time(100);
  const secondRequestId = newId();
  const beta = spawnSync(
    process.execPath,
    ["client.mjs", JSON.stringify({ url, body: payload, requestId: secondRequestId })],
    { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 },
  );
  assert.equal(beta.status, 0, beta.stderr);
  const second = JSON.parse(beta.stdout);
  assert.equal(second.status, 202);
  assert.notEqual(second.pid, process.pid);
  assert.notEqual(second.pid, child.pid);
  const two = second.body;
  await time(150);
  const oneRunning = await running(one);
  const twoRunning = await running(two);
  assert.equal(oneRunning.execution.executionId, twoRunning.execution.executionId);
  await time(200);
  const alternate = await submit({ ...payload, type: "alternate", text: "alternate" });
  await running(alternate);
  await time(300);
  const other = await submit({ ...payload, text: "other" }, "other");
  await until(
    () => ok(`/tasks/${other.taskId}`, { client: "other" }),
    (v) => v.stage === "running",
  );
  const initial = await list();
  assert.deepEqual(ids(initial), [alternate.taskId, two.taskId, one.taskId]);
  assert.deepEqual(ids(await list({}, {}, "beta")), ids(initial));
  assert.deepEqual(ids(await list({}, {}, "other")), [other.taskId]);
  passed("跨进程客户端共享 scope；异 scope 不可见", {
    alphaPid: process.pid,
    betaPid: second.pid,
    betaExitCode: beta.status,
    sharedTaskIds: ids(initial),
    otherTaskId: other.taskId,
    executionId: oneRunning.execution.executionId,
  });
  await time(400);
  await control("progress", {
    executionId: oneRunning.execution.executionId,
    progress: { percent: 1 },
  });
  const shared = await list({ type: "echo" });
  assert.ok(shared.tasks.every((v) => v.updatedAt === iso(400) && v.state.stage === "running"));
  const intersection = {
    type: "echo",
    createdFrom: iso(0),
    createdBefore: iso(200),
    updatedFrom: iso(400),
    updatedBefore: iso(401),
  };
  assert.deepEqual(ids(await list(intersection)), [two.taskId, one.taskId]);
  assert.deepEqual(ids(await list({ ...intersection, createdBefore: iso(100) })), [one.taskId]);
  assert.deepEqual(ids(await list({ ...intersection, createdFrom: iso(100) })), [two.taskId]);
  assert.deepEqual(
    ids(await list({ ...intersection, updatedFrom: iso(401), updatedBefore: iso(402) })),
    [],
  );
  assert.deepEqual(
    ids(await list({ ...intersection, updatedFrom: iso(399), updatedBefore: iso(400) })),
    [],
  );
  assert.deepEqual(ids(await list({ ...intersection, type: "alternate" })), []);
  const offsetQuery = { ...intersection, createdFrom: "2026-10-30T08:00:00.000+08:00" };
  assert.deepEqual(ids(await list(offsetQuery)), [two.taskId, one.taskId]);
  passed("type/created/updated AND、双时间左闭右开、时区和自身新进度", {
    intersection,
    shared: shared.tasks,
  });
  const query = { sort: "updated-desc" };
  const frozen = await list(query);
  const first = await list(query, { limit: 1 });
  assert.ok(first.next);
  assert.deepEqual(first.tasks, frozen.tasks.slice(0, 1));
  assert.deepEqual(ids(frozen).slice(0, 2), [one.taskId, two.taskId].sort());
  await time(500);
  await ok(`/tasks/${one.taskId}/cancel`, { method: "POST" });
  await time(600);
  await control("progress", {
    executionId: oneRunning.execution.executionId,
    progress: { percent: 2 },
  });
  await time(700);
  const later = await submit({ ...payload, text: "later" });
  await running(later);
  const seen = [...first.tasks];
  const continuations = [];
  let page = first;
  while (page.next) {
    const cursor = page.next;
    page = await list(query, { cursor, limit: 1 });
    continuations.push(cursor);
    assert.deepEqual(await list(query, { cursor, limit: 1 }), page);
    assert.equal(page.observedAt, first.observedAt);
    assert.equal(page.expiresAt, first.expiresAt);
    seen.push(...page.tasks);
  }
  assert.deepEqual(seen, frozen.tasks);
  const fresh = await list(query);
  assert.equal(fresh.tasks.length, 4);
  assert.equal(fresh.tasks[0].taskId, later.taskId);
  assert.equal(fresh.tasks.find((v) => v.taskId === two.taskId).updatedAt, iso(600));
  const canceled = fresh.tasks.find((v) => v.taskId === one.taskId);
  assert.equal(canceled.updatedAt, iso(500));
  assert.equal(canceled.state.canceled, true);
  passed("本轮成员/顺序/完整摘要固定；重查纳入新增与更新；取消不跟随共享进度", {
    frozen: seen,
    fresh: fresh.tasks,
  });
  for (const summary of fresh.tasks) {
    assert.deepEqual(Object.keys(summary).sort(), [
      "receivedAt",
      "requestId",
      "seriesId",
      "state",
      "taskId",
      "type",
      "updatedAt",
      "version",
    ]);
  }
  const raw = await ok(`/requests/${one.requestId}`, { client: "beta" });
  assert.deepEqual(raw, { ...payload, requestId: one.requestId });
  assert.equal(Object.hasOwn(raw, "version"), false);
  assert.equal(Object.hasOwn(raw, "expectedRevision"), false);
  const reopened = await ok(`/tasks/${one.taskId}`, { client: "beta" });
  assert.equal(reopened.requestId, one.requestId);
  assert.equal(reopened.seriesId, one.seriesId);
  const discovery = await ok("/task-types");
  assert.equal(discovery.find((v) => v.type === "echo").version, "1");
  assert.deepEqual(discovery.find((v) => v.type === "echo").inputSchema.properties.metadata, {
    type: "object",
  });
  const { requestId: _oldIdentity, ...redoBody } = raw;
  const redo = await submit(redoBody, "beta");
  assert.notEqual(redo.requestId, one.requestId);
  assert.notEqual(redo.taskId, one.taskId);
  assert.deepEqual(await ok(`/requests/${redo.requestId}`), {
    ...redoBody,
    requestId: redo.requestId,
  });
  const invalidInput = await failure("/tasks", 400, "invalid_input", {
    body: { ...payload, amount: "7" },
    requestId: newId(),
  });
  passed("目录进入详情/原请求；原始输入和无版本保留；新身份重做及 Schema 共存", {
    original: raw,
    detail: reopened,
    redo: { taskId: redo.taskId, requestId: redo.requestId },
    invalidInput,
  });
  const auth = [];
  auth.push(await failure("/tasks", 401, "unauthenticated", { client: "" }));
  auth.push(await failure("/tasks", 403, "forbidden", { client: "denied" }));
  assert.equal((await list({}, {}, "reader")).tasks.length, 5);
  auth.push(await failure(`/requests/${one.requestId}`, 403, "forbidden", { client: "reader" }));
  auth.push(await failure("/task-types", 403, "forbidden", { client: "reader" }));
  assert.equal((await detail(one)).taskId, one.taskId);
  let authorizedPage = await list({}, { limit: 1 });
  let deniedPages = 0;
  while (authorizedPage.next) {
    const path = `/tasks?${new URLSearchParams({ cursor: authorizedPage.next, limit: "1" })}`;
    await control("revoke", { client: "alpha", operation: "list", denied: true });
    auth.push(await failure(path, 403, "forbidden"));
    deniedPages++;
    await control("revoke", { client: "alpha", operation: "list", denied: false });
    authorizedPage = await ok(path);
  }
  assert.equal(deniedPages, 4);
  passed("独立 list/request/discovery 权限；每次续页撤权均拒绝", { auth, deniedPages });
  const valid = await list({}, { limit: 1 });
  const cursorPath = (cursor, extra = {}) => `/tasks?${new URLSearchParams({ cursor, ...extra })}`;
  const badCursors = [];
  badCursors.push(await failure(cursorPath("broken"), 400, "invalid_cursor"));
  const tampered = `${valid.next.slice(0, -1)}${valid.next.endsWith("A") ? "B" : "A"}`;
  badCursors.push(await failure(cursorPath(tampered), 400, "invalid_cursor"));
  badCursors.push(await failure(cursorPath(valid.next, { type: "echo" }), 400, "invalid_cursor"));
  badCursors.push(await failure(cursorPath(valid.next), 400, "invalid_cursor", { client: "beta" }));
  badCursors.push(
    await failure(cursorPath(valid.next), 400, "invalid_cursor", { client: "other" }),
  );
  const history = await ok(`/event-history?taskId=${one.taskId}`);
  badCursors.push(await failure(cursorPath(history.cursor), 400, "invalid_cursor"));
  await failure("/tasks?scope=other", 400, "invalid_request");
  await failure("/tasks?type=echo&type=alternate", 400, "invalid_request");
  passed("非法/篡改/混合查询/跨 caller/scope/事件游标拒绝", badCursors);
  await time(800);
  await finish();
  const beforeRestart = await list();
  assert.equal(beforeRestart.tasks.find((v) => v.taskId === one.taskId).updatedAt, iso(500));
  assert.ok(
    beforeRestart.tasks.filter((v) => v.taskId !== one.taskId).every((v) => v.state.completed),
  );
  const restartCursor = (await list({}, { limit: 1 })).next;
  const beforeStats = await control("stats");
  const beforeHistory = await ok(`/event-history?taskId=${two.taskId}`);
  for (let i = 0; i < 3; i++) {
    await list();
    await detail(two);
    await ok(`/requests/${one.requestId}`);
    await ok("/task-types");
  }
  assert.deepEqual(await control("stats"), beforeStats);
  assert.equal(
    (await ok(`/event-history?taskId=${two.taskId}`)).watermark,
    beforeHistory.watermark,
  );
  assert.deepEqual((await list()).tasks, beforeRestart.tasks);
  passed("读取不产生执行/写入/清理或 updatedAt", {
    stats: beforeStats,
    watermark: beforeHistory.watermark,
  });
  await stop();
  await start("2");
  const recovered = await list();
  assert.deepEqual(recovered.tasks, beforeRestart.tasks);
  assert.deepEqual(await ok(`/requests/${one.requestId}`), raw);
  const expiredRestart = await failure(cursorPath(restartCursor), 410, "query_expired");
  assert.equal((await ok("/task-types")).find((v) => v.type === "echo").version, "2");
  assert.ok(recovered.tasks.filter((v) => v.type === "echo").every((v) => v.version === "1"));
  assert.equal((await control("stats")).executions, 0);
  await time(900);
  const revision = (await ok("/task-types")).find((v) => v.type === "echo").revision;
  const redoCurrent = await submit(redoBody, "beta", { "If-Match": `"${revision}"` });
  await running(redoCurrent);
  assert.equal((await list()).tasks.find((v) => v.taskId === redoCurrent.taskId).version, "2");
  assert.equal(Object.hasOwn(await ok(`/requests/${redoCurrent.requestId}`), "version"), false);
  await time(1_000);
  await finish();
  passed("SQLite 跨服务进程恢复；旧游标失效；旧绑定不被当前发现重解释", {
    retained: recovered.tasks,
    expiredRestart,
    currentVersionRedo: { taskId: redoCurrent.taskId, version: "2", revision },
  });
  const expiry = await list({}, { limit: 1 });
  const beforeExpiryStats = await control("stats");
  const beforeExpiryTasks = (await list()).tasks;
  const beforeExpiryWatermark = (await ok(`/event-history?taskId=${two.taskId}`)).watermark;
  await time(122_000);
  const expired = await failure(cursorPath(expiry.next), 410, "query_expired");
  const retained = await list();
  assert.deepEqual(retained.tasks, beforeExpiryTasks);
  assert.deepEqual(await control("stats"), beforeExpiryStats);
  assert.equal((await ok(`/event-history?taskId=${two.taskId}`)).watermark, beforeExpiryWatermark);
  assert.ok(retained.tasks.length > 1);
  passed("受控时钟超过 lifetime；过期明确 410；过 retention 读取仍不 collect", {
    expired,
    retainedTaskIds: ids(retained),
    beforeExpiryStats,
    watermark: beforeExpiryWatermark,
  });
  const collectedCursor = (await list({}, { limit: 1 })).next;
  assert.ok(collectedCursor);
  const collectStats = await control("collect");
  assert.equal(collectStats.collects, 1);
  assert.equal(collectStats.compacts, 1);
  const invalidated = await failure(cursorPath(collectedCursor), 410, "query_expired");
  assert.deepEqual((await list()).tasks, []);
  assert.deepEqual((await list({}, {}, "other")).tasks, []);
  await failure(`/tasks/${one.taskId}`, 404, "not_found");
  await failure(`/requests/${one.requestId}`, 404, "not_found");
  passed("显式 collect 专属 Store 后本轮失效而非静默漏项", {
    collectStats,
    invalidated,
    newQuery: [],
  });
  proof.success = true;
} catch (error) {
  proof.success = false;
  proof.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  try {
    await stop();
  } catch (error) {
    proof.success = false;
    proof.cleanupFailure = error.message;
    process.exitCode = 1;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
      if (url) await portClosed(url);
      proof.cleanup.push({ pid: child.pid, forced: true, url, portClosed: true });
    }
  }
  await writeFile("result.json", `${JSON.stringify(proof, null, 2)}\n`);
}
