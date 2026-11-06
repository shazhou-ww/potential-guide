import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createPipe } from "node:net";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const owned = resolve(process.argv[2]);
const previous = JSON.parse(await readFile(join(owned, "Gateway-Only-Results.json"), "utf8"));
const blocks = new Map(JSON.parse(await readFile(join(owned, "blocks.json"), "utf8"))
  .map(([cid, bytes]) => [cid, Buffer.from(bytes, "base64")]));
const result = { sourceCommit: previous.sourceCommit,
  verifiedDeploymentRevision: previous.verifiedDeploymentRevision,
  purpose: "根路径 Gateway 诊断，不替代完整 Deployment 矩阵",
  scenarios: [], errors: [], requests: [], ownedPids: [], cleanup: {} };
const sockets = new Map();
const pipeName = `\\\\.\\pipe\\server-config-diagnostic-${randomBytes(12).toString("hex")}`;
const pipe = createPipe((socket) => {
  let text = "";
  socket.on("error", () => {});
  socket.on("data", (chunk) => {
    text += chunk;
    if (text.includes("\n")) {
      const pid = Number(text.split("\n")[0]);
      sockets.set(pid, socket);
      if (!result.ownedPids.includes(pid)) result.ownedPids.push(pid);
      socket.on("close", () => sockets.delete(pid));
    }
  });
});
const source = createServer((request, response) => {
  result.requests.push({ method: request.method, path: request.url,
    accept: request.headers.accept, credentialsPresent: Boolean(request.headers.authorization || request.headers.cookie) });
  const url = new URL(request.url, "http://localhost");
  const bytes = blocks.get(url.pathname.split("/").at(-1));
  if (!url.pathname.startsWith("/ipfs/") || !bytes) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader("content-type", "application/vnd.ipld.raw");
  response.end(bytes);
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
function requestId() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = BigInt(Date.now()), prefix = "";
  for (let i = 0; i < 10; i++) {
    prefix = alphabet[Number(time % 32n)] + prefix;
    time /= 32n;
  }
  return prefix + [...randomBytes(16)].map((byte) => alphabet[byte % 32]).join("");
}
async function bounded(promise, ms = 30000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("诊断超时")), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function http(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
}
let current;
try {
  await new Promise((done) => pipe.listen(pipeName, done));
  await new Promise((done) => source.listen(0, "127.0.0.1", done));
  const gateway = `http://127.0.0.1:${source.address().port}`;
  result.gateway = gateway;
  const bin = join(owned, "runtime", "node_modules", ".bin");
  const env = { ...process.env, APPDATA: join(owned, "isolated-user"),
    XDG_CONFIG_HOME: join(owned, "isolated-user"),
    PATH: [bin, dirname(process.execPath), join(process.env.SystemRoot, "System32")].join(";"),
    NODE_OPTIONS: `--import=${pathToFileURL(join(owned, "signal-preload.mjs")).href}`,
    NODE_PATH: "", PGUIDE_OUTER_SIGNAL_PIPE: pipeName };
  for (const key of ["IPFS_API", "IPFS_PATH", "IPFS_GATEWAY"]) delete env[key];
  await writeFile(join(owned, "isolated-user", "pguide", "config.jsonc"), "{}");
  for (const discovered of [false, true]) {
    for (const ui of [false, true]) {
      const entry = discovered ? join(owned, "runtime", "node_modules", "pguide", "dist", "bin.js")
        : join(owned, "runtime", "node_modules", "@potential-guide", "pguide-task-engine", "dist", "main.js");
      const database = `diagnostic-${discovered}-${ui}-${randomBytes(8).toString("hex")}.sqlite`;
      const args = [join(owned, "signal-wrapper.mjs"), entry,
        ...(discovered ? ["task-engine"] : []), "--no-global-config", "--port", "0",
        "--database", database, "--ipfs-gateway-url", gateway,
        ...(ui ? ["--ui", "--ui-options", JSON.stringify({ host: "127.0.0.1", port: 0,
          favoritesFile: `diagnostic-${discovered}.json` })] : [])];
      const child = spawn(process.execPath, args, { cwd: join(owned, "runtime", "workspace"),
        env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      current = { child, stdout: "", stderr: "" };
      const state = current;
      child.stdout.on("data", (bytes) => { state.stdout += bytes; });
      child.stderr.on("data", (bytes) => { state.stderr += bytes; });
      state.exit = new Promise((done, reject) => {
        child.on("error", reject); child.on("exit", (code) => { state.exited = true; done(code); });
      });
      let ready;
      for (let count = 0; count < 400 && !ready; count++) {
        for (const line of state.stdout.split("\n")) {
          if (line.startsWith("{")) {
            const value = JSON.parse(line);
            if (value.event === "ready") ready = value;
          }
        }
        if (!ready && state.exited) throw new Error(state.stderr);
        await delay(25);
      }
      assert.ok(ready, "无 ready");
      assert.equal(Boolean(ready.uiUrl), ui);
      assert.equal((await http(`${ready.url}/tasks`)).status, 200);
      const id = requestId();
      const submitted = await http(`${ready.url}/tasks`, { method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": id },
        body: JSON.stringify({ bundle: previous.bundle.cid,
          message: previous.bundle.expectedResult.message, timeoutMs: 15000 }) });
      assert.ok([200, 202].includes(submitted.status), await submitted.text());
      let decision;
      for (let count = 0; count < 60; count++) {
        decision = await (await http(`${ready.url}/requests/${id}/status?waitMs=1000`)).json();
        if (decision.status !== "preparing") break;
      }
      if (decision.status !== "accepted") {
        result.scenarios.push({ entry: discovered ? "pguide task-engine" : "pguide-task-engine",
          ui, ready, requestId: id, rejection: decision, database });
      }
      assert.equal(decision.status, "accepted", JSON.stringify(decision));
      let task;
      for (let count = 0; count < 400; count++) {
        task = await (await http(`${ready.url}/tasks/${decision.taskId}`)).json();
        if (task.stage === "completed" || task.stage === "failed") break;
        await delay(25);
      }
      assert.equal(task.stage, "completed", JSON.stringify(task));
      assert.deepEqual(task.result, previous.bundle.expectedResult);
      assert.equal((await http(`${ready.url}/tasks`, { headers: { origin: "https://evil.invalid" } })).status, 403);
      if (ui) {
        assert.match(await (await http(ready.uiUrl)).text(), /<html/);
        const bootstrap = await (await http(`${ready.uiUrl}/api/bootstrap`)).json();
        const response = await http(`${ready.uiUrl}/api/endpoints/local/tasks/${decision.taskId}`, {
          headers: { origin: ready.uiUrl, "x-ui-token": bootstrap.csrf,
            "x-endpoint-binding": bootstrap.endpoints[0].binding } });
        assert.equal(response.status, 200);
      }
      assert.ok(sockets.has(ready.pid));
      sockets.get(ready.pid).write("stop\n");
      if (child.connected) child.disconnect();
      assert.equal(await bounded(state.exit), 0);
      assert.match(state.stdout, /"event":"closed"/);
      await assert.rejects(http(`${ready.url}/tasks`));
      if (ui) await assert.rejects(http(ready.uiUrl));
      assert.equal((await http(`${gateway}/ipfs/${previous.bundle.cid}?format=raw`)).status, 200);
      result.scenarios.push({ entry: discovered ? "pguide task-engine" : "pguide-task-engine",
        ui, ready, requestId: id, taskId: decision.taskId, result: task.result,
        database, gracefulExit: true, engineClosed: true, uiClosed: true, contentSourceSurvived: true });
      current = undefined;
    }
  }
} catch (error) {
  result.errors.push(String(error.stack ?? error).replaceAll(owned, "<owned-root>")
    .replaceAll(pathToFileURL(owned).href, "file:///<owned-root>"));
  process.exitCode = 1;
} finally {
  result.cleanup.forcedOwnedPids = [];
  for (const [pid, socket] of sockets) {
    socket.write("stop\n");
  }
  await delay(200);
  if (current && !current.exited) {
    for (const [pid, socket] of sockets) {
      process.kill(pid, "SIGKILL"); result.cleanup.forcedOwnedPids.push(pid); socket.destroy();
    }
    current.child.kill("SIGKILL");
    await bounded(current.exit);
  }
  for (const socket of sockets.values()) socket.destroy();
  await new Promise((done) => pipe.close(done));
  source.closeAllConnections();
  await new Promise((done) => source.close(done));
  result.cleanup.contentSourceClosed = true;
  result.cleanup.pipeClosed = true;
  result.cleanup.externalRootRemovalRequired = true;
  await writeFile(join(owned, "Diagnostic-Results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ scenarios: result.scenarios.length, errors: result.errors, cleanup: result.cleanup }));
}
