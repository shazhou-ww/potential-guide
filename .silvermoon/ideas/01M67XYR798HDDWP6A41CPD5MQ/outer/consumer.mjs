import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer as httpsServer } from "node:https";
import { once } from "node:events";
import { mkdir, readFile, writeFile, copyFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newId } from "@potential-guide/task-engine";
import { assembly, bundles, caller, deferred, http, root, until } from "./consumer-lib.mjs";

await mkdir(dirname(root), { recursive: true });
await mkdir(root);
const report = { startedAt: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch, consumer: process.cwd(), root, cases: [] };
const save = () => writeFile(join(root, "observations.json"), JSON.stringify(report, null, 2));
const jobs = [];
async function scenario(name, work) {
  try {
    const evidence = await work();
    report.cases.push({ name, passed: true, evidence });
    console.log(JSON.stringify({ name, passed: true }));
  } catch (error) {
    report.cases.push({ name, passed: false, error: String(error), stack: error.stack });
    console.error(JSON.stringify({ name, passed: false, error: String(error) }));
    throw error;
  } finally { await save(); }
}
function child(filename, argument) {
  const handle = spawn(process.execPath, [filename, ...(argument ? [argument] : [])], { cwd: process.cwd(), env: { ...process.env, NODE_PATH: "" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const messages = [], output = { pid: handle.pid, stdout: "", stderr: "" };
  handle.on("message", (message) => messages.push(message));
  handle.stdout.on("data", (value) => { output.stdout += value; });
  handle.stderr.on("data", (value) => { output.stderr += value; });
  const exited = once(handle, "exit").then(([code, signal]) => { output.code = code; output.signal = signal; });
  const stop = async () => { if (handle.exitCode === null && handle.signalCode === null) handle.kill("SIGTERM"); await exited; };
  jobs.push({ stop, output });
  return {
    handle, messages, output, exited,
    async call(kind, data = {}) {
      const id = newId(); handle.send({ kind, id, ...data });
      return until(() => messages.find((message) => message.id === id), Boolean, 20000);
    },
    stop,
  };
}
let a;
let assets;
const gates = new Map(), outstanding = [];
try {
  await scenario("已安装制品身份与 src 隔离", async () => {
    const packages = ["task-protocol", "task-engine", "task-engine-storage", "task-engine-http", "task-engine-server", "check-artifacts", "check-runtime-files", "check-task", "probe-task"];
    const installed = [];
    for (const name of packages) {
      const entry = await realpath(fileURLToPath(import.meta.resolve(`@potential-guide/${name}`)));
      assert.ok(entry.startsWith(process.cwd()));
      assert.equal(entry.includes("task-engine-worker-per-task"), false);
      installed.push({ name, entry, sha256: createHash("sha256").update(await readFile(entry)).digest("hex") });
    }
    return { installed, manifest: JSON.parse(await readFile("artifact-manifest.json", "utf8")) };
  });
  const assetRequests = [];
  assets = httpsServer({ key: await readFile("certificates/key.pem"), cert: await readFile("certificates/cert.pem") }, async (request, response) => {
    const artifact = request.url === "/checker.tgz" ? "floating-checker.tgz" : request.url === "/objective.tgz" ? "floating-objective.tgz" : undefined;
    if (!artifact) { response.writeHead(404).end(); return; }
    const bytes = await readFile(join(root, "artifacts", artifact));
    assetRequests.push({ at: new Date().toISOString(), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    response.writeHead(200, { "content-type": "application/gzip", "content-length": bytes.length }).end(bytes);
  });
  await new Promise((done) => assets.listen(0, "127.0.0.1", done));
  process.env.VALIDATION_HTTPS_ORIGIN = `https://127.0.0.1:${assets.address().port}`;
  report.https = { origin: process.env.VALIDATION_HTTPS_ORIGIN, certSha256: createHash("sha256").update(await readFile("certificates/cert.pem")).digest("hex"), requests: assetRequests };
  const artifacts = await bundles();
  const actionGate = deferred(), proofGate = deferred();
  outstanding.push(actionGate, proofGate);
  const resource = { started: false, finished: false, proofStarted: false, live: false };
  const extra = [{
    type: "control", version: "1", environment: "external-control-v1",
    inputSchema: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false },
    resultSchema: true, messageSchema: { type: "object", properties: { kind: { enum: ["add", "target", "finish"] }, amount: { type: "integer", minimum: 1 } }, required: ["kind"], additionalProperties: false },
    module: new URL("./control-type.mjs", import.meta.url).href, exportName: "createControl", configuration: {},
  }, {
    type: "resource", version: "1", environment: "external-resource-v1",
    inputSchema: { type: "object" }, resultSchema: true, messageSchema: false,
    module: new URL("./resource-type.mjs", import.meta.url).href, exportName: "createResource", configuration: {},
    resources: { async hold(_value, context) {
      resource.started = true; resource.live = true; resource.context = { runId: context.runId, workerGeneration: context.workerGeneration };
      await actionGate.promise; resource.finished = true; return { handle: "自有存活资源" };
    } },
    async confirmResourceRelease() { resource.proofStarted = true; await proofGate.promise; resource.live = false; },
  }];
  a = await assembly(join(root, "consumer.sqlite"), gates, extra);
  const read = (task) => a.engine.getTask(task.taskId, caller);
  const submit = (parameters, who = caller) => a.engine.submit({ requestId: newId(), timeoutMs: 10000, ...parameters }, who);
  const finish = async (task) => { await a.engine.waitForTaskRelease(task.taskId, caller); return read(task); };
  const version = (task) => task.result.result.problems[0].parameters.version;
  await scenario("Check 准备中需求与浮动 URL 固定旧内容", async () => {
    const gate = deferred(); outstanding.push(gate); gates.set(artifacts.checkUrl, gate);
    const owner = submit({ type: "check", checker: { kind: "checker", url: artifacts.checkUrl }, subject: { case: "check-share" } });
    await until(() => gate.selected, Boolean);
    const runId = read(owner).run.runId;
    const receiver = submit({ type: "check", checker: { kind: "checker", url: artifacts.checkUrl }, subject: { case: "check-share" }, matchPolicy: "terminated-after-eligible" });
    assert.equal(read(receiver).run, undefined);
    await copyFile(join(artifacts.directory, "checker-v2.tgz"), join(artifacts.directory, "floating-checker.tgz"));
    gates.delete(artifacts.checkUrl); gate.resolve();
    const tasks = await Promise.all([finish(owner), finish(receiver)]);
    assert.ok(tasks.every((task) => task.run.runId === runId && version(task) === "v1"));
    assert.equal(a.reads.filter((item) => item.reference.url === artifacts.checkUrl).length, 1);
    assert.equal(a.engine.getRequest(receiver.requestId, caller).matchPolicy, "terminated-after-eligible");
    assert.notEqual(tasks[0].result.evidence.execution.executionId, runId);
    const publicPage = await http(a.server.url, `/event-history?runId=${runId}`);
    assert.equal(publicPage.status, 200);
    assert.ok(publicPage.body.events.some((event) => event.type === "run.started"));
    assert.equal((await http(a.server.url, "/executions")).status, 404);
    return { tasks, sourceReads: [...a.reads], publicHistory: publicPage.body };
  });
  await scenario("Probe 准备中需求与浮动 Objective 固定旧 root/Checker", async () => {
    const gate = deferred(); outstanding.push(gate); gates.set(artifacts.rootUrl, gate);
    const owner = submit({ type: "probe", objective: { kind: "objective", url: artifacts.rootUrl }, subject: { case: "probe-share" } });
    await until(() => gate.selected, Boolean);
    const receiver = submit({ type: "probe", objective: { kind: "objective", url: artifacts.rootUrl }, subject: { case: "probe-share" }, matchPolicy: "terminated-after-eligible" });
    await copyFile(join(artifacts.directory, "objective-v2.tgz"), join(artifacts.directory, "floating-objective.tgz"));
    gates.delete(artifacts.rootUrl); gate.resolve();
    const tasks = await Promise.all([finish(owner), finish(receiver)]);
    assert.equal(tasks[0].run.runId, tasks[1].run.runId);
    for (const task of tasks) {
      assert.equal(task.stage, "completed");
      assert.equal(task.result.evidence.prepared.root.reference.digest, artifacts.versions.v1.objective);
      const child = task.result.evidence.operations.find((operation) => operation.request.kind === "check").snapshot;
      assert.equal(version(child), "v1");
    }
    assert.equal(a.reads.filter((item) => item.reference.url === artifacts.rootUrl).length, 1);
    return { tasks, sourceReads: [...a.reads] };
  });
  await scenario("精确 digest 与错误 pin 边界", async () => {
    const checker = await finish(submit({ type: "check", checker: { kind: "checker", url: artifacts.checkUrl, digest: artifacts.versions.v2.checker }, subject: { case: "pin" } }));
    assert.equal(version(checker), "v2");
    const probe = await finish(submit({ type: "probe", objective: { kind: "objective", url: artifacts.rootUrl, digest: artifacts.versions.v2.objective }, subject: { case: "pin" } }));
    assert.equal(probe.result.evidence.prepared.root.reference.digest, artifacts.versions.v2.objective);
    const bad = await finish(submit({ type: "check", checker: { kind: "checker", url: artifacts.checkUrl, digest: "sha256:" + "0".repeat(64) }, subject: {} }));
    assert.equal(bad.stage, "run_failed");
    return { checker, probe, bad };
  });
  await scenario("可信 scope/source 拒绝、Never 但 Cancel 可用", async () => {
    const x = submit({ type: "check", checker: { kind: "checker", url: artifacts.checkUrl }, subject: { case: "cancel-one" } });
    const y = submit({ type: "check", checker: { kind: "checker", url: artifacts.checkUrl }, subject: { case: "survive" } });
    await until(() => read(x).run, Boolean);
    const message = await http(a.server.url, `/tasks/${x.taskId}/messages/${newId()}`, { payload: {} });
    assert.equal(message.status, 400);
    assert.equal((await http(a.server.url, `/tasks/${x.taskId}`, undefined, "b")).status, 403);
    assert.equal((await http(a.server.url, `/event-history?taskId=${x.taskId}`, undefined, "b")).status, 403);
    const canceled = await http(a.server.url, `/tasks/${x.taskId}/cancel`, {});
    assert.equal(canceled.status, 200); assert.ok(canceled.body.canceledAt);
    const survivor = await finish(y);
    assert.equal(survivor.stage, "completed");
    await a.engine.waitForTaskRelease(x.taskId, caller);
    const denied = a.engine.submit({ requestId: newId(), type: "check", checker: { kind: "checker", url: artifacts.checkUrl }, subject: {}, timeoutMs: 10000 }, { scope: "b", subject: "fixture" });
    await a.engine.waitForTaskRelease(denied.taskId, { scope: "b", subject: "fixture" });
    const deniedResult = a.engine.getTask(denied.taskId, { scope: "b", subject: "fixture" });
    assert.equal(deniedResult.stage, "run_failed");
    assert.equal(a.reads.some((item) => item.scope === "b"), false);
    return { message, canceled, survivor, deniedResult };
  });
  await scenario("业务消息幂等、目标拒绝、共享投入撤回及 deadline 不续期", async () => {
    const x = submit({ type: "control", label: "共同需求", timeoutMs: 300 });
    const y = submit({ type: "control", label: "共同需求", timeoutMs: 5000 });
    await until(() => read(y).run, Boolean);
    assert.equal(read(x).run.runId, read(y).run.runId);
    const id = newId(), target = newId();
    const added = await http(a.server.url, `/tasks/${x.taskId}/messages/${id}`, { payload: { kind: "add", amount: 3 } });
    assert.equal(added.status, 202);
    await until(async () => (await http(a.server.url, `/tasks/${x.taskId}/messages/${id}`)).body.state, (value) => value === "accepted");
    const duplicate = await http(a.server.url, `/tasks/${x.taskId}/messages/${id}`, { payload: { kind: "add", amount: 3 } });
    assert.equal(duplicate.body.state, "accepted");
    assert.equal((await http(a.server.url, `/tasks/${x.taskId}/messages/${id}`, { payload: { kind: "add", amount: 4 } })).status, 409);
    await http(a.server.url, `/tasks/${y.taskId}/messages/${target}`, { payload: { kind: "target" } });
    await until(async () => (await http(a.server.url, `/tasks/${y.taskId}/messages/${target}`)).body.state, (value) => value === "rejected");
    assert.equal(a.engine.getRequest(y.requestId, caller).label, "共同需求");
    assert.equal(read(x).deadlineAt, x.deadlineAt); assert.equal(read(y).deadlineAt, y.deadlineAt);
    await until(() => Date.now(), (value) => value > Date.parse(x.deadlineAt) + 150);
    await http(a.server.url, `/tasks/${y.taskId}/messages/${newId()}`, { payload: { kind: "finish" } });
    const final = await finish(y);
    assert.equal(final.result.acceptedAdds, 1); assert.equal(final.result.total, 0);
    const late = await http(a.server.url, `/tasks/${y.taskId}/messages/${newId()}`, { payload: { kind: "add", amount: 1 } });
    assert.equal(late.status, 409);
    return { x, y, added, duplicate, final, late };
  });
  await scenario("未 await 宿主动作与独立句柄证明均不能提前 reclaimed", async () => {
    const task = submit({ type: "resource" });
    let released = false;
    const release = a.engine.waitForTaskRelease(task.taskId, caller).then(() => { released = true; });
    await until(() => read(task), (value) => value.stage === "completed" && resource.started);
    const run = () => a.store.read().facts.runs[read(task).run.runId];
    assert.equal(resource.finished, false); assert.equal(run().reclaimedAt, undefined); assert.equal(released, false);
    const beforeAction = structuredClone(resource);
    actionGate.resolve();
    await until(() => resource.proofStarted, Boolean);
    assert.equal(resource.finished, true); assert.equal(resource.live, true); assert.equal(run().reclaimedAt, undefined); assert.equal(released, false);
    const beforeProof = structuredClone(resource);
    proofGate.resolve(); await release;
    assert.ok(run().reclaimedAt); assert.equal(resource.live, false);
    return { beforeAction, beforeProof, final: read(task), resource };
  });
  report.events = a.store.read().events;
  await a.close(); a = undefined;
  await scenario("独立故障进程：指定取消、crash/hang、响应及按需恢复不重跑", async () => {
    const job = child("fault-child.mjs");
    try {
      const ready = await until(() => job.messages.find((message) => message.kind === "ready"), Boolean);
      const submitFault = async (label, mode) => (await job.call("submit", { request: { requestId: newId(), type: "fault", label, mode, timeoutMs: 20000 } })).snapshot;
      const get = async (task) => (await http(ready.url, `/tasks/${task.taskId}`)).body;
      const x = await submitFault("cancel-one", "wait"), y = await submitFault("survive", "wait");
      await until(() => get(y), (value) => value.run);
      await http(ready.url, `/tasks/${x.taskId}/cancel`, {});
      assert.equal((await get(y)).stage, "running");
      await http(ready.url, `/tasks/${y.taskId}/cancel`, {});
      const canceledRuns = [(await get(x)).run.runId, (await get(y)).run.runId];
      await until(async () => (await job.call("snapshot")).events,
        (events) => canceledRuns.every((id) => events.some((event) => event.type === "run.reclaimed" && event.runId === id)));
      const faults = [];
      for (const mode of ["crash", "hang"]) {
        const task = await submitFault(mode, mode);
        await until(() => get(task), (value) => value.run);
        const started = performance.now();
        assert.equal((await http(ready.url, "/task-types")).status, 200);
        const responseMs = performance.now() - started; assert.ok(responseMs < 1000);
        const failed = await until(() => get(task), (value) => value.stage === "run_failed");
        const fresh = await submitFault(`fresh-${mode}`, "normal");
        await until(() => get(fresh), (value) => value.stage === "completed");
        const invocations = (await readFile(join(root, "fault-invocations.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
        assert.equal(invocations.filter((entry) => entry.runId === failed.run.runId).length, 1);
        faults.push({ failed, fresh: await get(fresh), responseMs, invocations });
      }
      const snapshot = await job.call("snapshot");
      assert.equal(snapshot.events.filter((event) => event.type === "run.cleanup.unknown").length, 2);
      await job.stop();
      return { faults, events: snapshot.events, cleanup: job.output, note: "按自有 PID 强制清理验证进程，不将未知 Run 标为 reclaimed。" };
    } finally { await job.stop(); }
  });
  await scenario("SQLite 跨真实 Node 进程重启、原业务证据及历史", async () => {
    const first = child("restart-child.mjs", "seed");
    const before = await until(() => first.messages.find((message) => message.kind === "result"), Boolean, 20000);
    await first.exited;
    assert.equal(first.output.code, 0);
    const second = child("restart-child.mjs", "restore");
    try {
      const after = await until(() => second.messages.find((message) => message.kind === "result"), Boolean, 20000);
      await second.exited; assert.equal(second.output.code, 0);
      assert.notEqual(before.pid, after.pid);
      assert.deepEqual(after.tasks.map((task) => task.result), before.tasks.map((task) => task.result));
      assert.deepEqual(after.reads, []);
      assert.equal(after.events.filter((event) => event.type === "run.started").length, before.events.filter((event) => event.type === "run.started").length);
      return { before, after, processes: [first.output, second.output] };
    } finally { await first.stop(); await second.stop(); }
  });
  report.completedAt = new Date().toISOString(); report.passed = true;
} catch (error) { report.passed = false; report.failure = String(error); throw error; }
finally {
  for (const gate of outstanding) gate.resolve();
  for (const job of jobs) await job.stop().catch((error) => { job.output.cleanupError = String(error); });
  if (a) await a.close().catch((error) => { report.cleanupFailure = String(error); });
  if (assets) { assets.closeAllConnections(); await new Promise((done) => assets.close(done)); }
  await save();
}
