import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [consumer, output] = process.argv.slice(2);
assert(
  consumer && output,
  "Usage: node --experimental-import-meta-resolve Delivery-verification.mjs <consumer> <output.json>",
);
const resolve = (name) =>
  import.meta.resolve(name, pathToFileURL(join(consumer, "package.json")).href);
const load = (name) => import(resolve(name));
const { CarReader } = await load("@ipld/car");
const { exporter } = await load("ipfs-unixfs-exporter");
const { createIpfsGatewayClient, newId } = await load("@potential-guide/task-engine");
const { startTaskServer } = await load("@potential-guide/task-engine-server");
const { TaskClient } = await load("@potential-guide/task-engine-http");
const gateway = "https://pinboard.shazhou.work";
const bundlesPath = join(
  dirname(fileURLToPath(resolve("@potential-guide/check-environment"))),
  "bundles",
);
const references = JSON.parse(await readFile(join(bundlesPath, "references.json"), "utf8"));
const evidence = {
  observedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  source: "Pinned published npm packages, outside repository; public Gateway only",
  gateway,
  ubuntuVerified: false,
  bundles: [],
  cases: [],
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contentClient = createIpfsGatewayClient(gateway);
const bytesOf = async (entry) => {
  assert(["file", "raw"].includes(entry.type));
  const chunks = [];
  for await (const chunk of entry.content()) chunks.push(chunk);
  return Buffer.concat(chunks);
};
let server;
let endpoint;
let activeRequests = 0;
const scratch = await mkdtemp(join(tmpdir(), "check-delivery-"));
try {
  for (const [kind, reference] of Object.entries(references)) {
    const car = await readFile(join(bundlesPath, reference.car));
    const reader = await CarReader.fromBytes(car);
    const roots = await reader.getRoots();
    assert.equal(roots.length, 1);
    assert.equal(roots[0].toString(), reference.cid);
    const blocks = new Map();
    for await (const block of reader.blocks()) blocks.set(block.cid.toString(), block.bytes);
    const record = {
      kind,
      cid: reference.cid,
      carBytes: car.length,
      carSha256: digest(car),
      blocks: [],
      resources: [],
    };
    evidence.bundles.push(record);
    for (const [cid, expected] of blocks) {
      const actual = await contentClient.block.get(cid);
      assert.deepEqual(Buffer.from(actual), Buffer.from(expected));
      record.blocks.push({ cid, bytes: actual.length, sha256: digest(actual) });
    }
    const store = {
      get: async function* (cid) {
        yield await contentClient.block.get(cid.toString());
      },
    };
    const index = JSON.parse(
      await readFile(join(bundlesPath, reference.directory, "resources", "check.json"), "utf8"),
    );
    const paths = ["resources/check.json"];
    for (const referenceSet of Object.values(index.references)) {
      paths.push(referenceSet.check, ...Object.values(referenceSet.problems));
    }
    for (const path of paths) {
      const actual = await bytesOf(await exporter(`${reference.cid}/${path}`, store));
      const expected = await readFile(join(bundlesPath, reference.directory, ...path.split("/")));
      assert.deepEqual(actual, expected);
      record.resources.push({
        path,
        bytes: actual.length,
        sha256: digest(actual),
        matchedPublishedBytes: true,
      });
    }
    const response = await fetch(`${gateway}/ipfs/${reference.cid}/resources/check.json`, {
      signal: AbortSignal.timeout(30000),
    });
    record.httpPath = { status: response.status, body: await response.text() };
    record.verifiedBlocks = record.blocks.length;
    record.referencePages = record.resources.length - 1;
  }
  const directory = join(scratch, "directory");
  await mkdir(directory);
  const beforeFiles = await readdir(directory);
  endpoint = createServer((request, response) => {
    activeRequests++;
    response.once("close", () => activeRequests--);
    if (request.url === "/hang") return;
    response.writeHead(request.url === "/gap" ? 503 : 200);
    response.end("owned validation endpoint");
  });
  await new Promise((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  const localUrl = `http://127.0.0.1:${endpoint.address().port}`;
  server = await startTaskServer({
    host: "127.0.0.1",
    port: 0,
    database: join(scratch, "engine.sqlite"),
    ipfsClient: createIpfsGatewayClient(gateway),
    authorize: () => true,
    resolveCaller: () => ({ scope: "delivery-verification", subject: "delivery-verifier" }),
  });
  let client = new TaskClient({ url: server.url });
  evidence.engineUrl = server.url;
  const until = async (action, ready, timeout = 45000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await action();
      if (ready(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Observation deadline exceeded.");
  };
  const execute = async (label, cid, input, expected, cancel = false) => {
    const request = { requestId: newId(), bundle: cid, timeoutMs: 30000, ...input };
    let decision = await client.submit(request);
    if (decision.status === "preparing") {
      decision = await until(
        () => client.getRequestStatus(request.requestId, { waitMs: 1000 }),
        (value) => value.status !== "preparing",
      );
    }
    assert.equal(decision.status, "accepted", JSON.stringify(decision));
    const taskId = decision.taskId;
    const bound = await until(
      () => client.getTask(taskId),
      (value) => Boolean(value.run?.runId),
    );
    if (cancel) {
      await until(
        async () => activeRequests,
        (value) => value > 0,
      );
      await client.cancelTask(taskId);
    }
    const run = await until(
      () => client.getRun(bound.run.runId),
      (value) => Boolean(value.reclaimedAt),
    );
    const task = await client.getTask(taskId);
    const record = {
      label,
      request,
      taskId,
      runId: run.runId,
      taskStage: task.stage,
      runStage: run.stage,
      canceled: task.canceled,
      result: run.result,
      error: run.error,
      exit: run.exit,
      reclaimedAt: run.reclaimedAt,
    };
    evidence.cases.push(record);
    assert(run.exit);
    assert(run.reclaimedAt);
    assert.equal(run.stage, expected);
    if (expected === "completed") {
      if (label.endsWith("-pass")) assert.deepEqual(run.result, { pass: true });
      else {
        assert.equal(run.result.pass, false);
        assert(run.result.problems.length > 0);
      }
    } else {
      assert.equal(run.result, undefined);
      if (cancel) assert.equal(task.canceled, true);
      else assert(run.error);
    }
  };
  await execute(
    "tools-pass",
    references.tools.cid,
    { tools: [{ command: process.execPath, args: ["--version"], minimumVersion: "22.13.0" }] },
    "completed",
  );
  await execute(
    "tools-gap",
    references.tools.cid,
    {
      tools: [
        {
          command: process.execPath,
          args: ["-e", "console.log('1.0.0')"],
          minimumVersion: "2.0.0",
        },
      ],
    },
    "completed",
  );
  const toolPidFile = join(scratch, "tool.pid");
  await execute(
    "tools-fault",
    references.tools.cid,
    {
      tools: [
        {
          command: process.execPath,
          args: [
            "-e",
            `require('node:fs').writeFileSync(${JSON.stringify(toolPidFile)}, String(process.pid)); setInterval(() => {}, 1000)`,
          ],
          minimumVersion: "1.0.0",
        },
      ],
      checkTimeoutMs: 1000,
    },
    "failed",
  );
  const toolPid = Number(await readFile(toolPidFile, "utf8"));
  assert(Number.isSafeInteger(toolPid) && toolPid > 0);
  assert.throws(
    () => process.kill(toolPid, 0),
    (error) => error.code === "ESRCH",
  );
  evidence.releasedToolPid = toolPid;
  await execute(
    "directories-pass",
    references.directories.cid,
    { directories: [{ path: directory, requirements: ["exists", "read", "write"] }] },
    "completed",
  );
  assert.deepEqual(await readdir(directory), beforeFiles);
  await execute(
    "directories-gap",
    references.directories.cid,
    { directories: [{ path: join(scratch, "absent"), requirements: ["exists"] }] },
    "completed",
  );
  const networkInput = (path, timeout = 5000) => ({
    dns: [],
    http: [{ url: `${localUrl}${path}`, expectedStatus: [200], followRedirects: false }],
    checkTimeoutMs: timeout,
  });
  await execute("network-pass", references.network.cid, networkInput("/pass"), "completed");
  await execute("network-gap", references.network.cid, networkInput("/gap"), "completed");
  await execute("network-fault", references.network.cid, networkInput("/hang", 100), "failed");
  await until(
    async () => activeRequests,
    (value) => value === 0,
  );
  await execute(
    "network-cancel",
    references.network.cid,
    networkInput("/hang", 10000),
    "stopped",
    true,
  );
  await until(
    async () => activeRequests,
    (value) => value === 0,
  );
  evidence.directoryProbeRestored = true;
  evidence.activeHttpRequestsAfterRelease = activeRequests;
  evidence.windowsPublicConsumptionPassed = true;
  await server.close();
  server = undefined;
  const authorCar = await readFile(
    join(consumer, "author", "dist", "staging", "text", "bundle.car"),
  );
  const authorReader = await CarReader.fromBytes(authorCar);
  const authorRoots = await authorReader.getRoots();
  assert.equal(authorRoots.length, 1);
  const authorCid = authorRoots[0].toString();
  assert.equal(authorCid, "bafybeicldl4w2juh77ex3adu5hbxebljdnvt6te2many2tgphlkf2uqtqu");
  const authorBlocks = new Map();
  for await (const block of authorReader.blocks())
    authorBlocks.set(block.cid.toString(), block.bytes);
  evidence.author = {
    cid: authorCid,
    carBytes: authorCar.length,
    carSha256: digest(authorCar),
    source:
      "New author copied from installed published check-sdk example, built outside repository",
    transport: "Local authored CAR blocks, NOT a public Gateway or Ubuntu proof",
  };
  server = await startTaskServer({
    host: "127.0.0.1",
    port: 0,
    database: join(scratch, "author.sqlite"),
    ipfsClient: {
      block: {
        get: async (cid) => {
          const block = authorBlocks.get(cid);
          assert(block, `Missing authored CAR block ${cid}`);
          return block;
        },
      },
    },
    authorize: () => true,
    resolveCaller: () => ({ scope: "delivery-verification", subject: "delivery-verifier" }),
  });
  client = new TaskClient({ url: server.url });
  await execute("author-pass", authorCid, { text: "independent published Check SDK" }, "completed");
  await execute("author-gap", authorCid, { text: " " }, "completed");
  evidence.author.actualConsumerPassed = true;
} catch (error) {
  evidence.failure = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  try {
    if (server) await server.close();
    if (endpoint) {
      endpoint.closeAllConnections();
      await new Promise((resolve, reject) =>
        endpoint.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await rm(scratch, { recursive: true, force: true });
    evidence.ownedResourcesReleased = true;
  } catch (error) {
    evidence.cleanupFailure = { name: error.name, message: error.message };
    process.exitCode = 1;
  }
  evidence.finishedAt = new Date().toISOString();
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    JSON.stringify({
      cases: evidence.cases.length,
      references: evidence.bundles.reduce((sum, item) => sum + (item.referencePages ?? 0), 0),
      failure: evidence.failure,
      output,
    }),
  );
}
