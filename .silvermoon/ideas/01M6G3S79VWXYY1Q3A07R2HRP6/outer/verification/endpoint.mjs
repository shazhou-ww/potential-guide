import assert from "node:assert/strict";
import { execFile, fork, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const load = (name, entry = "index") =>
  import(pathToFileURL(join(root, "packages", name, "dist", `${entry}.js`)).href);
const { createIpfsClient, protectContent } = await load("ipfs-content");
const { startTaskServer } = await load("task-engine-server");
const { TaskClient } = await load("task-engine-http");
const { newId } = await load("task-engine");
const { taskSchemaUri } = await load("task-protocol");
const { buildTaskBundle, importTaskBundle } = await load("task-sdk", "build");

if (process.argv[2] === "engine-child") {
  const [, , , endpoint, database, mode] = process.argv;
  const ipfsClient =
    mode === "missing"
      ? { block: { get: async () => { throw new Error("Controlled missing content."); } } }
      : await createIpfsClient(endpoint);
  const server = await startTaskServer({
    database,
    ipfsClient,
    port: 0,
    authorize: () => true,
    resolveCaller: () => ({ scope: "offline-proof", subject: "local" }),
  });
  process.send({ url: server.url });
  process.on("message", async (message) => {
    if (message !== "close") return;
    await server.close();
    process.disconnect();
  });
} else {
  const run = promisify(execFile);
  const scratch = await mkdtemp(join(root, ".cache", "ipfs-deployment-"));
  const executable = join(root, ".cache", "ipfs-runtime", "binary", "kubo", "ipfs.exe");
  const processes = new Set();
  let gatewayServer;
  async function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    processes.delete(child);
  }
  async function port() {
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const value = listener.address().port;
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    return value;
  }
  async function until(action, description) {
    const deadline = performance.now() + 30_000;
    let last;
    while (performance.now() < deadline) {
      try {
        const result = await action();
        if (result) return result;
      } catch (error) { last = error; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timeout: ${description}`, { cause: last });
  }
  async function node(name) {
    const repository = join(scratch, name);
    await mkdir(repository);
    const env = { ...process.env, IPFS_PATH: repository };
    const command = (...args) => run(executable, args, { env, windowsHide: true, timeout: 30_000 });
    await command("init", "--profile=test");
    const api = await port(), gateway = await port();
    await command("config", "Addresses.API", `/ip4/127.0.0.1/tcp/${api}`);
    await command("config", "Addresses.Gateway", `/ip4/127.0.0.1/tcp/${gateway}`);
    await command("config", "--json", "Addresses.Swarm", "[]");
    const child = spawn(executable, ["daemon", "--offline"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    processes.add(child);
    let log = "";
    child.stdout.on("data", (chunk) => { log += chunk; });
    child.stderr.on("data", (chunk) => { log += chunk; });
    const endpoint = `http://127.0.0.1:${api}`;
    const client = await createIpfsClient(endpoint);
    const version = await until(() => client.version(), `${name} readiness`);
    assert.ok(log.includes("Swarm not listening"), log);
    return { client, child, endpoint, gateway: `http://127.0.0.1:${gateway}`, version: version.version };
  }
  async function engine(endpoint, database, mode = "normal") {
    const child = fork(fileURLToPath(import.meta.url), ["engine-child", endpoint, database, mode], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    processes.add(child);
    let log = "";
    child.stdout.on("data", (chunk) => { log += chunk; });
    child.stderr.on("data", (chunk) => { log += chunk; });
    const message = await Promise.race([
      once(child, "message").then(([value]) => value),
      once(child, "exit").then(() => { throw new Error(`Engine exited before ready: ${log}`); }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`Engine readiness timeout: ${log}`)), 30_000); timer.unref(); }),
    ]);
    return { child, client: new TaskClient({ url: message.url }) };
  }
  async function admitted(client, bundle, extra = {}) {
    const request = { requestId: newId(), bundle, timeoutMs: 120_000, ...extra };
    await client.submit(request);
    const result = await until(async () => {
      const current = await client.getRequestStatus(request.requestId, { waitMs: 1000 });
      return current.status === "preparing" ? undefined : current;
    }, "request admission");
    return { request, result };
  }
  async function pinList(client, cid) {
    const pins = [];
    for await (const pin of client.pin.ls({ paths: [cid] })) pins.push(pin.cid.toString());
    return pins;
  }
  try {
    const publisher = await node("publisher");
    const consumer = await node("consumer");
    const author = join(scratch, "author");
    await mkdir(author);
    const declaration = join(author, "task.yaml"), entry = join(author, "callback.mjs");
    await writeFile(declaration, JSON.stringify({
      $schema: taskSchemaUri, name: "Synthetic offline deployment proof",
      runtime: { type: "node", minVersion: "22.13.0" }, entry: "worker.cjs",
      inputSchema: { type: "object" }, resultSchema: { type: "object" }, messageSchema: false,
    }));
    await writeFile(entry, `export default async (input, context) => {
      let bytes=0,sum=0,chunks=0;
      for await(const chunk of context.bundle.read("resources/data.bin")){
        bytes+=chunk.length; chunks++; for(const byte of chunk)sum+=byte;
      }
      if(input.hold){await context.progress({stage:"execution",message:"resource-read"});
        await new Promise(resolve=>setTimeout(resolve,120000));}
      return {bytes,sum,chunks};
    };`);
    const fixture = join(author, "data.bin");
    await writeFile(fixture, Buffer.alloc(600_000, 42));
    const built = await buildTaskBundle({ declaration, entry, resources: { "resources/data.bin": fixture }, outDirectory: join(author, "built") });
    const cid = (await importTaskBundle(built.directory, publisher.client)).cid;
    const blocks = new Map();
    await protectContent(publisher.client, cid, { signal: new AbortController().signal, protectedBlocks: blocks });
    for (const [key, bytes] of blocks) {
      const imported = await consumer.client.block.put(bytes, { format: key.startsWith("bafk") ? "raw" : "dag-pb", mhtype: "sha2-256", version: 1, pin: false });
      assert.equal(imported.toString(), key);
    }
    await consumer.client.pin.add(cid, { recursive: true });
    const pins = await pinList(consumer.client, cid);
    assert.ok(pins.includes(cid));
    await stop(publisher.child);
    await rm(author, { recursive: true });
    const bytes = [];
    for await (const chunk of consumer.client.cat(`${cid}/resources/data.bin`)) bytes.push(chunk);
    assert.deepEqual(Buffer.concat(bytes), Buffer.alloc(600_000, 42));
    const database = join(scratch, "facts.sqlite");
    const first = await engine(consumer.endpoint, database);
    const accepted = await admitted(first.client, cid);
    assert.equal(accepted.result.status, "accepted");
    const complete = await until(async () => {
      const task = await first.client.getTask(accepted.result.taskId);
      return task.stage === "completed" ? task : undefined;
    }, "streamed task completion");
    assert.deepEqual(complete.result, { bytes: 600_000, sum: 25_200_000, chunks: 3 });
    const held = await admitted(first.client, cid, { hold: true });
    assert.equal(held.result.status, "accepted");
    const running = await until(async () => {
      const task = await first.client.getTask(held.result.taskId);
      if (!task.run) return;
      const current = await first.client.getRun(task.run.runId);
      return current.progress?.message === "resource-read" ? task : undefined;
    }, "active Worker before controlled crash");
    await stop(first.child);
    assert.equal((await consumer.client.version()).version, consumer.version);
    assert.deepEqual(await pinList(consumer.client, cid), pins);
    const recovered = await engine(consumer.endpoint, database, "missing");
    assert.deepEqual(await recovered.client.getRequest(accepted.request.requestId), accepted.request);
    assert.equal((await recovered.client.getTask(complete.taskId)).stage, "completed");
    assert.ok((await recovered.client.getRunHistory(complete.run.runId)).events.length);
    assert.equal((await recovered.client.getTask(running.taskId)).stage, "stopped");
    const missing = await admitted(recovered.client, cid);
    assert.equal(missing.result.status, "rejected");
    recovered.child.send("close");
    await once(recovered.child, "exit");
    assert.equal((await consumer.client.version()).version, consumer.version);
    const calls = [];
    for (const hint of [consumer.gateway, [`${consumer.gateway}/missing`, consumer.gateway]]) {
      gatewayServer = await startTaskServer({
        port: 0,
        ipfsClient: { block: { get: async () => { throw new Error("Controlled gateway fallback."); } } },
        allowGateway: (url) => { calls.push(url.href); return url.origin === consumer.gateway; },
        authorize: () => true, resolveCaller: () => ({ scope: "offline-proof", subject: "local" }),
      });
      const gatewayClient = new TaskClient({ url: gatewayServer.url });
      const value = await admitted(gatewayClient, { cid, hint });
      assert.equal(value.result.status, "accepted");
      await until(async () => (await gatewayClient.getTask(value.result.taskId)).stage === "completed", "hinted Worker");
      await gatewayServer.close();
      gatewayServer = undefined;
    }
    assert.deepEqual(await pinList(consumer.client, cid), pins);
    console.log(JSON.stringify({ kubo: consumer.version, cid, blocks: blocks.size, separateOfflineNodes: true,
      publisherStoppedAndAuthorDeleted: true, resourceBytes: 600_000, chunks: complete.result.chunks,
      engineProcessCrashNodeSurvives: true, callerPinSurvives: true, historicalReadWithoutContent: true,
      unknownRunRecoveredStopped: true, missingContentRejected: true, scalarAndArrayHints: true, gatewayRequests: calls.length }));
  } finally {
    await gatewayServer?.close();
    for (const child of processes) await stop(child);
    await rm(scratch, { recursive: true, force: true });
  }
}
