import { readFile } from "node:fs/promises";
import { newId } from "../packages/task-engine/dist/identity.js";
import { TaskClient } from "../packages/task-engine-http/dist/index.js";

const [url, cid, inputFile] = process.argv.slice(2);
if (!url || !cid || !inputFile)
  throw new Error(
    "Usage: node scripts\\submit-probe-objective.mjs <Engine URL> <Probe CID> <business-input.json>",
  );
const input = JSON.parse(await readFile(inputFile, "utf8"));
if (
  !input ||
  typeof input !== "object" ||
  Array.isArray(input) ||
  ["requestId", "bundle", "timeoutMs", "eligibleAt", "seriesId", "matchPolicy"].some((key) =>
    Object.hasOwn(input, key),
  )
)
  throw new Error("Business input must be an object without Task envelope fields.");
const client = new TaskClient({
  url,
  ...(process.env.PGUIDE_TASK_AUTHORIZATION
    ? { headers: { Authorization: process.env.PGUIDE_TASK_AUTHORIZATION } }
    : {}),
});
const requestId = newId();
let taskId;
const deadline = Date.now() + 125_000;
const request = { ...input, requestId, bundle: cid, timeoutMs: 120_000 };
console.error(JSON.stringify({ requestId, bundle: cid }));
let decision;
try {
  decision = await client.submit(request);
} catch {
  // Lost submit reply is not permission to change the request identity.
  decision = await client.getRequestStatus(requestId, { waitMs: 1000 });
}
while (Date.now() < deadline) {
  if (decision.status === "rejected") throw new Error(JSON.stringify(decision));
  if (decision.status === "preparing") {
    decision = await client.getRequestStatus(requestId, { waitMs: 1000 });
    continue;
  }
  taskId = decision.taskId;
  const task = await client.getTask(taskId);
  if (["completed", "failed", "stopped"].includes(task.stage)) {
    console.log(JSON.stringify(task, null, 2));
    if (task.stage !== "completed") process.exitCode = 1;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
}
if (Date.now() >= deadline) {
  if (taskId) await client.cancelTask(taskId);
  throw new Error(
    `Observation deadline exceeded; recover request ${requestId}. Cancellation is not proof of physical release.`,
  );
}
