import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createIpfsGatewayClient, newId } from "@potential-guide/task-engine";
import { TaskClient } from "@potential-guide/task-engine-http";
import { startTaskServer } from "@potential-guide/task-engine-server";

const execute = promisify(execFile);
const context = JSON.parse(await readFile(process.argv[2], "utf8"));
const author = JSON.parse(await readFile("author-proof.json", "utf8"));
const root = await realpath(".");
const repo = resolve("kubo-data");
const env = { ...process.env, IPFS_PATH: repo, IPFS_UPDATE_CHECK: "false", NO_COLOR: "1" };
const commands = [];
async function tool(args) {
  const { stdout, stderr } = await execute(context.ipfsExecutable, args, { env, maxBuffer: 4 * 1024 * 1024 });
  commands.push({ executable: basename(context.ipfsExecutable), args, exitCode: 0, stdout, stderr });
  return stdout.trim();
}
async function until(read, milliseconds = 30_000) {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    const result = await read();
    if (result) return result;
    assert.ok(Date.now() < deadline, "受控交付等待超时。");
    await new Promise(done => setTimeout(done, 10));
  }
}
const packages = [];
const seen = new Set();
async function audit(name, from) {
  if (seen.has(name)) return;
  seen.add(name);
  let directory = from, location;
  for (;;) {
    const candidate = join(directory, "node_modules", ...name.split("/"));
    try { location = await realpath(candidate); break; } catch {}
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`隔离消费者缺少 ${name}`);
    directory = parent;
  }
  assert.ok(location.startsWith(`${root}${sep}`), `包解析逃出隔离环境：${name}`);
  const manifest = JSON.parse(await readFile(join(location, "package.json"), "utf8"));
  assert.equal(manifest.name, name);
  assert.notEqual(name, "@potential-guide/ipfs-content");
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
  for (const specifier of Object.values(dependencies))
    assert.ok(!/^(workspace:|link:)/.test(specifier), "生产依赖不得链接工作区。");
  packages.push({ name, version: manifest.version, path: relative(root, location), dependencies });
  for (const dependency of Object.keys(dependencies).filter(value => value.startsWith("@potential-guide/") || value === "pguide"))
    await audit(dependency, location);
}
for (const name of ["@potential-guide/task-engine", "@potential-guide/task-engine-http", "@potential-guide/task-engine-server"])
  await audit(name, root);
for (const name of ["@potential-guide/pguide-task-bundle", "@potential-guide/task-sdk", "@potential-guide/ipfs-content"]) {
  assert.throws(() => import.meta.resolve(name), { code: "ERR_MODULE_NOT_FOUND" });
}
assert.equal(createHash("sha256").update(await readFile("bundle.car")).digest("hex"), author.carSha256);
const proof = {
  complete: false, node: process.version, context: { ...context, ipfsExecutable: basename(context.ipfsExecutable) },
  author, packages, external: {}, cases: [], commands,
};
let daemon, exitPromise, daemonLog = "", backingGateway;
async function startNode() {
  daemonLog = "";
  daemon = spawn(context.ipfsExecutable, ["daemon", "--offline", "--migrate=false"], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  exitPromise = new Promise(done => daemon.once("exit", (code, signal) => done({ code, signal })));
  daemon.stdout.on("data", data => { daemonLog += data; });
  daemon.stderr.on("data", data => { daemonLog += data; });
  await until(() => {
    assert.equal(daemon.exitCode, null, daemonLog);
    return /Daemon is ready/.test(daemonLog) && /Gateway server listening on .*\/tcp\/(\d+)/.test(daemonLog);
  });
  assert.doesNotMatch(daemonLog, /Swarm listening on/);
  const port = /Gateway server listening on .*\/tcp\/(\d+)/.exec(daemonLog)[1];
  backingGateway = `http://127.0.0.1:${port}`;
  const api = (await readFile(join(repo, "api"), "utf8")).trim();
  assert.match(api, /^\/ip4\/127\.0\.0\.1\/tcp\/\d+$/);
  proof.external.starts ??= [];
  proof.external.starts.push({
    api, gateway: backingGateway,
    log: daemonLog.split(/\r?\n/).filter(line => /offline|server listening|Daemon is ready/.test(line)),
  });
}
async function stopNode() {
  if (!daemon || daemon.exitCode !== null) return;
  try { await tool(["shutdown"]); } catch (error) {
    const pid = daemon.pid;
    await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction Stop`]);
    await exitPromise;
    daemon = undefined;
    proof.external.forcedStop = { pid, reason: String(error) };
    throw new Error("独占 Kubo 仅在正常关闭失败后按 PID 回收；本次验证不得通过。");
  }
  const exited = await Promise.race([exitPromise, new Promise((_, reject) => setTimeout(() => reject(new Error("Kubo 未正常退出。")), 15_000).unref())]);
  assert.equal(exited.code, 0);
  proof.external.stops ??= [];
  proof.external.stops.push(exited);
  daemon = undefined;
}
const nativeFetch = globalThis.fetch;
try {
  proof.external.version = await tool(["version", "--all"]);
  await tool(["init", "--profile=test", "--empty-repo=true"]);
  for (const [key, value] of [
    ["Addresses.API", "/ip4/127.0.0.1/tcp/0"],
    ["Addresses.Gateway", "/ip4/127.0.0.1/tcp/0"],
  ]) await tool(["config", key, value]);
  for (const [key, value] of [["Bootstrap", "[]"], ["Addresses.Swarm", "[]"], ["Discovery.MDNS.Enabled", "false"]])
    await tool(["config", "--json", key, value]);
  proof.external.configuration = {};
  for (const key of ["Bootstrap", "Addresses.Swarm", "Discovery.MDNS.Enabled"])
    proof.external.configuration[key] = await tool(["config", key]);
  await startNode();
  proof.external.import = await tool(["dag", "import", "--pin-roots=true", resolve("bundle.car")]);
  assert.ok(proof.external.import.includes(author.cid));
  proof.external.pinAfterImport = await tool(["pin", "ls", "--type=recursive", author.cid]);
  assert.ok(proof.external.pinAfterImport.includes(author.cid));
  const resourcePath = `/ipfs/${author.cid}/${author.payload.path}`;
  proof.external.resource = await tool(["resolve", resourcePath]);
  const leaves = new Set((await tool(["refs", resourcePath])).split(/\r?\n/).filter(Boolean));
  assert.ok(leaves.size >= 3);
  proof.external.resourceLeaves = [...leaves];
  await stopNode();
  await startNode();
  proof.external.pinAfterRestart = await tool(["pin", "ls", "--type=recursive", author.cid]);
  assert.ok(proof.external.pinAfterRestart.includes(author.cid));
  await mkdir("facts");
  for (const mode of ["ok", "missing-path", "missing-block", "cid-mismatch", "cancel", "outage"]) {
    const requests = [], fetches = [], forbidden = [];
    let proxyClosed = false, gatewayStoppedAt, taskOrigin;
    const proxy = createServer(async (request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      const record = { sequence: requests.length + 1, timestamp: new Date().toISOString(), method: request.method, path: request.url, cid: url.pathname.split("/").at(-1) };
      requests.push(record);
      response.once("close", () => { record.closedAt = new Date().toISOString(); record.aborted = !response.writableEnded; });
      try {
        assert.equal(request.method, "GET");
        assert.match(url.pathname, /^\/ipfs\/[^/]+$/);
        assert.equal(url.search, "?format=raw");
        assert.equal(request.headers.accept, "application/vnd.ipld.raw");
        const leaf = leaves.has(record.cid);
        if (leaf && mode === "missing-block") { record.status = 404; response.writeHead(404).end(); return; }
        if (leaf && mode === "outage") {
          record.status = "connection-reset";
          gatewayStoppedAt = new Date().toISOString();
          proxy.close();
          proxy.closeAllConnections();
          return;
        }
        const source = await nativeFetch(`${backingGateway}${request.url}`, { redirect: "error" });
        const bytes = Buffer.from(await source.arrayBuffer());
        assert.equal(source.status, 200);
        record.sourceSha256 = createHash("sha256").update(bytes).digest("hex");
        record.bytes = bytes.length;
        response.writeHead(200, { "content-type": "application/vnd.ipld.raw", "content-length": bytes.length });
        if (leaf && mode === "cancel") {
          record.status = "held";
          response.write(bytes.subarray(0, 32));
          return;
        }
        if (leaf && mode === "cid-mismatch") bytes[0] ^= 1;
        record.responseSha256 = createHash("sha256").update(bytes).digest("hex");
        record.status = 200;
        response.end(bytes);
      } catch (error) {
        record.error = String(error);
        response.destroy();
      }
    });
    proxy.once("close", () => { proxyClosed = true; });
    await new Promise(done => proxy.listen(0, "127.0.0.1", done));
    const gateway = `http://127.0.0.1:${proxy.address().port}`;
    globalThis.fetch = (input, init) => {
      const url = new URL(String(input));
      fetches.push({ timestamp: new Date().toISOString(), origin: url.origin, path: `${url.pathname}${url.search}` });
      if (![gateway, taskOrigin].includes(url.origin)) {
        forbidden.push(url.href);
        throw new Error("消费者不得访问未配置来源。");
      }
      return nativeFetch(input, init);
    };
    assert.throws(() => createIpfsGatewayClient(`${gateway}/old-prefix`));
    const server = await startTaskServer({
      database: resolve("facts", `${mode}.sqlite`), port: 0,
      ipfsClient: createIpfsGatewayClient(gateway, { timeoutMs: 5000 }),
      authorize: () => true, resolveCaller: () => ({ scope: "delivery", subject: "isolated-consumer" }),
    });
    taskOrigin = server.url;
    const client = new TaskClient({ url: server.url });
    const request = { requestId: newId(), bundle: author.cid, mode, timeoutMs: 60_000 };
    const entry = { mode, gateway, server: server.url, request, requests, fetches, forbidden };
    proof.cases.push(entry);
    try {
      entry.decision = await client.submit(request);
      while (entry.decision.status === "preparing")
        entry.decision = await client.getRequestStatus(request.requestId, { waitMs: 1000 });
      assert.equal(entry.decision.status, "accepted", JSON.stringify(entry.decision));
      if (mode === "cancel") {
        await until(() => requests.some(item => item.status === "held"));
        entry.cancel = await client.cancelTask(entry.decision.taskId);
        assert.equal(entry.cancel.canceled, true);
        await client.waitForTaskRelease(entry.decision.taskId);
        await until(() => requests.some(item => item.status === "held" && item.aborted));
      }
      await until(async () => {
        entry.task = await client.getTask(entry.decision.taskId);
        if (!entry.task.run) return false;
        entry.run = await client.getRun(entry.task.run.runId);
        return entry.run.reclaimedAt && (mode === "cancel" || ["completed", "failed"].includes(entry.task.stage));
      });
      if (mode === "ok") {
        assert.equal(entry.task.stage, "completed");
        assert.deepEqual(entry.task.result, { mode, ...author.payload });
      } else {
        assert.equal(entry.task.result, undefined);
        if (mode === "cancel") assert.equal(entry.task.canceled, true);
        else assert.equal(entry.task.stage, "failed");
      }
      const firstLeaf = requests.find(item => leaves.has(item.cid));
      if (mode !== "missing-path") {
        assert.ok(firstLeaf);
        assert.ok(Date.parse(firstLeaf.timestamp) >= Date.parse(entry.run.startedAt), "资源块不得在 Run 开始前被全量预取。");
      }
      if (mode === "outage") {
        assert.ok(gatewayStoppedAt);
        assert.equal(proxy.listening, false);
        entry.gatewayStoppedAt = gatewayStoppedAt;
      }
      assert.deepEqual(forbidden, []);
      assert.equal(requests.some(item => item.path.startsWith("/api/")), false);
    } finally {
      await server.close();
      proxy.closeAllConnections();
      if (proxy.listening) await new Promise(done => proxy.close(done));
      else await until(() => proxyClosed);
      globalThis.fetch = nativeFetch;
    }
  }
  proof.external.pinAfterConsumers = await tool(["pin", "ls", "--type=recursive", author.cid]);
  assert.ok(proof.external.pinAfterConsumers.includes(author.cid));
  await stopNode();
  proof.external.offlinePin = await tool(["--offline", "pin", "ls", "--type=recursive", author.cid]);
  assert.ok(proof.external.offlinePin.includes(author.cid));
  proof.complete = true;
} catch (error) {
  proof.error = { name: error.name, message: error.message, stack: error.stack };
  throw error;
} finally {
  globalThis.fetch = nativeFetch;
  try { await stopNode(); }
  finally { await writeFile("delivery-result.json", JSON.stringify(proof, null, 2)); }
}
console.log(JSON.stringify({ complete: proof.complete, cid: author.cid, cases: proof.cases.map(item => ({ mode: item.mode, stage: item.task.stage, canceled: item.task.canceled, reclaimedAt: item.run.reclaimedAt })) }));
