import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  ArtifactManager, CheckClient, CheckKernel, TaskScheduler, TaskProtocolError,
  closePrivateFileBackend, ensurePrivateDirectory, publishPrivateFile, removePrivateFile,
  serve, taskTerminal, v2Limits,
} from "@potential-guide/check-host";
import { withPilot } from "@potential-guide/cli-runtime";
import { Effect } from "@potential-guide/effects";
import { observe, readPage } from "@potential-guide/objective-pilot";
import { makeRegulatorSpec, regulate } from "@potential-guide/objective-regulator";

const root = process.cwd();
const delivery = JSON.parse(await readFile("delivery.json", "utf8"));
const preparation = JSON.parse(await readFile("installation.json", "utf8"));
const inside = (parent, path) => {
  const child = relative(parent, path);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
};
assert.equal(process.platform, "win32");
assert.equal(process.env.NODE_PATH, "");
assert.equal(process.env.NODE_OPTIONS, "");
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
assert.deepEqual(process.execArgv, []);
const result = { environment: { node: process.version, platform: process.platform },
  modules: [], scenarios: [], timings: {}, cleanup: {} };
for (const name of preparation.names) {
  const path = await realpath(fileURLToPath(import.meta.resolve(name)));
  assert.ok(inside(root, path) && !inside(preparation.repository, path));
  result.modules.push({ name, relativePath: relative(root, path).split(sep).join("/") });
}
async function until(use, label, timeout = 20_000) {
  const end = performance.now() + timeout;
  for (;;) {
    const value = await use();
    if (value) return value;
    assert.ok(performance.now() < end, `Timed out: ${label}`);
    await delay(10);
  }
}
async function records() {
  let text;
  try { text = await readFile(join(root, "control", "worker.jsonl"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter(Boolean).map(JSON.parse);
}
const entered = name => until(async () => (await records()).filter(row => row.type === "entered" && row.name === name).length, `worker entered ${name}`);
const release = name => writeFile(join(root, "control", `gate-${name}`), "release\n");
const hostDirectory = resolve("private-host");
await ensurePrivateDirectory(hostDirectory);
const kernel = await CheckKernel.create(join(hostDirectory, "snapshots"),
  { workers: 2, deadlineMs: 3000, cleanupMs: 3000 });
const manager = new ArtifactManager(join(hostDirectory, "artifacts"), [delivery.origin]);
const scheduler = new TaskScheduler(manager, kernel, { ...v2Limits, timeoutMs: 20_000 });
const token = randomUUID() + randomUUID();
const host = await serve(kernel, token, scheduler);
const descriptor = JSON.stringify({ endpoint: host.endpoint, token, pid: process.pid, instance: scheduler.instance });
const client = new CheckClient({ endpoint: host.endpoint, token, pid: process.pid, instance: scheduler.instance });
let httpRequests = 0, streamConnections = 0, published = false;
host.server.on("request", request => {
  httpRequests++;
  if (request.url?.startsWith("/v2/events?")) streamConnections++;
});
const raw = (path, method = "GET", signal) => fetch(`${host.endpoint}${path}`, {
  method, headers: { authorization: `Bearer ${token}` }, ...(signal ? { signal } : {}),
});
const create = (subject, options = {}) => client.check({
  check: { url: `${delivery.origin}/latest`, ...(options.digest ? { digest: options.digest } : {}) },
  subject, ...(options.freshness ? { freshness: options.freshness } : {}),
  ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
});
const state = (task, expected) => until(async () => {
  const snapshot = await task.snapshot();
  assert.ok(!taskTerminal(snapshot) || snapshot.state === expected, JSON.stringify(snapshot));
  return snapshot.state === expected ? snapshot : undefined;
}, `${task.taskId} ${expected}`);
const failed = async (task, code) => {
  await assert.rejects(task.result(), error => error instanceof TaskProtocolError && error.detail.code === code);
  const snapshot = await task.snapshot();
  assert.equal(snapshot.error.code, code);
  return snapshot;
};
async function rawSnapshots(tasks) {
  const controller = new AbortController();
  const query = new URLSearchParams();
  for (const task of tasks) query.append("taskId", task.taskId);
  const response = await raw(`/v2/events?${query}`, "GET", controller.signal);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader(), decoder = new TextDecoder(), snapshots = [];
  let text = "";
  let failure;
  try {
    while (snapshots.length < tasks.length) {
      const read = await reader.read();
      assert.equal(read.done, false);
      text += decoder.decode(read.value, { stream: true });
      let end;
      while ((end = text.indexOf("\n\n")) >= 0) {
        const frame = text.slice(0, end);
        text = text.slice(end + 2);
        const data = frame.split("\n").find(line => line.startsWith("data: "));
        if (data) snapshots.push(JSON.parse(data.slice(6)).snapshot);
      }
    }
    return snapshots;
  } finally { controller.abort(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
try {
  assert.equal(await publishPrivateFile(hostDirectory, "host.json", descriptor, null), true);
  published = true;
  process.env.PGUIDE_CHECK_HOST_DIRECTORY = hostDirectory;
  const ready = await raw(`/v2/artifacts/${encodeURIComponent(`sha256-pguide-check-v1:${"0".repeat(64)}`)}`);
  assert.equal(ready.status, 404);
  assert.equal((await ready.json()).error.code, "artifact_unavailable");
  assert.equal((await fetch(`${host.endpoint}/v2/events?scope=all`)).status, 401);
  result.scenarios.push({ name: "real-authenticated-v2-ready", ready: true });

  const beforeInvalid = httpRequests;
  let hooks = 0;
  await assert.rejects(client.check({ check: { url: `${delivery.origin}/latest` }, subject: { value: NaN } }), TypeError);
  await assert.rejects(client.check({ check: { url: `${delivery.origin}/latest` },
    subject: Object.defineProperty({}, "value", { enumerable: true, get() { hooks++; return 1; } }) }), TypeError);
  assert.equal(httpRequests, beforeInvalid); assert.equal(hooks, 0);
  result.scenarios.push({ name: "sdk-invalid-json-zero-http", requests: 0, hooks: 0 });

  const subject = { name: "queued", gate: "queued", fail: true };
  const a = await create(subject), b = await create({ fail: true, gate: "queued", name: "queued" });
  const [waitingA, waitingB] = await Promise.all([state(a, "waiting"), state(b, "waiting")]);
  assert.notEqual(a.taskId, b.taskId);
  assert.equal(waitingA.executionId, waitingB.executionId);
  await until(async () => (await records()).some(row => row.type === "initialize"), "initializer gate");
  const histories = new Map([[a.taskId, []], [b.taskId, []]]);
  const monitor = (async () => {
    for await (const event of client.watchTasks([a, b])) {
      histories.get(event.taskId).push(event.snapshot);
      if ([...histories.values()].every(history => history.some(taskTerminal))) return;
    }
  })();
  await until(() => [...histories.values()].every(history => history.length), "initial filtered snapshots");
  const beforeStart = kernel.diagnostics().executions;
  assert.equal(beforeStart, 0);
  await release("initialize");
  const runningA = await state(a, "running");
  await entered("queued");
  assert.equal(kernel.diagnostics().executions, 1);
  assert.equal((await raw(`/checks/${runningA.executionId}/cancel`, "POST")).status, 404);

  await writeFile(join(root, "control", "latest-v3"), "V3");
  const c = await create(subject);
  const runningC = await state(c, "running");
  await until(async () => (await records()).filter(row => row.name === "queued" && row.type === "entered").length === 2, "both versions entered code");
  assert.equal(runningC.artifact.digest, delivery.products.V3.digest);
  assert.notEqual(runningA.executionId, runningC.executionId);
  assert.equal(runningA.artifact.digest, delivery.products.V2.digest);
  await release("queued");
  const [ra, rb, rc] = await Promise.all([a.result(), b.result(), c.result()]);
  await monitor;
  for (const history of histories.values()) {
    assert.equal(history[0].state, "waiting");
    assert.equal(history.at(-1).state, "completed");
    assert.ok(history.slice(1).every((snapshot, index) => snapshot.revision > history[index].revision));
  }
  assert.equal(ra.executionId, rb.executionId);
  assert.deepEqual(ra.result, rb.result);
  assert.equal(ra.result.ok, false); assert.equal(rc.result.ok, false);
  assert.equal(ra.result.version, "V2"); assert.equal(rc.result.version, "V3");
  const baselineExecutions = kernel.diagnostics().executions;
  const reconnect1 = await rawSnapshots([a, b]), reconnect2 = await rawSnapshots([a, b]);
  assert.ok([...reconnect1, ...reconnect2].every(snapshot => snapshot.state === "completed"));
  assert.deepEqual(reconnect1.map(item => [item.taskId, item.revision]), reconnect2.map(item => [item.taskId, item.revision]));
  await Promise.all([a.result(), a.snapshot(), b.result()]);
  assert.equal(kernel.diagnostics().executions, baselineExecutions);
  result.scenarios.push({ name: "queued-strong-sharing-version-coexistence-and-events",
    snapshots: [ra, rb, rc], initialStates: [...histories].map(([taskId, history]) =>
      ({ taskId, states: history.map(item => item.state), revisions: history.map(item => item.revision) })),
    reconnectStable: true, noReadExecution: true });
  const fixed = await create({ name: "fixed", value: null }, { digest: delivery.products.V2.digest });
  const fixedResult = await fixed.result();
  assert.equal(fixedResult.result.version, "V2");
  assert.equal(await client.reference(delivery.products.V2.digest, "check"), "# V2 exact Check Reference\n");
  result.scenarios.push({ name: "fixed-old-content-after-floating-update", snapshot: fixedResult });

  const sharedSubject = { name: "freshness", gate: "freshness" };
  const first = await create(sharedSubject, { digest: delivery.products.V2.digest });
  const old = await state(first, "running"); await entered("freshness");
  const weak = await create(sharedSubject, { digest: delivery.products.V2.digest, freshness: "completed-after-request" });
  assert.equal((await state(weak, "running")).executionId, old.executionId);
  const strong = await create(sharedSubject, { digest: delivery.products.V2.digest });
  const newRun = await state(strong, "running");
  assert.notEqual(newRun.executionId, old.executionId);
  await until(async () => (await records()).filter(row => row.name === "freshness" && row.type === "entered").length === 2, "two freshness executions");
  const deadlineTask = await create(sharedSubject, { digest: delivery.products.V2.digest,
    freshness: "completed-after-request", timeoutMs: 500 });
  assert.equal((await state(deadlineTask, "running")).executionId, old.executionId);
  const cancelled = await first.cancel();
  assert.equal(cancelled.state, "cancelled");
  const expired = await failed(deadlineTask, "task_timeout");
  assert.equal((await weak.snapshot()).state, "running");
  assert.ok(!(await records()).some(row => row.type === "cleaned" && row.name === "freshness"));
  await release("freshness");
  const [weakResult, strongResult] = await Promise.all([weak.result(), strong.result()]);
  assert.equal(weakResult.executionId, old.executionId);
  assert.equal(strongResult.executionId, newRun.executionId);
  await failed(first, "task_cancelled");
  result.scenarios.push({ name: "running-weak-strong-and-independent-deadline-cancel",
    cancelled, expired, weak: weakResult, strong: strongResult });

  const cooperative = await create({ name: "cooperative", gate: "never" }, { digest: delivery.products.V2.digest });
  await state(cooperative, "running"); await entered("cooperative");
  const cancelAt = performance.now();
  await cooperative.cancel();
  await until(async () => (await records()).some(row => row.type === "cleaned" && row.name === "cooperative" && row.aborted), "cooperative cleanup acknowledgement");
  result.timings.cooperativeCleanupMs = performance.now() - cancelAt;
  result.scenarios.push({ name: "last-demand-cooperative-cleanup", task: await cooperative.snapshot(), acknowledged: true });

  const wallSubject = { name: "wall", spin: true, spawn: true };
  const runaway = await create(wallSubject, { digest: delivery.products.V2.digest });
  await state(runaway, "running"); await entered("wall");
  const childPid = (await records()).find(row => row.type === "entered" && row.name === "wall").child;
  assert.ok(Number.isSafeInteger(childPid) && childPid > 0);
  await until(() => kernel.diagnostics().ownedProcesses === 1, "owned child registered");
  const wallAt = performance.now();
  const healthy = await create({ name: "healthy" }, { digest: delivery.products.V2.digest });
  const healthyResult = await healthy.result();
  assert.equal(healthyResult.state, "completed");
  const observer = await create(wallSubject, { digest: delivery.products.V2.digest, freshness: "completed-after-request" });
  assert.equal((await state(observer, "running")).executionId, (await runaway.snapshot()).executionId);
  const wallFailure = await failed(runaway, "execution_timeout");
  await failed(observer, "execution_timeout");
  result.timings.wallSealMs = performance.now() - wallAt;
  assert.ok(result.timings.wallSealMs >= 2400 && result.timings.wallSealMs < 8000);
  await until(() => kernel.diagnostics().ownedProcesses === 0 && kernel.diagnostics().workers === 1, "isolated forced worker exit", 15_000);
  assert.throws(() => process.kill(childPid, 0), error => error.code === "ESRCH");
  result.timings.physicalCleanupMs = performance.now() - wallAt;
  assert.ok(result.timings.physicalCleanupMs >= result.timings.wallSealMs);
  const successor = await create({ name: "after-force" }, { digest: delivery.products.V2.digest });
  const successorResult = await successor.result();
  assert.equal(successorResult.state, "completed");
  assert.equal(successorResult.result.worker, healthyResult.result.worker);
  result.scenarios.push({ name: "execution-wall-seal-force-and-cross-worker-isolation",
    failure: wallFailure, healthy: healthyResult, successor: successorResult, childExitConfirmed: true });

  const reports = resolve("pilot-reports"), cacheDirectory = resolve("pilot-cache");
  let frozen;
  await withPilot(delivery.objective.location, root, undefined, async (spec, runtime) => {
    frozen = Object.fromEntries(runtime.boundObjectives().map(bound => [bound.objectiveId, bound.source]));
    const reference = readPage(spec, "checks/ready/problems/not-ready");
    assert.equal(reference.origin.artifactDigest, delivery.products.business.digest);
    assert.match(reference.resourceBase, /\/v2\/artifacts\/.+\/references\//);
    const notReady = await Effect.runPromise(observe({ spec, subject: { ready: false } }, runtime));
    assert.equal(notReady.status, 200, JSON.stringify(notReady)); assert.equal(notReady.payload.current.levelId, "initial");
    const outcome = await Effect.runPromise(regulate({
      spec: makeRegulatorSpec(spec, { targetLevel: "ready",
        agentExecutionLimits: { timeoutMs: 1000 }, quota: { timeoutMs: 20_000, maxAgentRuns: 1, maxStallRuns: 1 } }, { id: "unused" }),
      subject: { ready: true },
    }, { pilot: runtime, executeAgent: async () => { throw new Error("Satisfied target must not invoke an Agent."); } }));
    assert.equal(outcome.stopReason, "target-reached");
    result.scenarios.push({ name: "real-pilot-regulator-fixed-https-references",
      objectiveDigest: spec.version, checkDigest: spec.source.checks.ready.digest,
      revision: spec.source.checks.ready.revision, current: outcome.latestObservation.payload.current.levelId,
      owningReference: reference.origin });
  }, { cacheDirectory, reports: { enabled: true, directory: reports } });
  assert.deepEqual(await readdir(join(cacheDirectory, "objective-artifacts")), ["objectives"]);
  await writeFile(join(root, "control", "business-next"), "update");
  const updatedBusiness = await client.resolveArtifact(`${delivery.origin}/business`);
  assert.equal(updatedBusiness.digest, delivery.products["business-next"].digest);
  assert.equal(updatedBusiness.revision, frozen["objective:host-v2-delivery"].checks.ready.revision);
  assert.equal(await client.reference(delivery.products.business.digest, "check"), "# business owning Check Reference\n");
  await rename(delivery.objective.directory, `${delivery.objective.directory}-retired`);
  await withPilot("objective:host-v2-delivery", root, undefined, async (spec, runtime) => {
    assert.deepEqual(spec.source, frozen[spec.objectiveId]);
    const recovered = await Effect.runPromise(observe({ spec, subject: { ready: true } }, runtime));
    assert.equal(recovered.payload.current.levelId, "ready");
    result.scenarios.push({ name: "accurate-fixed-recovery-after-source-update-and-author-removal",
      objectiveDigest: spec.version, checkDigest: spec.source.checks.ready.digest,
      revision: spec.source.checks.ready.revision });
  }, { cacheDirectory, sources: frozen, reports: { enabled: true, directory: reports } });
  const evidence = [];
  for (const directory of await readdir(reports)) {
    const events = (await readFile(join(reports, directory, "events.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    evidence.push(...events.filter(event => event.event === "check.host-observation").map(event => event.data));
  }
  assert.ok(evidence.length >= 3);
  assert.ok(evidence.every(item => item.taskId && item.executionId && item.artifact.digest && item.artifact.revision));
  assert.ok(!JSON.stringify(evidence).includes("artifactDirectory"));
  result.businessObservations = evidence;
  await assert.rejects(promisify(execFile)(process.execPath, ["--input-type=module", "--eval",
    `await fetch(${JSON.stringify(`${delivery.origin}/latest`)})`],
    { cwd: root, env: { ...process.env, NODE_EXTRA_CA_CERTS: "", NODE_OPTIONS: "", NODE_PATH: "" }, timeout: 10_000 }));
  result.scenarios.push({ name: "normal-tls-requires-explicit-trust-root", rejectedWithoutCA: true });
  result.streamConnections = streamConnections;
  result.diagnostics = kernel.diagnostics();
  result.workerRecords = await records();
} catch (error) {
  failure = error;
  result.error = String(error);
} finally {
  client.close();
  await host.close();
  if (published) await removePrivateFile(hostDirectory, "host.json", descriptor);
  await closePrivateFileBackend();
  result.cleanup = { serverClosed: !host.server.listening, workers: kernel.diagnostics().workers,
    ownedProcesses: kernel.diagnostics().ownedProcesses, permissionHelperClosed: true };
}
assert.equal(result.cleanup.serverClosed, true);
assert.equal(result.cleanup.workers, 0);
assert.equal(result.cleanup.ownedProcesses, 0);
await writeFile("consumer-results.json", `${JSON.stringify(result, null, 2)}\n`);
if (failure) throw failure;
console.log(JSON.stringify({ passed: result.scenarios.length, cleanup: result.cleanup }));
