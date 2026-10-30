import { appendFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createArtifactSource, createCheckTaskType } from "@potential-guide/check-task";
import { createProbeTaskType } from "@potential-guide/probe-task";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { TaskError } from "@potential-guide/task-protocol";

const consumer = realpathSync(process.cwd());
const inside = (path) => {
  const delta = relative(consumer, path);
  return delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta);
};
const routes = JSON.parse(await readFile("routes.json", "utf8"));
const source = createArtifactSource({
  allowedOrigins: ["https://probe-deployment.invalid"],
  authorize(reference, scope) {
    if (scope !== "one" || !Object.hasOwn(routes, reference.url))
      throw new TaskError("artifact_source_denied", "Fixture source scope/reference denied.");
  },
  async download(url) {
    const path = realpathSync(routes[url]);
    if (!inside(path)) throw Error("Fixture route escaped consumer.");
    const bytes = process.env.MODE === "restart" ? undefined : await readFile(path);
    await appendFile("downloads.jsonl", `${JSON.stringify({
      at: new Date().toISOString(), url, archive: path, pid: process.pid, mode: process.env.MODE,
      allowed: process.env.MODE !== "restart",
      archiveSha256: bytes ? createHash("sha256").update(bytes).digest("hex") : undefined,
    })}\n`);
    if (process.env.MODE === "restart") throw Error("Prepared recovery may not download changed sources.");
    return bytes;
  },
});
let engine;
const check = createCheckTaskType({
  source, directory: process.env.WORKERS, workers: 1, wallMs: 60_000, graceMs: 25, cleanupMs: 5_000,
});
const probe = createProbeTaskType({
  source, checkEnvironment: check.environment, parents: 2, wallMs: 60_000, cleanupMs: 5_000,
  children(scope) {
    return {
      service: engine, caller: { scope, subject: "operator" },
      waitForTaskRelease: (id, caller) => engine.waitForTaskRelease(id, caller),
    };
  },
});
const limits = { maxConcurrent: 1, maxPayloadBytes: 16 * 1024 * 1024, executionWallMs: 65_000 };
const server = await startTaskServer({
  port: 0, database: process.env.DATABASE, types: [check, probe],
  currentVersions: { check: "1", probe: "1" }, limits, shutdownMs: 20_000,
  authorize: (caller, _operation, scope) => caller.scope === scope && caller.subject === "operator",
  resolveCaller(request) {
    const token = request.headers.get("authorization");
    if (!["Bearer operator", "Bearer other"].includes(token))
      throw new TaskError("unauthenticated", "Fixture authentication required.");
    return { scope: token === "Bearer other" ? "other" : "one", subject: "operator" };
  },
  bindService(value) { engine = value; },
  async closeResources() { await probe.close(); await check.close(); await source.close(); },
});
const entries = {};
for (const name of ["task-protocol", "task-engine", "task-engine-server", "check-task", "probe-task"]) {
  const path = realpathSync(fileURLToPath(import.meta.resolve(`@potential-guide/${name}`)));
  if (!inside(path)) throw Error("Runtime module escaped installed consumer.");
  entries[name] = { path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
}
process.send({
  event: "ready", url: server.url, pid: process.pid, instance: process.env.PROOF_INSTANCE, limits, pools: { probe: 2, check: 1 },
  environment: { probe: probe.environment, check: check.environment }, entries,
});
const caller = { scope: "one", subject: "operator" };
let closing = false;
process.on("message", async (message) => {
  if (!message?.rpcId) return;
  try {
    let value;
    if (message.operation === "submit") value = engine.submit(message.request, caller);
    else if (message.operation === "request") value = engine.getRequest(message.requestId, caller);
    else if (message.operation === "task") value = engine.getTask(message.taskId, caller);
    else if (message.operation === "release") {
      await engine.waitForTaskRelease(message.taskId, caller);
      value = { released: true };
    } else if (message.operation === "close") {
      if (closing) throw Error("Already closing.");
      closing = true;
      await server.close();
      value = { closed: true, diagnostics: { probe: probe.diagnostics, check: check.diagnostics } };
    } else throw Error("Unknown harness RPC.");
    process.send({ rpcId: message.rpcId, value }, () => {
      if (message.operation === "close") process.disconnect();
    });
  } catch (error) {
    process.send({ rpcId: message.rpcId, error: String(error.stack ?? error) });
  }
});
