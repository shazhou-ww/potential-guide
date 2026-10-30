import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, readdir, rm, symlink, truncate } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkerSchemaUri, artifactLimits, formatArtifactReference, parseArtifactReference } from "@potential-guide/check-artifacts/contracts";
import { writeContractArtifact, packContractArtifact } from "@potential-guide/check-artifacts/build";
import { newId } from "@potential-guide/task-engine";
import {
  proof, launch, bounded, request, submit, waitTask, history, stream,
  graceful, crash, stopCli, cleanup, rows, alive, sleep,
} from "./helpers.mjs";

const imports = resolve("imports");
await mkdir(imports);
const journal = resolve("file-execution.jsonl");
const observer = resolve("file-worker-exits.jsonl");
const page = Buffer.from("---\ntitle: File\ndescription: File\n---\nBody\n");
const code = await readFile("checker.cjs");
async function author(name, bytes) {
  const built = await writeContractArtifact(new Map([
    ["checker.yaml", Buffer.from(JSON.stringify({
      $schema: checkerSchemaUri, runtime: { type: "node", minVersion: "22.13.0" },
      entry: "checker.cjs", subjectSchema: { type: "object" }, languages: ["en"], problems: ["bad"],
    }))],
    ["checker.cjs", bytes], ["references/en/checker.md", page], ["references/en/problems/bad.md", page],
  ]), name);
  const packed = await packContractArtifact(built.directory, `${name}.tgz`);
  return { digest: built.digest, transportDigest: packed.transportDigest, archive: packed.archive };
}
const original = await author("file-checker", code);
const replacement = await author("file-replacement", Buffer.from(code.toString().replaceAll("original", "replacement")));
const originalBytes = await readFile(original.archive);
const replacementBytes = await readFile(replacement.archive);
const archive = join(imports, "local archive #1.tgz");
await writeFile(archive, originalBytes);
const reference = { kind: "checker", url: pathToFileURL(archive).href };
const exact = { ...reference, digest: original.digest };
assert.deepEqual(parseArtifactReference(formatArtifactReference(exact)), exact);
proof.artifacts = { original, replacement, exactReference: exact, sourceMode: "real-confined-file" };
const body = (name, mode = "business", checker = exact, fields = {}) => ({
  type: "check", checker, subject: { journal, name, mode, ...fields }, timeoutMs: 60000,
});
const env = (name, extra = {}) => ({
  DATABASE: resolve(`${name}.sqlite`), WORKERS: resolve(`workers-${name}`),
  WORKER_PROOF: observer, observeWorkers: true, MODE: "file", ...extra,
});
async function started(name) {
  for (let count = 0; count < 500; count++) {
    const value = (await rows(journal)).find((row) => row.event === "execute" && row.name === name);
    if (value) return value;
    await sleep(10);
  }
  throw Error(`File worker did not start ${name}.`);
}
async function physical(pid, directory, expectWorkers = true) {
  const events = (await rows(observer)).filter((row) => row.pid === pid);
  const workers = events.filter((row) => row.event.startsWith("worker-"));
  const helpers = events.filter((row) => row.event.startsWith("file-helper-"));
  if (expectWorkers) assert.ok(workers.some((row) => row.event === "worker-start"));
  let active;
  for (const event of workers) {
    if (event.event === "worker-start") { assert.equal(active, undefined); active = event.threadId; }
    else { assert.equal(active, event.threadId); active = undefined; }
  }
  assert.equal(active, undefined);
  for (const start of helpers.filter((row) => row.event === "file-helper-start")) {
    assert.ok(helpers.some((row) => row.event === "file-helper-exit" && row.helperPid === start.helperPid));
    assert.equal(alive(start.helperPid), false);
  }
  if (expectWorkers) assert.deepEqual(await readdir(directory), []);
  const scratch = await readdir(resolve(".cache")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.ok(!scratch.some((name) => name.startsWith("check-archive-")));
  return { workers, helpers, allHelpersExited: true, ownedCompilerScratchAbsent: true };
}
try {
  const beforeDownloads = (await rows("downloads.jsonl")).length;
  const programEnv = env("file-programmatic");
  const server = launch("check-config.mjs", programEnv);
  await bounded(server.ready);
  const eligibleAt = new Date(Date.now() - 1000).toISOString();
  const mutableBody = { ...body("file-mutable", "business", reference), eligibleAt };
  const first = await submit(server.url, mutableBody);
  const firstFinal = await waitTask(server.url, first.task.taskId, "completed");
  assert.equal(firstFinal.result.problems[0].parameters.revision, "original");
  await writeFile(archive, replacementBytes);
  const second = await submit(server.url, mutableBody);
  const secondFinal = await waitTask(server.url, second.task.taskId, "completed");
  assert.equal(secondFinal.result.problems[0].parameters.revision, "replacement");
  assert.notEqual(firstFinal.execution.executionId, secondFinal.execution.executionId);
  await rm(archive);
  const pinned = await submit(server.url, body("cached-original"));
  const pinnedFinal = await waitTask(server.url, pinned.task.taskId, "completed");
  assert.equal(pinnedFinal.result.problems[0].parameters.revision, "original");
  assert.equal((await rows("downloads.jsonl")).length, beforeDownloads);
  proof.cases.push({
    case: "file-mutable-and-authorized-exact-cache", first: firstFinal, second: secondFinal,
    deletedSourceExactCache: pinnedFinal, sourceRemoved: true, httpsHookCalls: 0,
  });

  const outside = resolve("file-checker.tgz");
  const mismatch = join(imports, "mismatch.tgz");
  const corrupt = join(imports, "corrupt.tgz");
  const large = join(imports, "oversize.tgz");
  const folder = join(imports, "directory");
  const alias = join(imports, "junction");
  const outsideDirectory = resolve("file-outside");
  await mkdir(folder); await mkdir(outsideDirectory);
  await writeFile(join(outsideDirectory, "linked.tgz"), originalBytes);
  await symlink(outsideDirectory, alias, process.platform === "win32" ? "junction" : "dir");
  await writeFile(mismatch, replacementBytes);
  await writeFile(corrupt, "not an archive");
  await writeFile(large, "");
  await truncate(large, artifactLimits.archiveBytes + 1);
  const refusalCases = [
    ["outside-root", outside, "artifact_source_denied", "operator", original.digest],
    ["scope", archive, "artifact_source_denied", "other", original.digest],
    ["missing", join(imports, "absent.tgz"), "artifact_file_missing", "operator"],
    ["directory", folder, "artifact_file_not_regular", "operator"],
    ["oversize", large, "artifact_file_too_large", "operator"],
    ["corrupt", corrupt, "artifact_invalid", "operator"],
    ["digest", mismatch, "artifact_digest_mismatch", "operator", original.digest],
    ["junction", join(alias, "linked.tgz"), "artifact_file_denied", "operator"],
  ];
  const refusals = [];
  for (const [name, path, expected, token, digest] of refusalCases) {
    const source = { kind: "checker", url: pathToFileURL(path).href, ...(digest ? { digest } : {}) };
    const response = await request(server.url, "/tasks", { method: "POST", id: newId(), token, body: body(`file-${name}`, "business", source) });
    assert.equal(response.status, 202);
    const initial = await response.json();
    const final = await waitTask(server.url, initial.taskId, "preparation_failed", token);
    assert.equal(final.error.code, expected);
    assert.equal(final.result, undefined);
    refusals.push({ name, final });
  }
  const badUrl = await request(server.url, "/tasks", {
    method: "POST", id: newId(), body: body("file-query", "business", { ...exact, url: `${exact.url}?query=denied` }),
  });
  assert.equal(badUrl.status, 400);
  proof.cases.push({ case: "file-root-scope-and-source-refusals", refusals, malformedUrlStatus: badUrl.status });
  const events = await history(server.url, pinnedFinal.taskId);
  const subscription = await stream(server.url, pinnedFinal.taskId);
  const firstFrame = await subscription.frame();
  await subscription.close();
  const resumed = await stream(server.url, pinnedFinal.taskId, firstFrame.cursor);
  const lastFrame = await resumed.frame();
  await graceful(server);
  await resumed.ended();
  proof.cases.push({
    case: "file-history-sse-and-orderly-cleanup", events, firstFrame, lastFrame,
    physical: await physical(server.pid, programEnv.WORKERS),
  });

  const deniedEnv = env("file-denied", { FILE_ROOTS: "deny" });
  const denied = launch("check-config.mjs", deniedEnv);
  await bounded(denied.ready);
  await writeFile(archive, originalBytes);
  const requestBody = { ...body("file-no-roots"), context: { allowedFileRoots: [imports], scope: "one" } };
  const noRoots = await submit(denied.url, requestBody);
  const deniedFinal = await waitTask(denied.url, noRoots.task.taskId, "preparation_failed");
  assert.equal(deniedFinal.error.code, "artifact_source_denied");
  await graceful(denied);
  const deniedPhysical = await physical(denied.pid, deniedEnv.WORKERS, false);
  assert.equal(deniedPhysical.workers.length, 0);
  assert.equal(deniedPhysical.helpers.length, 0);
  proof.cases.push({ case: "absent-file-roots-and-body-context-cannot-grant", final: deniedFinal, physical: deniedPhysical });

  const cliEnv = env("file-cli");
  const cli = launch("check-config.mjs", { ...cliEnv, cli: true });
  await bounded(cli.ready);
  const cliTask = await submit(cli.url, body("real-file-cli"));
  const cliFinal = await waitTask(cli.url, cliTask.task.taskId, "completed");
  assert.equal(cliFinal.result.problems[0].parameters.revision, "original");
  await stopCli(cli);
  proof.cases.push({ case: "actual-cli-real-file-source", final: cliFinal, physical: await physical(cli.pid, cliEnv.WORKERS) });

  const restartPath = join(imports, "restart.tgz");
  await writeFile(restartPath, originalBytes);
  const restartReference = { kind: "checker", url: pathToFileURL(restartPath).href, digest: original.digest };
  const restartEnv = env("file-restart", { MODE: "initial" });
  const initial = launch("check-config.mjs", restartEnv);
  await bounded(initial.ready);
  const unknown = await submit(initial.url, body("file-unknown", "spin", restartReference));
  const bound = await waitTask(initial.url, unknown.task.taskId, "running");
  await started("file-unknown");
  const queued = await submit(initial.url, body("file-queued", "business", restartReference));
  const queuedBefore = await waitTask(initial.url, queued.task.taskId, "queued");
  const downloadsBefore = (await rows("downloads.jsonl")).length;
  await crash(initial, "file-sqlite-crash");
  await writeFile(restartPath, replacementBytes);
  await rm(restartPath);
  const restoredEnv = { ...restartEnv, MODE: "restart", WORKERS: resolve("workers-file-restored") };
  const restored = launch("check-config.mjs", restoredEnv);
  await bounded(restored.ready);
  const interrupted = await waitTask(restored.url, unknown.task.taskId, "execution_failed");
  const recovered = await waitTask(restored.url, queued.task.taskId, "completed");
  assert.equal(interrupted.error.code, "execution_interrupted");
  assert.equal(interrupted.execution.executionId, bound.execution.executionId);
  for (const [before, after] of [[bound, interrupted], [queuedBefore, recovered]])
    for (const key of ["requestId", "taskId", "seriesId", "deadlineAt"]) assert.equal(after[key], before[key]);
  assert.equal(recovered.result.problems[0].parameters.revision, "original");
  assert.equal((await rows("downloads.jsonl")).length, downloadsBefore);
  const invocations = (await rows(journal)).filter((row) => row.event === "execute" && ["file-unknown", "file-queued"].includes(row.name));
  assert.deepEqual(invocations.map((row) => row.name), ["file-unknown", "file-queued"]);
  await graceful(restored);
  const recoveredPhysical = await physical(restored.pid, restoredEnv.WORKERS);
  assert.equal(recoveredPhysical.helpers.length, 0, "Restoration must not acquire the deleted file.");
  proof.cases.push({
    case: "real-file-sqlite-restart-with-removed-replaced-source",
    bound, queuedBefore, interrupted, recovered, invocations,
    originalDigest: original.digest, replacedDigest: replacement.digest,
    fileRemovedBeforeRestart: true, httpsDownloadsBefore: downloadsBefore,
    httpsDownloadsAfter: (await rows("downloads.jsonl")).length,
    crashedProcessAbsent: !alive(initial.pid), restored: recoveredPhysical,
  });
  assert.equal((await rows("downloads.jsonl")).length, beforeDownloads);
  proof.httpsHookCallsForAllFileCases = 0;
  proof.workerAndHelperEvents = await rows(observer);
  proof.executionJournal = await rows(journal);
  proof.status = "passed";
} catch (error) {
  proof.status = "failed";
  proof.error = String(error.stack ?? error);
  throw error;
} finally {
  await cleanup();
  await writeFile("file-result.json", `${JSON.stringify(proof, null, 2)}\n`);
}
