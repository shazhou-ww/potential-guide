import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { newId } from "@silvermoon-work/task-engine";
import { TaskClient } from "@silvermoon-work/task-engine-http";
import { TaskError } from "@silvermoon-work/task-protocol";

function describe(error) {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    ...(typeof error?.code === "string" ? { code: error.code } : {}),
    ...(typeof error?.cause?.code === "string" ? { transportCode: error.cause.code } : {}),
    message: error instanceof Error ? error.message : String(error),
  };
}
function lostReply(error) {
  if (error instanceof TaskError) return false;
  if (error instanceof Error && error.name === "TimeoutError") return true;
  const code = error?.cause?.code ?? error?.code;
  if (code !== undefined)
    return [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EPIPE",
      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "EAI_AGAIN",
    ].includes(code);
  return error instanceof TypeError && /^(fetch failed|Failed to fetch)$/.test(error.message);
}
function bounded(action, milliseconds, timeout) {
  if (milliseconds <= 0) return Promise.reject(timeout);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeout), milliseconds);
    Promise.resolve()
      .then(action)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

export async function submitProbeObjective({
  client,
  cid,
  input,
  requestId = newId(),
  timeoutMs = 120_000,
  observationMs = 125_000,
  cleanupMs = 5000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  report = (event) => console.error(JSON.stringify(event)),
}) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ["requestId", "bundle", "timeoutMs", "eligibleAt", "seriesId", "matchPolicy"].some((key) =>
      Object.hasOwn(input, key),
    )
  )
    throw new Error("Business input must be an object without Task envelope fields.");
  for (const value of [timeoutMs, observationMs, cleanupMs])
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid submission budget.");
  const deadline = now() + observationMs;
  const timeout = new TaskError(
    "observation_timeout",
    `Observation deadline exceeded; recover request ${requestId}. Cancellation is not proof of physical release.`,
  );
  const observe = (action) => bounded(action, deadline - now(), timeout);
  const request = { ...input, requestId, bundle: cid, timeoutMs };
  let taskId;
  let submissionFailure;
  report({ event: "submission", requestId, bundle: cid });
  try {
    let decision;
    try {
      decision = await observe(() => client.submit(request));
    } catch (primary) {
      if (!lostReply(primary)) throw primary;
      submissionFailure = primary;
      report({ event: "submission_reconciliation", requestId, original: describe(primary) });
      try {
        decision = await observe(() => client.getRequestStatus(requestId, { waitMs: 1000 }));
      } catch (reconciliation) {
        report({
          event: "submission_uncertain",
          requestId,
          original: describe(primary),
          reconciliation: describe(reconciliation),
        });
        const error = new AggregateError(
          [primary, reconciliation],
          `Submission ${requestId} uncertain: ${describe(primary).message}; reconciliation failed: ${describe(reconciliation).message}. Recover the original request ID.`,
          { cause: primary },
        );
        if (reconciliation === timeout) error.code = timeout.code;
        throw error;
      }
      report({ event: "submission_reconciled", requestId, status: decision.status });
    }
    for (;;) {
      if (decision.status === "rejected") {
        const rejection = new TaskError(decision.error.code, decision.error.message, { requestId });
        if (submissionFailure) rejection.cause = submissionFailure;
        throw rejection;
      }
      if (now() >= deadline) throw timeout;
      if (decision.status === "preparing") {
        decision = await observe(() => client.getRequestStatus(requestId, { waitMs: 1000 }));
        continue;
      }
      taskId = decision.taskId;
      const task = await observe(() => client.getTask(taskId));
      if (["completed", "failed", "stopped"].includes(task.stage)) return task;
      await observe(() => sleep(25));
    }
  } catch (primary) {
    if (primary?.code !== "observation_timeout") throw primary;
    report({ event: "observation_deadline", requestId, taskId, error: describe(primary) });
    const cleanupDeadline = Date.now() + cleanupMs;
    const cleanupTimeout = new TaskError("cleanup_timeout", `Cleanup of ${requestId} unconfirmed.`);
    const cleanup = (action) => bounded(action, cleanupDeadline - Date.now(), cleanupTimeout);
    try {
      if (!taskId) {
        const decision = await cleanup(() => client.getRequestStatus(requestId, { waitMs: 0 }));
        if (decision.status === "accepted") taskId = decision.taskId;
        else
          report({
            event: decision.status === "rejected" ? "admission_rejected" : "cleanup_uncertain",
            requestId,
            status: decision.status,
            physicalReleaseConfirmed: false,
          });
      }
      if (taskId) {
        await cleanup(() => client.cancelTask(taskId));
        report({
          event: "cancellation_acknowledged",
          requestId,
          taskId,
          physicalReleaseConfirmed: false,
        });
      }
    } catch (cleanupError) {
      report({
        event: "cleanup_uncertain",
        requestId,
        taskId,
        error: describe(cleanupError),
        physicalReleaseConfirmed: false,
      });
      throw new AggregateError(
        [primary, cleanupError],
        `${describe(primary).message} Cleanup unconfirmed: ${describe(cleanupError).message}`,
        { cause: primary },
      );
    }
    throw primary;
  }
}

async function main() {
  const [url, cid, inputFile] = process.argv.slice(2);
  if (!url || !cid || !inputFile)
    throw new Error(
      "Usage: node scripts\\submit-probe-objective.mjs <Engine URL> <Probe CID> <business-input.json>",
    );
  const client = new TaskClient({
    url,
    ...(process.env.PGUIDE_TASK_AUTHORIZATION
      ? { headers: { Authorization: process.env.PGUIDE_TASK_AUTHORIZATION } }
      : {}),
  });
  const task = await submitProbeObjective({
    client,
    cid,
    input: JSON.parse(await readFile(inputFile, "utf8")),
  });
  console.log(JSON.stringify(task, null, 2));
  if (task.stage !== "completed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
