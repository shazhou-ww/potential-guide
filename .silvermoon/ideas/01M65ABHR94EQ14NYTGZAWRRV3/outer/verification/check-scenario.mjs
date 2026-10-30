import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { checkerSchemaUri } from "@potential-guide/check-artifacts/contracts";
import { writeContractArtifact, packContractArtifact } from "@potential-guide/check-artifacts/build";
import { newId } from "@potential-guide/task-engine";
import {
  proof, launch, bounded, request, submit, waitTask, history, stream,
  graceful, crash, stopCli, cleanup, rows, alive, ownedPids, sleep,
} from "./helpers.mjs";

const journal = resolve("execution.jsonl");
const workerProof = resolve("worker-exits.jsonl");
const page = Buffer.from("---\ntitle: Independent\ndescription: Independent\n---\nBody\n");
const code = await readFile("checker.cjs");
async function author(name, source, minVersion = "22.13.0") {
  const built = await writeContractArtifact(new Map([
    ["checker.yaml", Buffer.from(JSON.stringify({
      $schema: checkerSchemaUri, runtime: { type: "node", minVersion },
      entry: "checker.cjs", subjectSchema: { type: "object" }, languages: ["en"], problems: ["bad"],
    }))],
    ["checker.cjs", source], ["references/en/checker.md", page], ["references/en/problems/bad.md", page],
  ]), name);
  const packed = await packContractArtifact(built.directory, `${name}.tgz`);
  return { digest: built.digest, transportDigest: packed.transportDigest, archive: packed.archive };
}
const original = await author("checker", code);
const unavailable = await author("runtime", code, "999.0.0");
const replacement = await author("replacement", Buffer.from(code.toString().replaceAll("original", "replacement")));
proof.artifacts = { original, unavailable, replacement, sourceMode: "trusted-local-archive-resolver" };
const checker = { kind: "checker", url: "https://deployment.invalid/checker.tgz", digest: original.digest };
const body = (name, mode = "business", fields = {}) => ({
  type: "check", checker, subject: { journal, name, mode, ...fields }, timeoutMs: 60000,
});
const environment = (label, mode = "normal") => ({
  DATABASE: resolve(`${label}.sqlite`), WORKERS: resolve(`workers-${label}`),
  WORKER_PROOF: workerProof, MODE: mode, observeWorkers: true,
});
async function workerStarted(name) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const found = (await rows(journal)).find((row) => row.event === "execute" && row.name === name);
    if (found) return found;
    await sleep(10);
  }
  throw Error(`Worker never started ${name}.`);
}
async function physicalProof(pid, directory) {
  const events = (await rows(workerProof)).filter((row) => row.pid === pid);
  const started = events.filter((row) => row.event === "worker-start");
  assert.ok(started.length);
  for (const row of started)
    assert.ok(events.some((event) => event.event === "worker-exit" && event.threadId === row.threadId),
      `No physical exit for ${pid}/${row.threadId}`);
  assert.deepEqual(await readdir(directory), []);
  return events;
}
try {
  const env = environment("programmatic");
  const server = launch("check-config.mjs", env);
  await bounded(server.ready);
  const release = resolve("shared-release");
  const sharedBody = { ...body("shared", "shared", { release }), executionMatch: "completed-after-eligible" };
  const a = await submit(server.url, sharedBody);
  await waitTask(server.url, a.task.taskId, "running");
  await workerStarted("shared");
  const b = await submit(server.url, sharedBody);
  const aBound = await waitTask(server.url, a.task.taskId, "running");
  const bBound = await waitTask(server.url, b.task.taskId, "running");
  assert.equal(aBound.execution.executionId, bBound.execution.executionId);
  const refusals = {
    unauthenticated: (await request(server.url, `/tasks/${a.task.taskId}`, { token: null })).status,
    wrongScope: (await request(server.url, `/tasks/${a.task.taskId}`, { token: "other" })).status,
    unauthorizedSse: (await request(server.url, `/events?taskId=${b.task.taskId}`, { token: null })).status,
    wrongScopeSse: (await request(server.url, `/events?taskId=${b.task.taskId}`, { token: "other" })).status,
    readOnlyCancel: (await request(server.url, `/tasks/${a.task.taskId}/cancel`, { method: "POST", token: "reader" })).status,
    readOnlySubmit: (await request(server.url, "/tasks", { method: "POST", token: "reader", id: newId(), body: body("denied") })).status,
    requestCannotSelectModule: (await request(server.url, "/tasks", { method: "POST", id: newId(), body: { ...body("bad-input"), module: "./arbitrary.mjs" } })).status,
  };
  assert.deepEqual(refusals, {
    unauthenticated: 401, wrongScope: 403, unauthorizedSse: 401, wrongScopeSse: 403,
    readOnlyCancel: 403, readOnlySubmit: 403, requestCannotSelectModule: 400,
  });
  const subscription = await stream(server.url, b.task.taskId);
  const firstFrame = await subscription.frame();
  await subscription.close();
  assert.equal((await request(server.url, `/tasks/${a.task.taskId}/cancel`, { method: "POST" })).status, 200);
  await writeFile(release, "release");
  const business = await waitTask(server.url, b.task.taskId, "completed");
  assert.equal(business.result.ok, false);
  assert.equal(business.result.problems[0].parameters.revision, "original");
  const canceled = await (await request(server.url, `/tasks/${a.task.taskId}`)).json();
  assert.ok(canceled.canceledAt);
  assert.equal(canceled.result, undefined);
  let cursor = firstFrame.cursor;
  const frames = [firstFrame];
  for (let index = 0; index < 3; index++) {
    const resumed = await stream(server.url, b.task.taskId, cursor);
    const frame = await resumed.frame();
    frames.push(frame);
    cursor = frame.cursor;
    await resumed.close();
  }
  const events = await history(server.url, b.task.taskId);
  const replay = await submit(server.url, sharedBody, b.id);
  assert.equal(replay.task.taskId, b.task.taskId);
  assert.equal((await request(server.url, "/tasks", {
    method: "POST", id: b.id, body: body("conflict"),
  })).status, 409);
  const sharedInvocations = (await rows(journal)).filter((row) => row.event === "execute" && row.name === "shared");
  assert.equal(sharedInvocations.length, 1);
  proof.cases.push({
    case: "check-http-sse-shared-cancel", refusals, canceled, surviving: business,
    frames, historySequences: events.map((event) => event.sequence),
    invocationCountAfterReconnectAndIdempotency: sharedInvocations.length,
  });
  const failures = [];
  for (const [name, requestBody, stage, expectedCode, token] of [
    ["digest", { ...body("digest"), checker: { ...checker, digest: `sha256:${"0".repeat(64)}` } }, "preparation_failed", "artifact_digest_mismatch", "operator"],
    ["archive", { ...body("archive"), checker: { kind: "checker", url: "https://deployment.invalid/invalid.tgz" } }, "preparation_failed", "artifact_invalid", "operator"],
    ["runtime", { ...body("runtime"), checker: { kind: "checker", url: "https://deployment.invalid/runtime.tgz", digest: unavailable.digest } }, "preparation_failed", "unsupported_runtime", "operator"],
    ["scope", body("source-denied"), "preparation_failed", "artifact_source_denied", "other"],
    ["execution", body("execution", "error"), "execution_failed", "execution_failed", "operator"],
    ["result", body("result", "invalid-result"), "execution_failed", "execution_failed", "operator"],
    ["cleanup", body("cleanup", "cleanup-error"), "execution_failed", "execution_failed", "operator"],
  ]) {
    const response = await request(server.url, "/tasks", { method: "POST", body: requestBody, id: newId(), token });
    assert.equal(response.status, 202);
    const admitted = await response.json();
    const final = await waitTask(server.url, admitted.taskId, stage, token);
    assert.equal(final.error.code, expectedCode);
    assert.equal(final.result, undefined);
    failures.push({ name, final });
  }
  proof.cases.push({ case: "explicit-artifact-runtime-execution-failures", failures });
  const childFile = resolve("owned-child.json");
  const childTask = await submit(server.url, body("child", "child", { childFile }));
  await waitTask(server.url, childTask.task.taskId, "execution_failed");
  const childPid = JSON.parse(await readFile(childFile, "utf8")).pid;
  ownedPids.add(childPid);
  const subsequent = await submit(server.url, body("after-child"));
  await waitTask(server.url, subsequent.task.taskId, "completed");
  assert.equal(alive(childPid), false);
  proof.cases.push({ case: "owned-child-physical-cleanup-before-reuse", childPid, aliveAfterReuse: false, nextTaskId: subsequent.task.taskId });
  const active = await submit(server.url, body("shutdown-active", "spin"));
  await waitTask(server.url, active.task.taskId, "running");
  await workerStarted("shutdown-active");
  const activeSse = await stream(server.url, active.task.taskId);
  await activeSse.frame();
  await graceful(server);
  await activeSse.ended();
  proof.cases.push({ case: "active-sse-graceful-shutdown", activeTask: active.task, physicalWorkerEvents: await physicalProof(server.pid, env.WORKERS) });

  const cliEnv = environment("cli");
  const cli = launch("check-config.mjs", { ...cliEnv, cli: true });
  await bounded(cli.ready);
  const cliTask = await submit(cli.url, body("actual-cli"));
  const cliFinal = await waitTask(cli.url, cliTask.task.taskId, "completed");
  assert.equal(cliFinal.result.ok, false);
  const cliSse = await stream(cli.url, cliFinal.taskId);
  const cliFrame = await cliSse.frame();
  await cliSse.close();
  const cliReconnect = await stream(cli.url, cliFinal.taskId, cliFrame.cursor);
  await cliReconnect.frame();
  await cliReconnect.close();
  assert.ok((await history(cli.url, cliFinal.taskId)).length > 5);
  await stopCli(cli);
  proof.cases.push({ case: "actual-check-cli", final: cliFinal, physicalWorkerEvents: await physicalProof(cli.pid, cliEnv.WORKERS) });

  const restartEnv = environment("restart", "initial");
  const before = launch("check-config.mjs", restartEnv);
  await bounded(before.ready);
  const unknown = await submit(before.url, body("unknown", "spin"));
  const originalBinding = await waitTask(before.url, unknown.task.taskId, "running");
  await workerStarted("unknown");
  const queued = await submit(before.url, body("queued"));
  const queuedBefore = await waitTask(before.url, queued.task.taskId, "queued");
  const downloadsBefore = (await rows("downloads.jsonl")).length;
  await crash(before);
  await writeFile("checker.tgz", await readFile(replacement.archive));
  const restoredEnv = { ...restartEnv, WORKERS: resolve("workers-restored"), MODE: "restart" };
  const restarted = launch("check-config.mjs", restoredEnv);
  await bounded(restarted.ready);
  const interrupted = await waitTask(restarted.url, unknown.task.taskId, "execution_failed");
  assert.equal(interrupted.error.code, "execution_interrupted");
  for (const key of ["requestId", "taskId", "seriesId", "deadlineAt"])
    assert.equal(interrupted[key], originalBinding[key]);
  assert.equal(interrupted.execution.executionId, originalBinding.execution.executionId);
  const resumed = await waitTask(restarted.url, queued.task.taskId, "completed");
  for (const key of ["requestId", "taskId", "seriesId", "deadlineAt"])
    assert.equal(resumed[key], queuedBefore[key]);
  assert.equal(resumed.result.problems[0].parameters.revision, "original");
  assert.equal((await rows("downloads.jsonl")).length, downloadsBefore);
  const invocations = (await rows(journal)).filter((row) => row.event === "execute" && ["unknown", "queued"].includes(row.name));
  assert.deepEqual(invocations.map((row) => row.name), ["unknown", "queued"]);
  await graceful(restarted);
  proof.cases.push({
    case: "sqlite-crash-restart", originalBinding, queuedBefore, interrupted, resumed,
    originalDigest: original.digest, replacedSourceDigest: replacement.digest,
    downloadsBefore, downloadsAfter: (await rows("downloads.jsonl")).length,
    invocations, crashedProcessAbsent: !alive(before.pid),
    crashedSnapshotDirectories: await readdir(restartEnv.WORKERS),
    restoredPhysicalWorkerEvents: await physicalProof(restarted.pid, restoredEnv.WORKERS),
  });
  proof.workerEvents = await rows(workerProof);
  proof.executionJournal = await rows(journal);
  proof.downloads = await rows("downloads.jsonl");
  proof.status = "passed";
} catch (error) {
  proof.status = "failed";
  proof.error = String(error.stack ?? error);
  throw error;
} finally {
  await cleanup();
  await writeFile("result.json", `${JSON.stringify(proof, null, 2)}\n`);
}
