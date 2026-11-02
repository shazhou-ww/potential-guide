import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  packContractArtifact,
  writeContractArtifact,
} from "@potential-guide/check-artifacts/build";
import { checkerSchemaUri, objectiveSchemaUri } from "@potential-guide/check-artifacts/contracts";
import { newId } from "@potential-guide/task-engine";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { composeProbeServer } from "./probe-config.mjs";
import { buildExampleBundle } from "./build-bundles.mjs";

const directory = resolve(".cache", `probe-integration-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const page = Buffer.from("---\ntitle: Packed\ndescription: Packed\n---\nBody\n");
const checker = await writeContractArtifact(
  new Map([
    [
      "checker.yaml",
      Buffer.from(
        JSON.stringify({
          $schema: checkerSchemaUri,
          runtime: { type: "node", minVersion: "22.13.0" },
          entry: "checker.cjs",
          subjectSchema: { type: "object" },
          languages: ["en"],
          problems: ["bad"],
        }),
      ),
    ],
    [
      "checker.cjs",
      Buffer.from(
        "exports.execute=async(s,c)=>{c.progress({step:1});return {status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'bad',parameters:{reason:'observed gap'}}]}}}",
      ),
    ],
    ["references/en/checker.md", page],
    ["references/en/problems/bad.md", page],
  ]),
  join(directory, "checker"),
);
const objective = await writeContractArtifact(
  new Map([
    [
      "objective.yaml",
      Buffer.from(
        JSON.stringify({
          $schema: objectiveSchemaUri,
          subjectSchema: { type: "object" },
          languages: ["en"],
          levels: [{ id: "ready", checks: ["check"] }],
          checkers: {
            check: {
              url: "https://example.test/checker.tgz",
              digest: checker.digest,
              subjectMapping: "$",
            },
          },
        }),
      ),
    ],
    ["references/en/objective.md", page],
    ["references/en/levels/ready.md", page],
  ]),
  join(directory, "objective"),
);
await packContractArtifact(checker.directory, join(directory, "checker.tgz"));
await packContractArtifact(objective.directory, join(directory, "objective.tgz"));
const caller = { scope: "example", subject: "example" };
const headers = { authorization: "Bearer fixture", "content-type": "application/json" };
const body = {
  objective: {
    kind: "objective",
    url: "https://example.test/objective.tgz",
    digest: objective.digest,
  },
  subject: {},
  timeoutMs: 20000,
};
function configure() {
  return composeProbeServer({
    database: join(directory, "tasks.sqlite"),
    token: "fixture",
  });
}
async function wait(read) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const snapshot = await read();
    if (snapshot.termination) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Probe integration timed out.");
}
async function observation(reader) {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n\n")) {
    const chunk = await reader.read();
    assert.ok(!chunk.done, "SSE ended before its observation frame.");
    text += decoder.decode(chunk.value, { stream: true });
  }
  return {
    cursor: /^id: (.+)$/m.exec(text)[1],
    value: JSON.parse(/^data: (.+)$/m.exec(text)[1]),
  };
}
let server;
try {
  server = await startTaskServer(configure());
  const authorOptions = {
    directory: join(directory, "author"),
    sourceOptions: { allowedOrigins: ["https://example.test"] },
    downloadResources: {
      "https://example.test/checker.tgz": "resources/checker.tgz",
      "https://example.test/objective.tgz": "resources/objective.tgz",
    },
    resources: {
      "resources/checker.tgz": join(directory, "checker.tgz"),
      "resources/objective.tgz": join(directory, "objective.tgz"),
    },
  };
  const checkBundle = await buildExampleBundle({ ...authorOptions, kind: "check" });
  const probeBundle = await buildExampleBundle({
    ...authorOptions,
    kind: "probe",
    checkBundle,
    serviceUrl: server.url,
    token: "fixture",
  });
  body.bundle = probeBundle;
  let inProcess = await server.engine.submit({ ...body, requestId: newId() }, caller);
  while (inProcess.status === "preparing")
    inProcess = await server.engine.getRequestStatus(inProcess.requestId, { waitMs: 1000 }, caller);
  assert.equal(inProcess.status, "accepted");
  const local = await wait(() => server.engine.getTask(inProcess.taskId, caller));
  assert.equal(local.stage, "completed");
  assert.equal(local.result.observation.current.levelId, "initial");
  assert.equal(local.result.observation.problems.length, 1);
  const response = await fetch(`${server.url}/tasks`, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": newId() },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok);
  let decision = await response.json();
  while (decision.status === "preparing")
    decision = await (
      await fetch(`${server.url}/requests/${decision.requestId}/status?waitMs=1000`, { headers })
    ).json();
  assert.equal(decision.status, "accepted");
  const accepted = await (
    await fetch(`${server.url}/tasks/${decision.taskId}`, { headers })
  ).json();
  const stream = await fetch(`${server.url}/events?taskId=${accepted.taskId}`, {
    headers: { ...headers, "Last-Event-ID": accepted.revision },
  });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const initialObservation = await observation(reader);
  const cursor = initialObservation.cursor;
  await reader.cancel();
  const remote = await wait(async () =>
    (await fetch(`${server.url}/tasks/${accepted.taskId}`, { headers })).json(),
  );
  assert.equal(remote.stage, "completed");
  assert.deepEqual(remote.result.observation.problems, local.result.observation.problems);
  const resumed = await fetch(`${server.url}/events?taskId=${accepted.taskId}`, {
    headers: { ...headers, "Last-Event-ID": cursor },
  });
  const replay = resumed.body.getReader();
  const reconnected = await observation(replay);
  assert.deepEqual(reconnected.value.snapshots[0].result, remote.result);
  assert.ok(
    reconnected.value.events.every((event) => event.sequence > initialObservation.value.watermark),
  );
  await replay.cancel();
  const child = remote.result.evidence.operations.find((entry) => entry.request.kind === "check");
  assert.ok(child.snapshot.run.runId);
  assert.equal(child.request.reference.digest, checker.digest);
  const childRun = server.engine.getRun(child.snapshot.run.runId, caller);
  assert.equal(childRun.stage, "completed");
  const history = server.engine.getRunHistory(childRun.runId, {}, caller);
  assert.ok(history.events.some((event) => event.type === "run.exited"));
  const publicHistory = await fetch(`${server.url}/runs/${childRun.runId}/history`, {
    headers,
  });
  assert.equal(publicHistory.status, 200);
  assert.ok((await publicHistory.json()).events.some((event) => event.type === "run.exited"));
  assert.equal((await fetch(`${server.url}/tasks/${accepted.taskId}`)).status, 401);
  await server.close();
  server = await startTaskServer(configure());
  const restored = server.engine.getTask(accepted.taskId, caller);
  assert.deepEqual(
    { ...restored, timestamp: "", revision: "" },
    { ...remote, timestamp: "", revision: "" },
  );
  assert.equal(restored.dataDomain, remote.dataDomain);
  assert.ok(
    Number(restored.revision.split(":").at(-1)) >= Number(remote.revision.split(":").at(-1)),
  );
  await server.close();
  server = undefined;
  assert.deepEqual(await readdir(".business-workers"), []);
  console.log(
    "probe-packed: exact artifacts, one Check worker, in-process + real HTTP/SSE reconnect, authorized child history, SQLite recovery, physical cleanup",
  );
} finally {
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
