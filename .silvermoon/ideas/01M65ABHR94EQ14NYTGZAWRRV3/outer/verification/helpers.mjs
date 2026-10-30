import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { newId } from "@potential-guide/task-engine";

export const proof = { cases: [], processes: [] };
const children = [];
export const ownedPids = new Set();
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
export async function bounded(operation, ms = 10000) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`Harness operation exceeded ${ms} ms.`)), ms);
  })]); } finally { clearTimeout(timer); }
}
export async function rows(path) {
  const text = await readFile(path, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return text.trim() ? text.trim().split(/\r?\n/).map((line) => JSON.parse(line)) : [];
}
export function launch(config, { cli = false, observeWorkers = false, ...env } = {}) {
  const entry = cli
    ? fileURLToPath(new URL("./main.js", import.meta.resolve("@potential-guide/task-engine-server")))
    : resolve("server-child.mjs");
  const args = [
    ...(observeWorkers ? ["--require", resolve("worker-probe.cjs")] : []),
    entry, ...(cli ? ["--config"] : []), resolve(config),
  ];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(), env: { ...process.env, ...env }, windowsHide: true,
    stdio: cli ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", "ipc"],
  });
  const item = { child, cli, pid: child.pid, stdout: "", stderr: "", messages: [], command: [process.execPath, ...args] };
  item.closed = new Promise((done) => child.once("close", (code, signal) => {
    item.outcome = { code, signal };
    done(item.outcome);
  }));
  item.ready = new Promise((done, reject) => {
    const accept = (message) => {
      item.messages.push(message);
      if (message.event === "ready") { item.url = message.url; done(item); }
    };
    child.on("message", accept);
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      item.stdout += chunk;
      if (cli) for (const line of item.stdout.split("\n")) {
        try { const message = JSON.parse(line); if (message.event === "ready") accept(message); } catch {}
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { item.stderr += chunk; });
    child.once("error", reject);
    child.once("close", () => { if (!item.url) reject(Error(item.stderr || "Process exited before ready.")); });
  });
  void item.ready.catch(() => {});
  children.push(item);
  proof.launches ??= [];
  proof.launches.push({ pid: item.pid, command: item.command, cwd: process.cwd(), configuration: resolve(config), cli });
  return item;
}
export async function graceful(item) {
  item.child.send("close");
  const outcome = await bounded(item.closed);
  assert.deepEqual(outcome, { code: 0, signal: null });
  assert.ok(item.messages.some((message) => message.event === "closed"));
  assert.equal(alive(item.pid), false);
  proof.processes.push({ pid: item.pid, kind: "ipc-graceful", ...outcome, aliveAfter: false });
}
export async function crash(item, reason = "crash-recovery") {
  item.child.kill("SIGKILL");
  const outcome = await bounded(item.closed);
  assert.equal(alive(item.pid), false);
  proof.processes.push({ pid: item.pid, kind: reason, ...outcome, aliveAfter: false });
}
export async function stopCli(item) {
  item.child.kill("SIGTERM");
  const outcome = await bounded(item.closed);
  if (process.platform !== "win32") {
    assert.equal(outcome.code, 0);
    assert.match(item.stdout, /"event":"closed"/);
  }
  assert.equal(alive(item.pid), false);
  proof.processes.push({
    pid: item.pid, kind: "cli-sigterm", ...outcome, aliveAfter: false,
    gracefulSignalProven: process.platform !== "win32",
  });
}
export async function cleanup() {
  for (const item of children) {
    if (!item.outcome) item.child.kill("SIGKILL");
    await bounded(item.closed);
    assert.equal(alive(item.pid), false);
  }
  for (const pid of ownedPids) {
    if (alive(pid)) process.kill(pid, "SIGKILL");
    for (let count = 0; alive(pid) && count < 100; count++) await sleep(20);
    assert.equal(alive(pid), false);
  }
  proof.cleanup = { serverPids: children.map((item) => item.pid), childPids: [...ownedPids], allAbsent: true };
}
export async function request(url, path, { method = "GET", token = "operator", body, id } = {}) {
  return fetch(`${url}${path}`, {
    method, signal: AbortSignal.timeout(10000),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(id ? { "Idempotency-Key": id } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
export async function submit(url, body, id = newId()) {
  const response = await request(url, "/tasks", { method: "POST", body, id });
  assert.equal(response.status, 202, await response.clone().text());
  return { task: await response.json(), id, body };
}
export async function waitTask(url, id, stage, token = "operator") {
  for (let count = 0; count < 500; count++) {
    const response = await request(url, `/tasks/${id}`, { token });
    assert.equal(response.status, 200);
    const task = await response.json();
    if (task.stage === stage) return task;
    if (task.stage.endsWith("_failed") && stage !== task.stage)
      throw Error(`Unexpected Task failure: ${JSON.stringify(task)}`);
    await sleep(10);
  }
  throw Error(`Task ${id} did not reach ${stage}.`);
}
export async function history(url, id) {
  const events = [];
  let next;
  do {
    const response = await request(url, `/event-history?taskId=${id}&limit=1${next ? `&cursor=${encodeURIComponent(next)}` : ""}`);
    assert.equal(response.status, 200);
    const page = await response.json();
    events.push(...page.events);
    next = page.next;
  } while (next);
  assert.equal(events.length, new Set(events.map((event) => event.sequence)).size);
  return events;
}
export async function stream(url, id, cursor) {
  const response = await fetch(`${url}/events?taskId=${id}`, {
    headers: { authorization: "Bearer operator", ...(cursor ? { "Last-Event-ID": cursor } : {}) },
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  let text = "";
  const decoder = new TextDecoder();
  return {
    reader,
    async frame() {
      while (!text.includes("\n\n")) {
        const chunk = await bounded(reader.read());
        assert.equal(chunk.done, false);
        text += decoder.decode(chunk.value, { stream: true });
      }
      const end = text.indexOf("\n\n");
      const value = text.slice(0, end);
      text = text.slice(end + 2);
      return { cursor: /^id: (.+)$/m.exec(value)[1], data: JSON.parse(/^data: (.+)$/m.exec(value)[1]) };
    },
    close: () => reader.cancel(),
    async ended() {
      while (!(await bounded(reader.read())).done) {}
    },
  };
}
