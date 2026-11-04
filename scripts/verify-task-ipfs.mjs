import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createIpfsClient, createIpfsGatewayClient } from "../packages/ipfs-content/dist/index.js";
import { buildTaskBundle } from "../packages/pguide-task-bundle/dist/build.js";
import { importTaskBundle } from "../packages/pguide-task-bundle/dist/publish.js";
import { newId } from "../packages/task-engine/dist/index.js";
import { MemoryStore } from "../packages/task-engine/dist/testing.js";
import { TaskClient } from "../packages/task-engine-http/dist/index.js";
import { startTaskServer } from "../packages/task-engine-server/dist/index.js";
import { taskSchemaUri } from "../packages/task-protocol/dist/index.js";

// The daemon must be independently managed and offline/private; this helper never starts it.
const endpoint = new URL(process.env.IPFS_API ?? "http://127.0.0.1:55001");
const gateway = new URL(process.env.IPFS_GATEWAY ?? "http://127.0.0.1:55080");
for (const url of [endpoint, gateway])
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    "Verification is loopback-only.",
  );
const ipfsClient = await createIpfsClient(endpoint.href);
const runtime = await ipfsClient.version();
const directory = resolve(".cache", `ipfs-proof-${randomUUID()}`);
await mkdir(directory, { recursive: true });
let server;
let root;
try {
  const yaml = join(directory, "task.yaml"),
    entry = join(directory, "callback.mjs");
  await writeFile(
    yaml,
    JSON.stringify({
      $schema: taskSchemaUri,
      name: "Non-sensitive offline IPFS proof",
      runtime: { type: "node", minVersion: "22.13.0" },
      entry: "worker.cjs",
      inputSchema: { type: "object" },
      resultSchema: { type: "object" },
      messageSchema: false,
    }),
  );
  const resource = Buffer.alloc(600_000, 42);
  await writeFile(join(directory, "fixture.bin"), resource);
  await writeFile(
    entry,
    `export default async (input, context) => {
    let bytes=0,chunks=0,sum=0;
    for await(const chunk of context.bundle.read("resources/fixture.bin")){
      bytes+=chunk.length;chunks++;for(const byte of chunk)sum+=byte;
    }return {bytes,chunks,sum};
  };`,
  );
  const buildOptions = {
    declaration: yaml,
    entry,
    resources: {
      "resources/fixture.bin": join(directory, "fixture.bin"),
    },
  };
  const built = await buildTaskBundle({ ...buildOptions, outDirectory: join(directory, "one") });
  const duplicate = await buildTaskBundle({
    ...buildOptions,
    outDirectory: join(directory, "two"),
  });
  assert.equal(duplicate.cid, built.cid);
  root = (await importTaskBundle(built.directory, ipfsClient)).cid;
  assert.equal(root, built.cid);
  assert.equal((await importTaskBundle(duplicate.directory, ipfsClient)).cid, root);
  const chunks = [];
  for await (const chunk of ipfsClient.cat(`${root}/resources/fixture.bin`)) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), resource);
  await rm(built.directory, { recursive: true });
  await rm(duplicate.directory, { recursive: true });
  await rm(entry);
  await rm(join(directory, "fixture.bin"));
  const options = {
    database: join(directory, "facts.sqlite"),
    ipfsClient: createIpfsGatewayClient(gateway.href),
    port: 0,
    authorize: () => true,
    resolveCaller: () => ({ scope: "proof", subject: "local" }),
  };
  server = await startTaskServer(options);
  const client = new TaskClient({ url: server.url });
  const request = { requestId: newId(), bundle: root, timeoutMs: 30_000 };
  await client.submit(request);
  const decision = await client.getRequestStatus(request.requestId, { waitMs: 10_000 });
  assert.equal(decision.status, "accepted", JSON.stringify(decision));
  const deadline = performance.now() + 15_000;
  let task;
  for (;;) {
    task = await client.getTask(decision.taskId);
    if (task.termination && (await client.getRun(task.run.runId)).reclaimedAt) break;
    assert.ok(performance.now() < deadline, JSON.stringify(task));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(task.stage, "completed", JSON.stringify(task));
  assert.deepEqual(task.result, { bytes: 600_000, chunks: 3, sum: 25_200_000 });
  const pinned = [];
  for await (const pin of ipfsClient.pin.ls({ paths: [root] })) pinned.push(pin.cid.toString());
  assert.ok(pinned.includes(root));
  await server.close();
  server = undefined;
  assert.equal((await ipfsClient.version()).version, runtime.version);
  const stillPinned = [];
  for await (const pin of ipfsClient.pin.ls({ paths: [root] }))
    stillPinned.push(pin.cid.toString());
  assert.deepEqual(stillPinned, pinned);
  server = await startTaskServer({
    ...options,
    ipfsClient: {
      block: {
        get: async () => {
          throw new Error("Historical facts must not fetch content.");
        },
      },
    },
  });
  const recovered = new TaskClient({ url: server.url });
  assert.deepEqual(await recovered.getRequest(request.requestId), request);
  assert.equal((await recovered.getTask(decision.taskId)).revision, task.revision);
  assert.ok((await recovered.getRunHistory(task.run.runId)).events.length);
  await server.close();
  server = undefined;
  server = await startTaskServer({
    ...options,
    database: undefined,
    store: new MemoryStore(),
    ipfsClient: {
      block: {
        get: async () => {
          throw new Error("Force verified gateway fallback.");
        },
      },
    },
    allowGateway: (url) => url.origin === gateway.origin,
  });
  const hinted = new TaskClient({ url: server.url });
  const hintedRequest = {
    requestId: newId(),
    bundle: { cid: root, hint: gateway.href },
    timeoutMs: 30_000,
  };
  await hinted.submit(hintedRequest);
  const hintedDecision = await hinted.getRequestStatus(hintedRequest.requestId, { waitMs: 10_000 });
  assert.equal(hintedDecision.status, "accepted", JSON.stringify(hintedDecision));
  await server.close();
  server = undefined;
  console.log(
    JSON.stringify({
      kubo: runtime.version,
      root,
      resourceBytes: resource.length,
      reproducibleImport: true,
      authorRpcAndGatewayReads: true,
      sourceIndependentWorker: true,
      streamChunks: task.result.chunks,
      durableHttpHistory: true,
      nodeAndCallerPinSurviveEngineClose: true,
    }),
  );
} finally {
  await server?.close();
  // Publication pins remain caller-owned; this helper never unpins a potentially shared CID.
  await rm(directory, { recursive: true, force: true });
}
