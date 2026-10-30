import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { newId } from "@potential-guide/task-engine";
import { inspectContractFiles } from "@potential-guide/check-artifacts/contracts";
import { body, fixtures } from "./fixtures.mjs";
import {
  proof, launch, rpc, request, submit, snapshot, waitTask, waitFor, history, stream,
  graceful, crash, cleanup, rows, alive, ownChild, absentChild, childTask,
} from "./helpers.mjs";

const journal = resolve("execution.jsonl");
const trace = resolve("worker-events.jsonl");
const registry = resolve("owned-processes.jsonl");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const productionWorkers = {
  check: await realpath(fileURLToPath(import.meta.resolve("@potential-guide/check-runtime-files/worker"))),
  probe: await realpath(fileURLToPath(new URL("./worker.js", import.meta.resolve("@potential-guide/probe-task")))),
};
async function record(name, action) {
  const entry = { case: name, status: "running", startedAt: new Date().toISOString() };
  proof.cases.push(entry);
  try { await action(entry); entry.status = "passed"; }
  catch (error) { entry.status = "failed"; entry.error = String(error.stack ?? error); throw error; }
  finally { entry.finishedAt = new Date().toISOString(); }
}
async function calls(name) {
  return (await rows(journal)).filter((row) => row.event === "execute" && row.name === name);
}
async function histories(item, ids) {
  return Object.fromEntries(await Promise.all([...new Set(ids)].map(async (id) => [id, await history(item, id)])));
}
async function exitedExecutions(item, ids) {
  return waitFor(async () => (await rows(trace)).filter((row) => row.pid === item.pid && row.instance === item.instance), (events) =>
    ids.every((id) => {
      const associated = events.find((row) => row.executionId === id);
      return associated && events.some((row) => row.event === "worker-exit" && row.threadId === associated.threadId);
    }), "Actual root/Check worker exit events");
}
async function physical(item) {
  const events = (await rows(trace)).filter((row) => row.pid === item.pid && row.instance === item.instance);
  const active = { probe: new Set(), check: new Set() };
  const peak = { probe: 0, check: 0 };
  assert.ok(events.some((event) => event.role === "probe" && event.event === "worker-start"));
  for (const event of events) {
    assert.ok(Object.hasOwn(active, event.role), "Unexpected execution worker role.");
    const path = await realpath(fileURLToPath(event.workerFile));
    assert.equal(path, productionWorkers[event.role], "Worker must be the installed production isolation entry.");
    const delta = relative(await realpath(process.cwd()), path);
    assert.ok(delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta));
    if (event.event === "worker-start") {
      assert.ok(!active[event.role].has(event.threadId));
      active[event.role].add(event.threadId);
      peak[event.role] = Math.max(peak[event.role], active[event.role].size);
      assert.ok(active[event.role].size <= (event.role === "probe" ? 2 : 1), "Physical capacity exceeded.");
      if (event.role === "check")
        assert.deepEqual(event.ownedChildrenAliveAtStart, [], "Check capacity reused before owned child exit.");
    } else if (event.event === "worker-exit") {
      assert.ok(active[event.role].delete(event.threadId), "Exit lacks its actual worker start.");
    }
  }
  assert.equal(active.probe.size + active.check.size, 0, "Graceful close lacks physical worker exits.");
  assert.deepEqual(await readdir(item.workers), []);
  return { events, peak, workerDirectoryEmpty: true, serverPidAbsent: !alive(item.pid) };
}
async function exclusive(item, name) {
  const childFile = resolve(`${name}-pid.json`);
  const admitted = await submit(item, body(artifacts.control, name, {
    mode: "child", childFile, childRegistry: registry, release: resolve(`${name}-release`),
  }));
  const parent = await waitTask(item, admitted.task.taskId, "running");
  const childId = await childTask(item, parent.taskId);
  const child = await waitTask(item, childId, "running");
  const spawned = await waitFor(async () => {
    try { return JSON.parse(await readFile(childFile, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  }, Boolean, "Managed OS child readiness");
  await ownChild(spawned.pid);
  assert.equal(alive(spawned.pid), true);
  await waitFor(() => history(item, childId), (history) =>
    history.events.some((event) => event.type === "execution.progress" && event.data.progress?.childPid === spawned.pid),
  "Durable owned child PID progress");
  return { admitted, parent, child, childPid: spawned.pid };
}
let artifacts;
try {
  proof.productionWorkers = Object.fromEntries(await Promise.all(
    Object.entries(productionWorkers).map(async ([role, path]) => [role, { path, sha256: sha(await readFile(path)) }]),
  ));
  proof.fixture = await fixtures();
  artifacts = proof.fixture.artifacts;
  const server = await launch("functional");
  await record("cumulative-multi-check-in-process-http-sse-idempotency", async (entry) => {
    const localBody = body(artifacts.cumulative, "local-cumulative");
    entry.inProcessRequest = { ...localBody, requestId: newId() };
    entry.localAccepted = await rpc(server, "submit", { request: entry.inProcessRequest });
    entry.local = await waitTask(server, entry.localAccepted.taskId);
    assert.equal(entry.local.result.observation.current.levelId, "basic");
    assert.equal(entry.local.result.observation.problems.length, 1);
    assert.equal(entry.local.result.references.en["checkers/gap/problems/bad"].origin.artifactDigest, artifacts["checker-gap"].digest);
    assert.equal(entry.local.result.evidence.operations.filter((op) => op.request.kind === "check").length, 4);
    entry.remoteRequest = body(artifacts.cumulative, "remote-cumulative", { delayMs: 250 });
    entry.admitted = await submit(server, entry.remoteRequest);
    const first = await stream(server, entry.admitted.task.taskId);
    entry.firstFrame = await first.frame();
    assert.notEqual(entry.firstFrame.data.snapshots[0].stage, "completed", "SSE proof needs a pre-completion checkpoint.");
    await first.close();
    entry.remote = await waitTask(server, entry.admitted.task.taskId);
    assert.deepEqual(entry.remote.result.observation.problems, entry.local.result.observation.problems);
    assert.equal(entry.remote.result.observation.current.objective.digest, artifacts.cumulative.digest);
    entry.frames = [];
    for (let index = 0; index < 2; index++) {
      const resumed = await stream(server, entry.remote.taskId, entry.firstFrame.cursor);
      const frame = await resumed.frame();
      assert.deepEqual(frame.data.snapshots[0].result, entry.remote.result);
      assert.ok(frame.data.events.every((event) => event.sequence > entry.firstFrame.data.watermark));
      entry.frames.push(frame);
      await resumed.close();
    }
    const sequences = entry.frames.flatMap((frame) => frame.data.events.map((event) => event.sequence));
    assert.ok(sequences.length > new Set(sequences).size, "Same SSE checkpoint must demonstrate at-least-once replay.");
    entry.deduplicatedSequences = [...new Set(sequences)];
    entry.idempotent = await submit(server, entry.remoteRequest, entry.admitted.id);
    assert.equal(entry.idempotent.task.taskId, entry.remote.taskId);
    entry.invocations = await calls("remote-cumulative");
    assert.deepEqual(entry.invocations.map((row) => row.role), ["pass-a", "pass-b", "pass-a", "gap"]);
    entry.children = entry.remote.result.evidence.operations.filter((op) => "snapshot" in op).map((op) => op.snapshot.taskId);
    entry.history = await histories(server, [entry.local.taskId, entry.remote.taskId, ...entry.children]);
    entry.denied = {};
    for (const [label, path, token, expected] of [
      ["anonymous", `/tasks/${entry.remote.taskId}`, null, 401],
      ["other-task", `/tasks/${entry.remote.taskId}`, "other", 403],
      ["other-child-history", `/event-history?taskId=${entry.children[0]}`, "other", 403],
      ["other-sse", `/events?taskId=${entry.remote.taskId}`, "other", 403],
    ]) {
      entry.denied[label] = (await request(server.url, path, { token })).status;
      assert.equal(entry.denied[label], expected);
    }
    const direct = await submit(server, {
      type: "check", checker: { kind: "checker", url: artifacts["checker-pass-a"].url, digest: artifacts["checker-pass-a"].digest },
      subject: { name: "standalone-check", journal }, timeoutMs: 60_000,
    });
    entry.standaloneCheck = await waitTask(server, direct.task.taskId);
    assert.equal(entry.standaloneCheck.result.ok, true);
    await rpc(server, "release", { taskId: entry.standaloneCheck.taskId });
  });
  await record("dynamic-selection-and-resolution-recheck", async (entry) => {
    entry.admitted = await submit(server, body(artifacts.dynamic, "dynamic-gap", { dependencyGap: true }));
    entry.final = await waitTask(server, entry.admitted.task.taskId);
    const result = entry.final.result;
    assert.equal(result.observation.current.levelId, "initial");
    const problem = result.observation.problems[0].problem;
    assert.equal(problem.kind, "dependency");
    assert.equal(problem.objective.digest, artifacts.dependency.digest);
    assert.deepEqual(result.evidence.operations.map((op) => op.request.kind), ["check", "resolve", "check", "check"]);
    const selected = result.evidence.operations[1];
    assert.equal(selected.request.reference.digest, undefined, "Fixture must exercise an unpinned dynamic selection.");
    assert.equal(selected.content.reference.digest, artifacts.dependency.digest);
    const exact = inspectContractFiles(new Map(Object.entries(selected.content.files).map(([path, text]) => [path, Buffer.from(text, "base64")])));
    assert.equal(exact.digest, artifacts.dependency.digest);
    const recheck = result.evidence.operations.at(-1);
    assert.deepEqual(recheck.request.context.resolutions[0].result.problems, [problem]);
    entry.invocations = await calls("dynamic-gap");
    assert.deepEqual(entry.invocations.map(({ role, recheck }) => [role, recheck]), [["dynamic", false], ["leaf", false], ["dynamic", true]]);
    entry.history = await histories(server, [entry.final.taskId, ...result.evidence.operations.filter((op) => "snapshot" in op).map((op) => op.snapshot.taskId)]);
    assert.ok(entry.history[entry.final.taskId].events.some((event) => event.data.progress?.progress?.kind === "selection"));
  });
  await record("five-distinct-parents-two-parent-workers-one-check-worker", async (entry) => {
    const started = performance.now();
    const tasks = await Promise.all(Array.from({ length: 5 }, (_, id) => submit(server, body(artifacts.control, `parallel-${id}`))));
    entry.finals = await Promise.all(tasks.map(({ task }) => waitTask(server, task.taskId)));
    entry.elapsedMs = Math.round(performance.now() - started);
    assert.ok(entry.elapsedMs < 45_000, "Concurrent parents exceeded the stated budget.");
    assert.equal(new Set(entry.finals.map((task) => task.execution.executionId)).size, 5);
    assert.ok(entry.finals.every((task) => task.result.observation.current.levelId === "ready"));
    entry.history = await histories(server, entry.finals.map((task) => task.taskId));
  });
  await record("parent-cancel-preserves-independent-shared-check-owner", async (entry) => {
    const release = resolve("shared-release");
    entry.admitted = await submit(server, body(artifacts.control, "shared", { mode: "hold", release }));
    entry.parent = await waitTask(server, entry.admitted.task.taskId, "running");
    const childId = await childTask(server, entry.parent.taskId);
    entry.childBefore = await waitTask(server, childId, "running");
    await waitFor(() => calls("shared"), (rows) => rows.length === 1, "Shared Check invocation");
    const request = await rpc(server, "request", { requestId: entry.childBefore.requestId });
    const { requestId: _requestId, ...childBody } = request;
    entry.independentRequest = { ...childBody, eligibleAt: entry.childBefore.eligibleAt, executionMatch: "started-after-eligible" };
    entry.independent = await submit(server, entry.independentRequest);
    entry.shared = await waitTask(server, entry.independent.task.taskId, "running");
    assert.equal(entry.shared.execution.executionId, entry.childBefore.execution.executionId);
    assert.equal((await requestCancel(server, entry.parent.taskId)).status, 200);
    await rpc(server, "release", { taskId: entry.parent.taskId });
    entry.canceledParent = await snapshot(server, entry.parent.taskId);
    entry.canceledChild = await snapshot(server, childId);
    entry.survivingBeforeRelease = await snapshot(server, entry.shared.taskId);
    assert.ok(entry.canceledParent.canceledAt && entry.canceledChild.canceledAt);
    assert.equal(entry.survivingBeforeRelease.canceledAt, undefined);
    assert.equal(entry.survivingBeforeRelease.stage, "running");
    const traceBeforeRelease = (await rows(trace)).filter((row) => row.instance === server.instance);
    const physicalChild = traceBeforeRelease.find((row) => row.pid === server.pid && row.event === "worker-execute" && row.executionId === entry.shared.execution.executionId);
    assert.ok(physicalChild);
    assert.ok(!traceBeforeRelease.some((row) => row.pid === server.pid && row.threadId === physicalChild.threadId && row.event === "worker-exit"));
    await writeFile(release, "release");
    entry.surviving = await waitTask(server, entry.shared.taskId);
    await rpc(server, "release", { taskId: entry.surviving.taskId });
    entry.physicalExits = await exitedExecutions(server, [entry.parent.execution.executionId, entry.shared.execution.executionId]);
    assert.equal((await calls("shared")).length, 1);
    entry.history = await histories(server, [entry.parent.taskId, childId, entry.shared.taskId]);
  });
  await record("parent-cancel-exclusive-root-check-and-owned-process", async (entry) => {
    Object.assign(entry, await exclusive(server, "cancel-exclusive"));
    assert.equal((await requestCancel(server, entry.parent.taskId)).status, 200);
    await rpc(server, "release", { taskId: entry.parent.taskId });
    entry.physicalExits = await exitedExecutions(server, [entry.parent.execution.executionId, entry.child.execution.executionId]);
    await absentChild(entry.childPid);
    entry.ownedPidAbsent = true;
    entry.childAfter = await snapshot(server, entry.child.taskId);
    assert.ok(entry.childAfter.canceledAt);
    assert.deepEqual(await readdir(server.workers), []);
    entry.history = await histories(server, [entry.parent.taskId, entry.child.taskId]);
    const next = await submit(server, body(artifacts.control, "after-exclusive-cancel"));
    entry.afterReuse = await waitTask(server, next.task.taskId);
    await rpc(server, "release", { taskId: entry.afterReuse.taskId });
  });
  await graceful(server);
  proof.functionalPhysical = await physical(server);
  await record("close-active-sse-parent-root-and-exclusive-child", async (entry) => {
    const closing = await launch("closing");
    Object.assign(entry, await exclusive(closing, "close-exclusive"));
    const active = await stream(closing, entry.parent.taskId);
    entry.firstFrame = await active.frame();
    entry.history = await histories(closing, [entry.parent.taskId, entry.child.taskId]);
    await graceful(closing);
    await active.ended();
    await absentChild(entry.childPid);
    entry.physical = await physical(closing);
    entry.ownedPidAbsent = true;
  });
  await record("crash-restart-completed-unknown-started-and-immutable-queued-root", async (entry) => {
    const first = await launch("recovery", "initial");
    const done = await submit(first, body(artifacts.control, "recovery-completed"));
    entry.completed = await waitTask(first, done.task.taskId);
    await rpc(first, "release", { taskId: entry.completed.taskId });
    const a = await submit(first, body(artifacts.control, "unknown-one", { mode: "spin" }));
    entry.parentA = await waitTask(first, a.task.taskId, "running");
    const aChildId = await childTask(first, entry.parentA.taskId);
    entry.childA = await waitTask(first, aChildId, "running");
    await waitFor(() => calls("unknown-one"), (rows) => rows.length === 1, "Unknown started actual Check");
    const b = await submit(first, body(artifacts.control, "queued-child-after-crash"));
    entry.parentB = await waitTask(first, b.task.taskId, "running");
    const bChildId = await childTask(first, entry.parentB.taskId);
    entry.childBQueued = await waitTask(first, bChildId, (task) => task.stage === "queued" && !!task.preparation?.completedAt);
    assert.equal(entry.childBQueued.execution, undefined);
    const queued = await submit(first, body(artifacts.control, "queued-initial-root", {}, {
      targetLevel: "initial", objective: { kind: "objective", url: artifacts.control.url },
    }));
    entry.queued = await waitTask(first, queued.task.taskId, (task) => task.stage === "queued" && !!task.preparation?.completedAt);
    assert.equal(entry.queued.execution, undefined);
    entry.historyBefore = await histories(first, [entry.completed.taskId, entry.parentA.taskId, entry.parentB.taskId, aChildId, bChildId, entry.queued.taskId]);
    entry.downloadsBefore = await rows("downloads.jsonl");
    await crash(first);
    entry.crashedWorkerEvents = (await rows(trace)).filter((row) => row.pid === first.pid && row.instance === first.instance);
    entry.crash = { processPid: first.pid, absent: !alive(first.pid), gracefulWorkerExitClaimed: false,
      materializedDirectories: await readdir(first.workers) };
    await writeFile(artifacts.control.archive, await readFile(artifacts.replacement.archive));
    entry.changedSource = { beforeDigest: artifacts.control.digest, afterDigest: artifacts.replacement.digest,
      archiveSha256: sha(await readFile(artifacts.control.archive)) };
    assert.notEqual(entry.changedSource.beforeDigest, entry.changedSource.afterDigest);
    const restarted = await launch("recovery", "restart");
    assert.deepEqual(restarted.binding.environment, first.binding.environment);
    entry.restoredCompleted = await snapshot(restarted, entry.completed.taskId);
    assert.deepEqual(entry.restoredCompleted.result, entry.completed.result);
    assert.equal(entry.restoredCompleted.execution.executionId, entry.completed.execution.executionId);
    entry.interrupted = [];
    for (const original of [entry.parentA, entry.parentB, entry.childA]) {
      const restored = await waitTask(restarted, original.taskId, "execution_failed");
      assert.equal(restored.error.code, "execution_interrupted");
      for (const field of ["requestId", "taskId", "seriesId", "deadlineAt"])
        assert.equal(restored[field], original[field]);
      assert.equal(restored.execution.executionId, original.execution.executionId);
      entry.interrupted.push(restored);
    }
    entry.resumedRoot = await waitTask(restarted, entry.queued.taskId);
    assert.equal(entry.resumedRoot.result.observation.current.objective.digest, artifacts.control.digest);
    assert.equal(entry.resumedRoot.result.observation.current.levelId, "initial");
    assert.equal(entry.resumedRoot.result.evidence.operations.length, 0);
    assert.equal(entry.resumedRoot.result.references.en.objective.origin.artifactDigest, artifacts.control.digest);
    for (const field of ["requestId", "taskId", "seriesId", "deadlineAt"])
      assert.equal(entry.resumedRoot[field], entry.queued[field]);
    entry.resumedIndependentChild = await waitTask(restarted, bChildId);
    assert.equal(entry.resumedIndependentChild.result.ok, true);
    assert.equal((await calls("unknown-one")).length, 1);
    assert.equal((await calls("queued-child-after-crash")).length, 1);
    entry.downloadsAfter = await rows("downloads.jsonl");
    assert.deepEqual(entry.downloadsAfter, entry.downloadsBefore, "Prepared recovery attempted source replacement.");
    entry.historyAfter = await histories(restarted, [entry.completed.taskId, entry.parentA.taskId, entry.parentB.taskId, aChildId, bChildId, entry.queued.taskId]);
    for (const original of [entry.parentA, entry.parentB, entry.childA])
      assert.equal(entry.historyAfter[original.taskId].events.filter((event) => event.type === "execution.started").length, 1);
    entry.caveat = "queued 根使用 targetLevel=initial，原 Prepared 与 References 在来源替换后保留；不证明新提交子 Check 的离线可用性。独立未启动子 Task B 按 Engine 原语义恢复一次，不是重跑已中断的父 Probe。";
    await graceful(restarted);
    entry.restartedPhysical = await physical(restarted);
  });
  proof.status = "passed";
} catch (error) {
  proof.status = "failed";
  proof.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  try { await cleanup(); }
  catch (error) { proof.status = "failed"; proof.cleanupError = String(error.stack ?? error); process.exitCode = 1; }
  proof.workerEvents = await rows(trace);
  proof.executionJournal = await rows(journal);
  proof.downloads = await rows("downloads.jsonl");
  proof.finishedAt = new Date().toISOString();
  await writeFile("result.json", `${JSON.stringify(proof, null, 2)}\n`);
}
function requestCancel(item, taskId) {
  return request(item.url, `/tasks/${taskId}/cancel`, { method: "POST" });
}
