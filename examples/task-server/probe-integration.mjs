import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { checkerSchemaUri, objectiveSchemaUri } from "@potential-guide/check-artifacts/contracts";
import {
  writeContractArtifact,
  packContractArtifact,
} from "@potential-guide/check-artifacts/build";
import { createArtifactSource } from "@potential-guide/check-task";
import { newId } from "@potential-guide/task-engine";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { composeProbeServer } from "./probe-config.mjs";

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
  type: "probe",
  objective: {
    kind: "objective",
    url: "https://example.test/objective.tgz",
    digest: objective.digest,
  },
  subject: {},
  timeoutMs: 20000,
};
function configure() {
  // Test-only injected transport. Public source references remain HTTPS.
  const source = createArtifactSource({
    allowedOrigins: ["https://example.test"],
    authorize(_reference, scope) {
      assert.equal(scope, "example");
    },
    download(url) {
      const filename = new URL(url).pathname === "/objective.tgz" ? "objective.tgz" : "checker.tgz";
      return readFile(join(directory, filename));
    },
  });
  return composeProbeServer({
    source,
    directory: join(directory, "workers"),
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
  const inProcess = server.engine.submit({ ...body, requestId: newId() }, caller);
  const local = await wait(() => server.engine.getTask(inProcess.taskId, caller));
  assert.equal(local.stage, "completed");
  assert.equal(local.result.observation.current.levelId, "initial");
  assert.equal(local.result.observation.problems.length, 1);
  const response = await fetch(`${server.url}/tasks`, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": newId() },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 202);
  const accepted = await response.json();
  const stream = await fetch(`${server.url}/events?taskId=${accepted.taskId}`, { headers });
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
  const history = server.engine.readHistory({ taskId: child.snapshot.taskId }, {}, caller);
  assert.ok(history.events.some((event) => event.type === "run.completed"));
  const publicHistory = await fetch(`${server.url}/event-history?taskId=${child.snapshot.taskId}`, {
    headers,
  });
  assert.equal(publicHistory.status, 200);
  assert.ok((await publicHistory.json()).events.some((event) => event.type === "run.completed"));
  assert.equal((await fetch(`${server.url}/tasks/${accepted.taskId}`)).status, 401);
  await server.close();
  server = await startTaskServer(configure());
  const restored = server.engine.getTask(accepted.taskId, caller);
  assert.deepEqual({ ...restored, timestamp: "" }, { ...remote, timestamp: "" });
  await server.close();
  server = undefined;
  assert.deepEqual(await readdir(join(directory, "workers")), []);
  console.log(
    "probe-packed: exact artifacts, one Check worker, in-process + real HTTP/SSE reconnect, authorized child history, SQLite recovery, physical cleanup",
  );
} finally {
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
