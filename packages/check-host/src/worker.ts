import childProcess from "node:child_process";
import Module, { isBuiltin, syncBuiltinESMExports } from "node:module";
import { dirname, isAbsolute, relative, sep } from "node:path";
import timers from "node:timers";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import type { Json, Subject, WorkerModule } from "./types.js";

const port = parentPort;
if (!port) throw new Error("Worker runner requires a MessagePort.");
const { generation, entry, messageBytes } = workerData;
const boundary = dirname(entry);
const resolver = Module as unknown as { _resolveFilename: (name: string, parent: unknown, ...rest: unknown[]) => string };
const resolveFilename = resolver._resolveFilename;
resolver._resolveFilename = (name, parent, ...rest) => {
  if (isBuiltin(name)) return resolveFilename(name, parent, ...rest);
  if (!name.startsWith(".") && !isAbsolute(name)) throw new Error("Artifact dependencies must be bundled.");
  const target = resolveFilename(name, parent, ...rest);
  const path = relative(boundary, target);
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`) || path.split(sep).includes("node_modules"))
    throw new Error("Artifact import escapes its verified snapshot.");
  return target;
};
let current: { id: string; controller: AbortController } | undefined;
const owned = new Set<childProcess.ChildProcess>();
const pendingTimers = new Set<NodeJS.Timeout>();
const setTimeoutOriginal = timers.setTimeout;
const setIntervalOriginal = timers.setInterval;
const clearTimeoutOriginal = timers.clearTimeout;
const clearIntervalOriginal = timers.clearInterval;
globalThis.setTimeout = timers.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  const timer = setTimeoutOriginal(() => { pendingTimers.delete(timer); callback(...args); }, ms);
  if (current) pendingTimers.add(timer);
  return timer;
}) as typeof setTimeout;
globalThis.setInterval = timers.setInterval = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  const timer = setIntervalOriginal(callback, ms, ...args);
  if (current) pendingTimers.add(timer);
  return timer;
}) as typeof setInterval;
globalThis.clearTimeout = timers.clearTimeout = ((timer: NodeJS.Timeout) => {
  pendingTimers.delete(timer); clearTimeoutOriginal(timer);
}) as typeof clearTimeout;
globalThis.clearInterval = timers.clearInterval = ((timer: NodeJS.Timeout) => {
  pendingTimers.delete(timer); clearIntervalOriginal(timer);
}) as typeof clearInterval;
const spawn = childProcess.spawn;
childProcess.spawn = ((...args: Parameters<typeof spawn>) => {
  if (!current) throw new Error("Child processes require an active check.");
  const child = spawn(...args);
  owned.add(child);
  if (child.pid !== undefined) send("owned", { pid: child.pid });
  child.once("close", () => {
    owned.delete(child);
    if (child.pid !== undefined) send("released", { pid: child.pid });
  });
  return child;
}) as typeof spawn;
syncBuiltinESMExports();
function send(type: string, fields: Record<string, unknown> = {}) {
  const message = { version: 1, generation, checkId: current?.id, type, ...fields };
  if (Buffer.byteLength(JSON.stringify(message)) > messageBytes) throw new Error("Worker output exceeds limit.");
  port?.postMessage(message);
}
let module: WorkerModule;
try {
  const imported = await import(pathToFileURL(entry).href);
  module = imported.default ?? imported;
  if (typeof module.execute !== "function") throw new Error("Worker must export execute.");
  await module.initialize?.();
  send("ready");
} catch (error) {
  send("initialization-failed", { error: String(error) });
  port.close();
  throw error;
}
port.on("message", async (message) => {
  if (message.version !== 1 || message.generation !== generation) return;
  if (message.type === "cancel" && message.checkId === current?.id) {
    current?.controller.abort(new Error("Check cancellation requested."));
    return;
  }
  if (message.type === "dispose") {
    if (current) throw new Error("Cannot dispose a busy worker.");
    await module.dispose?.();
    port.close();
    return;
  }
  if (message.type !== "execute" || current) return;
  const controller = new AbortController();
  current = { id: message.checkId, controller };
  const cleanups: (() => void | Promise<void>)[] = [];
  let result: Json | undefined;
  let error: string | undefined;
  let clean = true;
  send("started");
  try {
    result = await module.execute(message.subject as Subject, {
      signal: controller.signal,
      data: message.context ?? {},
      deadline: message.deadline,
      progress: (value) => send("progress", { value }),
      defer: (cleanup) => cleanups.push(cleanup),
    });
    if (result === undefined) throw new Error("Worker returned no JSON result.");
    if (Buffer.byteLength(JSON.stringify(result)) > messageBytes) throw new Error("Result exceeds limit.");
  } catch (cause) {
    error = String(cause);
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch (cause) { clean = false; error = `cleanup: ${String(cause)}`; }
    }
    cleanups.length = 0;
    if (owned.size) { clean = false; error = "cleanup: child processes still owned."; }
    if (pendingTimers.size) {
      clean = false; error = "cleanup: timers still owned.";
      for (const timer of pendingTimers) clearTimeoutOriginal(timer);
      pendingTimers.clear();
    }
  }
  send("done", { result, error, clean, cancelled: controller.signal.aborted, memory: process.memoryUsage(), resources: {timers:pendingTimers.size,processes:owned.size} });
  result = undefined;
  current = undefined;
});
