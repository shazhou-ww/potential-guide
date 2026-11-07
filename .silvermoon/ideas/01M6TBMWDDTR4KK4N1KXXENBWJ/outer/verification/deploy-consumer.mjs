import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile, realpath, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CID } from "multiformats/cid";
import * as dagPb from "@ipld/dag-pb";
import { exporter } from "ipfs-unixfs-exporter";
import { createIpfsGatewayClient, GatewayReadError, newId } from "@potential-guide/task-engine";
import { readTaskBundle } from "@potential-guide/task-protocol";
import { verifyConsumer } from "./verify-consumer.mjs";

const output = resolve("proof");
await mkdir(output);
await mkdir("owned-directory", { recursive: true });
const pinboard = "https://pinboard.shazhou.work";
const roots = {
  tools: "bafybeifydrqggqypfapxiwt2bpovdprxae6iysrjhiua3d2jebico74u7a",
  directories: "bafybeicx45guntfoueeddml532gfayxuvo5jhujuf4q2wasnef4ysyrfhe",
  network: "bafybeibgc2yxmiynaq3m64ptpch6bi4ion7pqx5zh7tda6bfkxqx7ie7si",
};
const proof = {
  startedAt: new Date().toISOString(),
  roots,
  tests: [],
  http: [],
  gateways: [],
  dag: {},
  cleanup: [],
  runtime: {
    node: process.version,
    npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    platform: process.platform,
    cwd: process.cwd(),
    path: process.env.PATH,
    engineModule: await realpath(new URL(import.meta.resolve("@potential-guide/task-engine"))),
    cli: await realpath("node_modules/@potential-guide/pguide-task-engine/dist/main.js"),
    proxy:
      "Owned local TLS transport relay; allowed origins registry.npmjs.org and pinboard.shazhou.work only.",
  },
};
assert.equal(process.platform, "linux");
assert.equal(proof.runtime.node, "v24.14.1");
assert.equal(proof.runtime.npm, "11.11.0");
assert.match(proof.runtime.engineModule, /\/consumer\/node_modules\//);
assert.match(proof.runtime.cli, /\/consumer\/node_modules\//);
assert.equal(process.env.PATH, resolve("runtime-bin"));
assert.deepEqual((await readdir(process.env.PATH)).sort(), ["node", "npm"]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const blocks = new Map();
const ownedServers = [];
const services = [];
async function persist() {
  await writeFile(resolve(output, "deployment.json"), JSON.stringify(proof, null, 2) + "\n");
}
async function test(name, action) {
  const started = performance.now();
  try {
    const value = await action();
    proof.tests.push({ name, pass: true, elapsedMs: performance.now() - started, value });
    await persist();
    console.log(JSON.stringify({ name, pass: true }));
    return value;
  } catch (error) {
    proof.tests.push({
      name,
      pass: false,
      elapsedMs: performance.now() - started,
      error: { name: error.name, message: error.message, stack: error.stack },
    });
    await persist();
    throw error;
  }
}
async function listen(name, handler) {
  const state = { name, requests: [], sockets: new Set() };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    state.requests.push({
      at: new Date().toISOString(),
      method: request.method,
      path: url.pathname,
      search: url.search,
      accept: request.headers.accept,
    });
    handler(request, response, url);
  });
  server.on("connection", (socket) => {
    state.sockets.add(socket);
    socket.on("close", () => state.sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.server = server;
  ownedServers.push(state);
  return state;
}
async function api(service, path, init = {}) {
  const started = performance.now();
  const response = await fetch(service.url + path, {
    ...init,
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  const body = await response.json();
  proof.http.push({
    at: new Date().toISOString(),
    service: service.name,
    method: init.method ?? "GET",
    path,
    requestHeaders: init.headers,
    requestBody: init.body ? JSON.parse(init.body) : undefined,
    status: response.status,
    elapsedMs: performance.now() - started,
    body,
  });
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function startService(name, database, sources, total = 15000, attempt = 3000) {
  const cli = resolve("node_modules/@potential-guide/pguide-task-engine/dist/main.js");
  const args = [
    cli,
    "--no-global-config",
    "--port",
    "0",
    "--database",
    resolve(database),
    "--ipfs-gateway-urls",
    JSON.stringify(sources),
    "--ipfs-gateway-timeout-ms",
    String(total),
    "--ipfs-gateway-attempt-timeout-ms",
    String(attempt),
  ];
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  const service = { name, child, args, stdout: "", stderr: "", stopped: false };
  services.push(service);
  const exited = new Promise((done) =>
    child.once("exit", (code, signal) => {
      service.exit = { code, signal };
      done();
    }),
  );
  service.exited = exited;
  const ready = new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", () => reject(new Error(`Service startup exited: ${service.stderr}`)));
    child.stdout.on("data", (chunk) => {
      service.stdout += chunk;
      for (const line of service.stdout.split("\n")) {
        if (!line.trim()) continue;
        let value;
        try {
          value = JSON.parse(line);
        } catch (error) {
          if (line.endsWith("}")) reject(error);
          continue;
        }
        if (value.event === "ready") done(value);
      }
    });
  });
  child.stderr.on("data", (chunk) => {
    service.stderr += chunk;
  });
  const value = await bounded(ready, 20000, "Foreground service readiness timeout");
  assert.equal(value.pid, child.pid);
  service.pid = value.pid;
  service.url = value.url;
  service.ready = value;
  await api(service, "/tasks");
  return service;
}
async function stopService(service) {
  if (service.stopped) return;
  service.child.kill("SIGTERM");
  await bounded(service.exited, 15000, "Graceful service shutdown timeout");
  assert.deepEqual(service.exit, { code: 0, signal: null });
  assert.match(service.stdout, /"event":"closed"/);
  await assert.rejects(fetch(service.url + "/tasks", { signal: AbortSignal.timeout(1000) }));
  service.stopped = true;
  proof.cleanup.push({
    kind: "service",
    name: service.name,
    pid: service.pid,
    graceful: true,
    exit: service.exit,
  });
}
async function requestTask(service, name, bundle, input) {
  const requestId = newId();
  const body = JSON.stringify({ ...input, bundle, timeoutMs: 15000 });
  await api(service, "/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": requestId },
    body,
  });
  const limit = performance.now() + 30000;
  let status;
  do {
    status = await api(service, `/requests/${requestId}/status?waitMs=1000`);
    if (status.status !== "preparing") break;
    assert.ok(performance.now() < limit);
  } while (status.status === "preparing");
  assert.equal(status.status, "accepted", JSON.stringify(status));
  let task, run;
  do {
    task = await api(service, `/tasks/${status.taskId}`);
    assert.ok(!["failed", "stopped"].includes(task.stage), JSON.stringify(task));
    if (task.run) run = await api(service, `/runs/${task.run.runId}`);
    if (task.stage === "completed" && run?.exit && run.reclaimedAt) break;
    assert.ok(performance.now() < limit, "Task/Run physical reclamation timeout");
    await delay(50);
  } while (task.stage !== "completed" || !run?.exit || !run.reclaimedAt);
  assert.equal(task.requestId, requestId);
  assert.equal(task.bundle, bundle);
  assert.equal(run.bundle, bundle);
  assert.equal(run.runId, task.run.runId);
  assert.equal(run.exit.basis, "worker");
  assert.equal(run.exit.code, 0);
  assert.equal(run.cleanupUnknown, undefined);
  return { name, requestId, taskId: task.taskId, runId: run.runId, bundle, input, body, task, run };
}
async function snapshot(service, record) {
  return {
    request: await api(service, `/requests/${record.requestId}`),
    status: await api(service, `/requests/${record.requestId}/status`),
    task: await api(service, `/tasks/${record.taskId}`),
    run: await api(service, `/runs/${record.runId}`),
    taskHistory: await api(service, `/tasks/${record.taskId}/history`),
    runHistory: await api(service, `/runs/${record.runId}/history`),
  };
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["timestamp", "observedAt", "nextCursor", "expiresAt"].includes(key))
        .map(([key, child]) => [key, stable(child)]),
    );
  return value;
}
try {
  const live = createIpfsGatewayClient(pinboard, { timeoutMs: 15000, attemptTimeoutMs: 15000 });
  await test("pinboard-full-dag-cid-mime-installed-client-admission", async () => {
    for (const [name, root] of Object.entries(roots)) {
      const visited = new Set();
      const records = [];
      const walk = async (key) => {
        if (visited.has(key)) return;
        visited.add(key);
        const cid = CID.parse(key);
        const started = performance.now();
        const response = await fetch(`${pinboard}/ipfs/${key}?format=raw`, {
          headers: { accept: "application/vnd.ipld.raw" },
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("content-type").split(";")[0],
          "application/vnd.ipld.raw",
        );
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(cid.multihash.code, 0x12);
        assert.deepEqual(Buffer.from(cid.multihash.digest), Buffer.from(sha(bytes), "hex"));
        const publicBytes = await live.block.get(key);
        assert.deepEqual(Buffer.from(publicBytes), bytes);
        blocks.set(key, bytes);
        const links =
          cid.code === 0x70
            ? dagPb.decode(bytes).Links.map((link) => ({
                name: link.Name,
                cid: link.Hash.toString(),
                size: link.Tsize,
              }))
            : [];
        assert.ok([0x70, 0x55].includes(cid.code), `Unsupported codec ${cid.code}`);
        records.push({
          cid: key,
          codec: cid.code,
          bytes: bytes.length,
          sha256: sha(bytes),
          links,
          status: response.status,
          mime: response.headers.get("content-type"),
          url: response.url,
          elapsedMs: performance.now() - started,
        });
        for (const link of links) await walk(link.cid);
      };
      await walk(root);
      const files = new Map();
      const store = {
        async *get(cid) {
          const bytes = blocks.get(cid.toString());
          assert.ok(bytes, cid.toString());
          yield bytes;
        },
      };
      const entry = await exporter(root, store);
      const fileWalk = async (entry, path) => {
        if (entry.type === "directory") {
          for await (const child of entry.entries()) {
            await fileWalk(
              await exporter(child.cid, store),
              path ? `${path}/${child.name}` : child.name,
            );
          }
        } else {
          assert.ok(["file", "raw"].includes(entry.type));
          const parts = [];
          for await (const bytes of entry.content()) parts.push(bytes);
          files.set(path, Buffer.concat(parts));
        }
      };
      await fileWalk(entry, "");
      const admitted = readTaskBundle(files);
      proof.dag[name] = {
        root,
        blocks: records,
        blockCount: records.length,
        totalBlockBytes: records.reduce((sum, record) => sum + record.bytes, 0),
        files: [...files].map(([path, bytes]) => ({
          path,
          bytes: bytes.length,
          sha256: sha(bytes),
        })),
        declaration: admitted.declaration,
        resolved: admitted.resolved,
        admission:
          "Installed public task-protocol readTaskBundle; service Engine acceptance verified below.",
      };
      await persist();
    }
    const identity = await fetch(`${pinboard}/ipfs/bafkqaaa?format=raw`, {
      headers: { accept: "application/vnd.ipld.raw" },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(identity.status, 200);
    assert.equal((await identity.arrayBuffer()).byteLength, 0);
    blocks.set("bafkqaaa", Buffer.alloc(0));
    return Object.fromEntries(
      Object.entries(proof.dag).map(([name, dag]) => [
        name,
        {
          root: dag.root,
          blocks: dag.blockCount,
          bytes: dag.totalBlockBytes,
        },
      ]),
    );
  });
  const backup = await listen("pinboard-verified-read-only-backup", (request, response, url) => {
    assert.equal(request.method, "GET");
    assert.equal(request.headers.accept, "application/vnd.ipld.raw");
    assert.equal(url.search, "?format=raw");
    const bytes = blocks.get(url.pathname.split("/").at(-1));
    response.writeHead(bytes ? 200 : 404, { "content-type": "application/vnd.ipld.raw" });
    response.end(bytes);
  });
  const failed = await listen("owned-503", (_request, response) =>
    response.writeHead(503).end("owned failure"),
  );
  const missing = await listen("owned-404", (_request, response) =>
    response.writeHead(404).end("owned missing"),
  );
  const stall = await listen("owned-stall", () => {});
  const invalid = await listen("owned-corrupt-raw", (_request, response, url) => {
    response.writeHead(200, { "content-type": "application/vnd.ipld.raw" });
    response.end(
      url.pathname.endsWith("/bafkqaaa") ? Buffer.alloc(0) : Buffer.from("invalid block"),
    );
  });
  const fixture = await listen("owned-business-http", (_request, response) =>
    response.writeHead(200).end("owned fixture"),
  );
  await test("first-source-failure-live-pinboard-same-root", async () => {
    const client = createIpfsGatewayClient([failed.url, pinboard], {
      timeoutMs: 15000,
      attemptTimeoutMs: 5000,
    });
    const bytes = await client.block.get(roots.tools);
    assert.deepEqual(Buffer.from(bytes), blocks.get(roots.tools));
    assert.ok(failed.requests.length);
    return { root: roots.tools, sha256: sha(bytes), sources: [failed.url, pinboard] };
  });
  await test("first-source-failure-backup-full-same-three-dags", async () => {
    const client = createIpfsGatewayClient([failed.url, backup.url], {
      timeoutMs: 5000,
      attemptTimeoutMs: 2000,
    });
    const verified = [];
    for (const [name, dag] of Object.entries(proof.dag)) {
      for (const block of dag.blocks) {
        const bytes = await client.block.get(block.cid);
        assert.equal(sha(bytes), block.sha256);
      }
      verified.push({ name, root: dag.root, blocks: dag.blockCount });
    }
    return { sources: [failed.url, backup.url], verified };
  });
  await test("invalid-raw-cid-rejected-then-valid-backup", async () => {
    const before = backup.requests.length;
    const client = createIpfsGatewayClient([invalid.url, backup.url], {
      timeoutMs: 5000,
      attemptTimeoutMs: 2000,
    });
    const bytes = await client.block.get(roots.tools);
    assert.deepEqual(Buffer.from(bytes), blocks.get(roots.tools));
    assert.ok(invalid.requests.some((request) => request.path.endsWith(roots.tools)));
    assert.ok(backup.requests.length > before);
    return { root: roots.tools, sha256: sha(bytes), sources: [invalid.url, backup.url] };
  });
  await test("all-sources-fail-explicit-bounded-source-diagnostics", async () => {
    const started = performance.now();
    const client = createIpfsGatewayClient([failed.url, missing.url], {
      timeoutMs: 1200,
      attemptTimeoutMs: 600,
    });
    let error;
    try {
      await client.block.get(roots.tools);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof GatewayReadError);
    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs < 2200);
    assert.equal(error.attempts.length, 2);
    assert.deepEqual(
      error.attempts.map((attempt) => attempt.source),
      [failed.url + "/", missing.url + "/"],
    );
    return {
      configuredTotalMs: 1200,
      configuredAttemptMs: 600,
      upperThresholdMs: 2200,
      elapsedMs,
      error: {
        name: error.name,
        message: error.message,
        attempts: error.attempts,
        budgetExhausted: error.budgetExhausted,
      },
    };
  });
  await test("total-budget-stall-no-late-backup", async () => {
    const before = backup.requests.length;
    const started = performance.now();
    const client = createIpfsGatewayClient([stall.url, backup.url], {
      timeoutMs: 400,
      attemptTimeoutMs: 5000,
    });
    let error;
    try {
      await client.block.get(roots.tools);
    } catch (caught) {
      error = caught;
    }
    const elapsedMs = performance.now() - started;
    assert.ok(error instanceof GatewayReadError);
    assert.ok(error.budgetExhausted);
    assert.deepEqual(error.attempts, [{ source: stall.url + "/", outcome: "timeout" }]);
    assert.ok(elapsedMs >= 300 && elapsedMs < 1400);
    const stallAtReturn = stall.requests.length;
    await delay(700);
    assert.equal(backup.requests.length, before);
    assert.equal(stall.requests.length, stallAtReturn);
    return {
      configuredTotalMs: 400,
      configuredAttemptMs: 5000,
      lowerThresholdMs: 300,
      upperThresholdMs: 1400,
      elapsedMs,
      observationAfterReturnMs: 700,
      backupReadsBefore: before,
      backupReadsAfter: backup.requests.length,
      stallReadsAtReturn: stallAtReturn,
      stallReadsAfter: stall.requests.length,
      error: {
        name: error.name,
        message: error.message,
        attempts: error.attempts,
        budgetExhausted: error.budgetExhausted,
      },
    };
  });
  await test("caller-cancellation-no-late-source-or-network-attempt", async () => {
    const before = backup.requests.length;
    const controller = new AbortController();
    const reason = new Error("owned deployment cancellation");
    const started = performance.now();
    const client = createIpfsGatewayClient([stall.url, backup.url], {
      timeoutMs: 3000,
      attemptTimeoutMs: 1000,
    });
    const timer = setTimeout(() => controller.abort(reason), 80);
    let error;
    try {
      await client.block.get(roots.tools, { signal: controller.signal });
    } catch (caught) {
      error = caught;
    } finally {
      clearTimeout(timer);
    }
    const elapsedMs = performance.now() - started;
    assert.equal(error, reason);
    assert.ok(elapsedMs < 1200);
    const stallAfter = stall.requests.length;
    await delay(1300);
    assert.equal(backup.requests.length, before);
    assert.equal(stall.requests.length, stallAfter);
    await assert.rejects(
      client.block.get(roots.tools, { signal: controller.signal }),
      (caught) => caught === reason,
    );
    assert.equal(stall.requests.length, stallAfter);
    return {
      cancelAfterMs: 80,
      configuredTotalMs: 3000,
      configuredAttemptMs: 1000,
      upperThresholdMs: 1200,
      elapsedMs,
      observationAfterReturnMs: 1300,
      backupReadsBefore: before,
      backupReadsAfter: backup.requests.length,
      stallReadsAtReturn: stallAfter,
      stallReadsAfter: stall.requests.length,
      error: { name: error.name, message: error.message },
    };
  });
  let service = await startService("installed-engine-initial", "deployment.sqlite", [
    failed.url,
    backup.url,
  ]);
  const expected = (root) => ({
    pass: true,
    documentation: {
      en: `ipfs://${root}/resources/references/en/check.md`,
    },
  });
  const inputs = {
    tools: {
      tools: [{ command: process.execPath, args: ["--version"], minimumVersion: "22.13.0" }],
      checkTimeoutMs: 3000,
    },
    directories: {
      directories: [{ path: resolve("owned-directory"), requirements: ["exists", "read"] }],
    },
    network: {
      dns: [],
      http: [{ url: fixture.url, expectedStatus: [200], followRedirects: false }],
      checkTimeoutMs: 3000,
    },
  };
  const shared = await test("shared-example-basic-tools-check-public-http", async () => {
    const identity = await verifyConsumer(service.url, {
      bundle: roots.tools,
      input: inputs.tools,
      expectedResult: expected(roots.tools),
    });
    const limit = performance.now() + 10000;
    let run;
    do {
      run = await api(service, `/runs/${identity.runId}`);
      if (run.exit && run.reclaimedAt) break;
      assert.ok(performance.now() < limit);
      await delay(50);
    } while (!run.exit || !run.reclaimedAt);
    assert.equal(run.exit.code, 0);
    assert.equal(run.exit.basis, "worker");
    assert.equal(run.cleanupUnknown, undefined);
    const body = JSON.stringify({ ...inputs.tools, bundle: roots.tools, timeoutMs: 15000 });
    return { ...identity, name: "shared-tools", input: inputs.tools, body, run };
  });
  const records = [shared];
  for (const name of ["directories", "network"]) {
    records.push(
      await test(`installed-engine-${name}-check-pass`, async () => {
        const record = await requestTask(service, name, roots[name], inputs[name]);
        assert.deepEqual(record.task.result, expected(roots[name]));
        return record;
      }),
    );
  }
  const businessFailures = {
    tools: {
      tools: [{ command: process.execPath, args: ["--version"], minimumVersion: "999.0.0" }],
    },
    directories: {
      directories: [{ path: resolve("owned-directory", "missing"), requirements: ["exists"] }],
    },
    network: {
      dns: [],
      http: [{ url: fixture.url, expectedStatus: [201], followRedirects: false }],
    },
  };
  const codes = {
    tools: "tool-version",
    directories: "directory-unusable",
    network: "http-status",
  };
  for (const name of Object.keys(businessFailures)) {
    records.push(
      await test(`installed-engine-${name}-business-fail-completed`, async () => {
        const record = await requestTask(
          service,
          `${name}-business-fail`,
          roots[name],
          businessFailures[name],
        );
        assert.equal(record.task.result.pass, false);
        assert.equal(record.task.result.problems.length, 1);
        assert.equal(record.task.result.problems[0].code, codes[name]);
        assert.equal(record.task.result.documentation.en, expected(roots[name]).documentation.en);
        return record;
      }),
    );
  }
  await test("same-request-identical-body-same-task-no-extra-run", async () => {
    const runsBefore = await api(service, "/runs");
    for (const record of records) {
      const repeated = await api(service, "/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": record.requestId },
        body: record.body,
      });
      assert.equal(repeated.status, "accepted");
      assert.equal(repeated.taskId, record.taskId);
      const task = await api(service, `/tasks/${record.taskId}`);
      assert.equal(task.run.runId, record.runId);
    }
    const runsAfter = await api(service, "/runs");
    assert.deepEqual(stable(runsAfter.items), stable(runsBefore.items));
    return {
      requests: records.map(({ requestId, taskId, runId, bundle }) => ({
        requestId,
        taskId,
        runId,
        bundle,
      })),
      runsBefore,
      runsAfter,
    };
  });
  await test("graceful-same-db-restart-http-identity-history-unchanged", async () => {
    const before = [];
    for (const record of records) before.push(await snapshot(service, record));
    await stopService(service);
    service = await startService("installed-engine-restarted", "deployment.sqlite", [
      failed.url,
      backup.url,
    ]);
    const after = [];
    for (const [index, record] of records.entries()) {
      const current = await snapshot(service, record);
      assert.deepEqual(stable(current), stable(before[index]));
      after.push(current);
    }
    return {
      database: resolve("deployment.sqlite"),
      before,
      after,
      ignoredObservationOnlyFields: ["timestamp", "observedAt", "nextCursor", "expiresAt"],
    };
  });
  await stopService(service);
  const rejectionService = await startService(
    "installed-engine-all-fail",
    "rejection.sqlite",
    [failed.url, missing.url],
    1200,
    600,
  );
  await test("installed-service-all-sources-fail-rejected-http", async () => {
    const requestId = newId();
    const started = performance.now();
    await api(rejectionService, "/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": requestId },
      body: JSON.stringify({ ...inputs.tools, bundle: roots.tools, timeoutMs: 15000 }),
    });
    let status;
    do {
      status = await api(rejectionService, `/requests/${requestId}/status?waitMs=500`);
      assert.ok(performance.now() - started < 3500);
    } while (status.status === "preparing");
    assert.equal(status.status, "rejected");
    assert.equal(status.error.code, "bundle_fetch_failed");
    assert.ok(status.error.message.includes(failed.url));
    assert.ok(status.error.message.includes(missing.url));
    return {
      requestId,
      root: roots.tools,
      status,
      configuredTotalMs: 1200,
      upperThresholdMs: 3500,
      elapsedMs: performance.now() - started,
    };
  });
  await stopService(rejectionService);
} catch (error) {
  proof.fatal = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  for (const service of services) {
    if (!service.stopped && service.child.exitCode === null) {
      try {
        await stopService(service);
      } catch (error) {
        proof.cleanup.push({
          kind: "service",
          name: service.name,
          graceful: false,
          error: error.message,
        });
        service.child.kill("SIGKILL");
        await bounded(service.exited, 5000, "Owned forced cleanup timeout");
        process.exitCode = 1;
      }
    }
    await writeFile(resolve(output, `${service.name}.stdout.log`), service.stdout);
    await writeFile(resolve(output, `${service.name}.stderr.log`), service.stderr);
  }
  for (const state of ownedServers) {
    const closed = new Promise((done) => state.server.close(done));
    for (const socket of state.sockets) socket.destroy();
    await bounded(closed, 5000, "Owned HTTP helper close timeout");
    proof.gateways.push({ name: state.name, url: state.url, requests: state.requests });
    proof.cleanup.push({ kind: "http-helper", name: state.name, closed: true });
  }
  proof.finishedAt = new Date().toISOString();
  proof.counts = {
    pass: proof.tests.filter((item) => item.pass).length,
    fail: proof.tests.filter((item) => !item.pass).length,
  };
  proof.lockfileSha256 = sha(await readFile("package-lock.json"));
  proof.verificationScriptSha256 = sha(await readFile("deploy-consumer.mjs"));
  proof.sharedConsumerScriptSha256 = sha(await readFile("verify-consumer.mjs"));
  await persist();
  console.log(JSON.stringify({ counts: proof.counts, fatal: proof.fatal, cleanup: proof.cleanup }));
}
