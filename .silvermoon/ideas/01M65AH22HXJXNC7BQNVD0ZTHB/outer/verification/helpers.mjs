import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newId } from "@potential-guide/task-engine";

export const proof = { cases: [], processes: [], requests: [], streams: [], runtime: { node: process.versions.node, platform: process.platform, architecture: process.arch } };
const children = [];
const streams = new Set();
const knownChildren = new Set();
const confirmedGone = new Set();
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
export async function bounded(operation, ms = 30_000) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`Harness operation exceeded ${ms} ms.`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
export async function rows(path) {
  const text = await readFile(path, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return text.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}
async function registry(value) {
  await appendFile("owned-processes.jsonl", `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
}
export async function waitFor(read, predicate, label, ms = 45_000) {
  const deadline = performance.now() + ms;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await sleep(20);
  } while (performance.now() < deadline);
  throw Error(`${label} did not reach its bounded condition: ${JSON.stringify(value).slice(-2000)}`);
}
export async function launch(label, mode = "normal") {
  const instance = newId();
  const child = spawn(process.execPath, ["--require", resolve("worker-probe.cjs"), "server-child.mjs"], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, DATABASE: resolve(`${label}.sqlite`), WORKERS: resolve(`workers-${label}-${mode}`),
      MODE: mode, PROOF_INSTANCE: instance, WORKER_PROOF: resolve("worker-events.jsonl"), OWNED_PROOF: resolve("owned-processes.jsonl") },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const item = { child, pid: child.pid, instance, label, mode, workers: resolve(`workers-${label}-${mode}`), stdout: "", stderr: "", messages: [], pending: new Map() };
  children.push(item);
  child.stdout.setEncoding("utf8").on("data", (chunk) => { item.stdout = (item.stdout + chunk).slice(-65_536); });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { item.stderr = (item.stderr + chunk).slice(-65_536); });
  item.closed = new Promise((done) => child.once("close", (code, signal) => {
    item.outcome = { code, signal };
    for (const request of item.pending.values()) request.reject(Error("Server process exited."));
    item.pending.clear();
    done(item.outcome);
  }));
  item.ready = new Promise((done, reject) => {
    child.once("error", reject);
    child.on("message", (message) => {
      item.messages.push(message);
      if (message.event === "ready") {
        item.url = message.url;
        item.binding = message;
        done(item);
      }
      if (message.rpcId && item.pending.has(message.rpcId)) {
        const pending = item.pending.get(message.rpcId);
        item.pending.delete(message.rpcId);
        if (message.error) pending.reject(Error(message.error));
        else pending.resolve(message.value);
      }
    });
    child.once("close", () => { if (!item.url) reject(Error(item.stderr || "Server exited before ready.")); });
  });
  void item.ready.catch(() => {});
  await registry({ event: "spawn", kind: "server", pid: child.pid, instance, label, mode,
    command: [process.execPath, "--require", resolve("worker-probe.cjs"), "server-child.mjs"], cwd: process.cwd() });
  await bounded(item.ready, 60_000);
  proof.processes.push({ kind: "ready", pid: item.pid, label, mode, at: new Date().toISOString(), binding: item.binding });
  return item;
}
export async function rpc(item, operation, value = {}) {
  const rpcId = newId();
  const promise = new Promise((resolve, reject) => item.pending.set(rpcId, { resolve, reject }));
  item.child.send({ rpcId, operation, ...value });
  try { return await bounded(promise); }
  finally { item.pending.delete(rpcId); }
}
export async function graceful(item) {
  const closed = await rpc(item, "close");
  const outcome = await bounded(item.closed);
  assert.deepEqual(outcome, { code: 0, signal: null });
  assert.equal(alive(item.pid), false);
  confirmedGone.add(item.pid);
  await registry({ event: "absent", kind: "server", pid: item.pid });
  proof.processes.push({ kind: "ipc-close-natural-exit", pid: item.pid, ...outcome, closed, stderr: item.stderr });
}
export async function crash(item) {
  item.child.kill("SIGKILL");
  const outcome = await bounded(item.closed);
  assert.equal(alive(item.pid), false);
  confirmedGone.add(item.pid);
  await registry({ event: "absent", kind: "server-crash", pid: item.pid });
  proof.processes.push({ kind: "forced-crash-not-graceful", pid: item.pid, ...outcome, stderr: item.stderr });
}
export async function request(url, path, { method = "GET", token = "operator", body, id, record = true } = {}) {
  const response = await fetch(`${url}${path}`, {
    method, signal: AbortSignal.timeout(15_000),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(id ? { "Idempotency-Key": id } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (record) {
    const text = await response.clone().text();
    proof.requests.push({ at: new Date().toISOString(), method, path, role: token ?? "unauthenticated", id, body, status: response.status, rawBody: text });
  }
  return response;
}
export async function submit(item, body, id = newId()) {
  const response = await request(item.url, "/tasks", { method: "POST", body, id });
  assert.equal(response.status, 202, await response.clone().text());
  return { task: await response.json(), id, body };
}
export async function snapshot(item, id) {
  const response = await request(item.url, `/tasks/${id}`, { record: false });
  assert.equal(response.status, 200);
  return response.json();
}
export async function waitTask(item, id, condition = "completed") {
  return waitFor(() => snapshot(item, id), (task) => {
    if (typeof condition === "function") return condition(task);
    if (task.stage.endsWith("_failed") && task.stage !== condition)
      throw Error(`Unexpected Task failure: ${JSON.stringify(task)}`);
    return task.stage === condition;
  }, `Task ${id}`);
}
export async function history(item, taskId) {
  const pages = [];
  let cursor;
  do {
    assert.ok(pages.length < 200, "History pagination budget exceeded.");
    const response = await request(item.url, `/event-history?taskId=${taskId}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { record: false });
    assert.equal(response.status, 200);
    const page = await response.json();
    pages.push(page);
    cursor = page.next;
  } while (cursor);
  const events = pages.flatMap((page) => page.events);
  assert.equal(new Set(events.map((event) => event.sequence)).size, events.length);
  return { pages, events };
}
export async function stream(item, taskId, cursor) {
  const controller = new AbortController();
  const response = await bounded(fetch(`${item.url}/events?taskId=${taskId}`, {
    signal: controller.signal,
    headers: { authorization: "Bearer operator", ...(cursor ? { "Last-Event-ID": cursor } : {}) },
  })).catch((error) => { controller.abort(); throw error; });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const streamProof = { taskId, resume: cursor, frames: [] };
  proof.streams.push(streamProof);
  const subscription = {
    async frame() {
      while (!text.includes("\n\n")) {
        const chunk = await bounded(reader.read());
        assert.ok(!chunk.done, "SSE ended before its observation frame.");
        text += decoder.decode(chunk.value, { stream: true });
        assert.ok(text.length < 16 * 1024 * 1024);
      }
      const end = text.indexOf("\n\n");
      const raw = text.slice(0, end);
      text = text.slice(end + 2);
      const value = { raw, cursor: /^id: (.+)$/m.exec(raw)[1], data: JSON.parse(/^data: (.+)$/m.exec(raw)[1]) };
      streamProof.frames.push(value);
      return value;
    },
    async close() {
      controller.abort();
      await reader.cancel().catch(() => {});
      streams.delete(subscription);
    },
    async ended() {
      while (!(await bounded(reader.read())).done) {}
      streamProof.eofAfterShutdown = true;
      streams.delete(subscription);
    },
  };
  streams.add(subscription);
  return subscription;
}
export async function childTask(item, parentId, ordinal = 0) {
  return waitFor(async () => {
    const entries = (await history(item, parentId)).events
      .filter((event) => event.type === "execution.progress")
      .map((event) => event.data.progress?.progress)
      .filter((progress) => progress?.kind === "child");
    return entries[ordinal]?.taskId;
  }, Boolean, "Owned child association");
}
export async function ownChild(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid);
  knownChildren.add(pid);
  confirmedGone.delete(pid);
}
export async function absentChild(pid) {
  await waitFor(async () => alive(pid), (exists) => !exists, `Owned child PID ${pid} exit`, 15_000);
  confirmedGone.add(pid);
  await registry({ event: "absent", kind: "checker-child", pid });
}
export async function cleanup() {
  const errors = [];
  for (const stream of streams) {
    try { await stream.close(); } catch (error) { errors.push(String(error)); }
  }
  for (const item of children) {
    try {
      if (!item.outcome) {
        try { await graceful(item); } catch {
          item.child.kill("SIGKILL");
          proof.processes.push({ kind: "cleanup-forced-not-graceful", pid: item.pid });
        }
      }
      await bounded(item.closed);
      assert.equal(alive(item.pid), false);
      confirmedGone.add(item.pid);
      await registry({ event: "absent", kind: "server-cleanup", pid: item.pid });
    } catch (error) { errors.push(String(error)); }
  }
  const latest = new Map((await rows("owned-processes.jsonl")).map((row) => [row.pid, row]));
  for (const row of latest.values()) {
    if (row.event === "spawn" && row.kind === "checker-child") {
      knownChildren.add(row.pid);
      confirmedGone.delete(row.pid);
    }
  }
  for (const pid of knownChildren) {
    if (confirmedGone.has(pid)) continue;
    try {
      if (alive(pid)) process.kill(pid, "SIGKILL");
      await absentChild(pid);
    } catch (error) { errors.push(String(error)); }
  }
  proof.cleanup = { serverPids: children.map((item) => item.pid), childPids: [...knownChildren], allAbsent: errors.length === 0, errors };
  assert.equal(errors.length, 0, errors.join("\n"));
}
