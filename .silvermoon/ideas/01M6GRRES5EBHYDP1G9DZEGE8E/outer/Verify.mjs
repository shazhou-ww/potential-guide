import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const source = resolve(process.argv[2]);
const home = process.cwd();
assert.ok(!home.startsWith(source), "The consumer must be outside the source checkout.");
const report = { sourceCommit: execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), commands: [], scenarios: [], failures: [], cleanup: {} };
async function inspectGraphs() {
  const { verificationPackages } = await import(pathToFileURL(join(source, "scripts", "release-packages.mjs")).href);
  const { consumerVersions, verifyConsumerGraph } = await import(pathToFileURL(join(source, "scripts", "deployment-consumer.mjs")).href);
  const manifests = new Map();
  for (const definition of verificationPackages)
    manifests.set(definition.name, JSON.parse(await readFile(join(source, definition.workspace ?? "packages", definition.directory, "package.json"), "utf8")));
  const graphs = {};
  for (const [directory, entries] of Object.entries({ runtime: ["pguide", "@potential-guide/pguide-task-engine"], author: ["@potential-guide/task-sdk", "@potential-guide/ipfs-content"] })) {
    const versions = consumerVersions(manifests, entries);
    const graph = await verifyConsumerGraph(resolve(directory), versions, entries, true);
    graphs[directory] = { internalPackages: versions.size, productionPackages: graph.map(({ name, version }) => ({ name, version })), allPhysicalPathsInsideConsumer: true };
  }
  return graphs;
}
if (process.argv.includes("--graph-only")) {
  const graphs = await inspectGraphs();
  await writeFile("graphs.json", `${JSON.stringify(graphs, null, 2)}\n`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(graphs).map(([name, graph]) => [name, { internalPackages: graph.internalPackages, productionPackages: graph.productionPackages.length }]))));
  process.exit(0);
}
assert.ok((await readdir(".")).every((name) => name === "tools" || name === "run.log"),
  "Use a fresh dedicated consumer directory containing only the explicitly supplied Kubo tools.");
const children = new Set();
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const safe = (value) => value.replaceAll(source, "<source>").replaceAll(home, "<owned-root>");
function launch(command, args, cwd = ".", env = process.env, ipc = false) {
  const child = spawn(command, args, {
    cwd, env, windowsHide: true,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const state = { child, stdout: "", stderr: "", exited: false };
  child.stdout.on("data", (chunk) => { state.stdout += chunk; });
  child.stderr.on("data", (chunk) => { state.stderr += chunk; });
  state.exit = new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => { state.exited = true; children.delete(child); done(code); });
  });
  state.exit.catch(() => {});
  return state;
}
async function bounded(promise, message, ms = 30_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function run(command, args, cwd = ".", env = process.env, expected = 0) {
  const state = launch(command, args, cwd, env);
  const code = await bounded(state.exit, `Command timeout: ${command}`, 120_000);
  report.commands.push({ command: safe(command), args: args.map(safe), cwd: safe(resolve(cwd)), code });
  assert.equal(code, expected, safe(state.stderr + state.stdout));
  return state.stdout;
}
async function http(url, options = {}) {
  return fetch(url, { signal: AbortSignal.timeout(15_000), ...options });
}
async function waitReady(state) {
  for (let count = 0; count < 300; count++) {
    for (const line of state.stdout.split("\n")) {
      try { const value = JSON.parse(line); if (value.event === "ready") return value; } catch {}
    }
    if (state.exited) throw new Error(safe(state.stderr));
    await delay(100);
  }
  throw new Error("Service readiness timeout.");
}
function requestId() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = BigInt(Date.now()), prefix = "";
  for (let index = 0; index < 10; index++) { prefix = alphabet[Number(time % 32n)] + prefix; time /= 32n; }
  return prefix + [...randomBytes(16)].map((byte) => alphabet[byte % 32]).join("");
}
const originalUserFile = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "pguide", "config.jsonc");
async function fingerprint(path) {
  try { const bytes = await readFile(path); return createHash("sha256").update(bytes).digest("hex"); }
  catch (error) { if (error.code === "ENOENT") return "absent"; throw error; }
}
const originalUserHash = await fingerprint(originalUserFile);
const isolatedUser = resolve("isolated-user");
const env = { ...process.env, APPDATA: isolatedUser, XDG_CONFIG_HOME: isolatedUser, NODE_OPTIONS: "", NODE_PATH: "" };
let kubo, rpc, signalController;
const signalSockets = new Map();
try {
  await writeFile("owned-environment.json", JSON.stringify({ purpose: "task-engine Outer verification", sourceCommit: report.sourceCommit }));
  await mkdir("packs"); await mkdir("runtime"); await mkdir("author");
  await mkdir("runtime/workspace/.pguide", { recursive: true });
  await mkdir("runtime/workspace/files"); await mkdir("runtime/workspace/cli");
  await mkdir("isolated-user/pguide", { recursive: true });
  const { verificationPackages } = await import(pathToFileURL(join(source, "scripts", "release-packages.mjs")).href);
  const definitions = new Map();
  for (const definition of verificationPackages) {
    const root = join(source, definition.workspace ?? "packages", definition.directory);
    definitions.set(definition.name, { ...definition, root, manifest: JSON.parse(await readFile(join(root, "package.json"), "utf8")) });
  }
  const needed = new Set();
  function include(name) {
    if (needed.has(name)) return;
    needed.add(name);
    for (const [dependency, range] of Object.entries(definitions.get(name).manifest.dependencies ?? {}))
      if (range.startsWith("workspace:")) include(dependency);
  }
  const selections = { runtime: ["pguide", "@potential-guide/pguide-task-engine"], author: ["@potential-guide/task-sdk", "@potential-guide/ipfs-content"] };
  for (const names of Object.values(selections)) for (const name of names) include(name);
  const tarballs = new Map();
  for (const name of needed) {
    const packed = JSON.parse(await run("pnpm.cmd", ["--dir", definitions.get(name).root, "pack", "--pack-destination", resolve("packs"), "--json"]));
    tarballs.set(name, packed.filename);
  }
  for (const [directory, names] of Object.entries(selections)) {
    await writeFile(join(directory, "package.json"), JSON.stringify({
      private: true, type: "module", dependencies: Object.fromEntries(names.map((name) => [name, pathToFileURL(tarballs.get(name)).href])),
    }));
    await writeFile(join(directory, "pnpm-workspace.yaml"), `packages: []\noverrides: ${JSON.stringify(Object.fromEntries([...tarballs].map(([name, path]) => [name, pathToFileURL(path).href])))}\n`);
    await run("pnpm.cmd", ["install", "--prod", "--prefer-offline", "--ignore-scripts", "--no-frozen-lockfile", "--reporter=append-only"], directory, env);
  }
  report.packedPackages = needed.size;
  report.graphs = await inspectGraphs();
  const bin = resolve("runtime/node_modules/.bin");
  env.PATH = bin + delimiter + process.env.PATH;
  const binary = join(bin, "pguide-task-engine.cmd");
  const pguide = join(bin, "pguide.cmd");
  assert.equal(JSON.parse(await run(binary, ["--pguide-command-metadata"], "runtime", env)).command, "task-engine");
  assert.equal(JSON.parse(await run(pguide, ["task-engine", "--help", "--format", "json", "--no-global-config"], "runtime", env)).command, "task-engine");
  const ipfs = resolve("tools/kubo/ipfs.exe");
  const kuboEnv = { ...env, IPFS_PATH: resolve("owned-kubo") };
  report.kuboVersion = (await run(ipfs, ["version"], ".", kuboEnv)).trim();
  report.kuboArchiveSha512 = createHash("sha512").update(await readFile("tools/kubo_v0.43.1_windows-amd64.zip")).digest("hex");
  await run(ipfs, ["init", "--profile=test"], ".", kuboEnv);
  await run(ipfs, ["config", "Addresses.API", "/ip4/127.0.0.1/tcp/0"], ".", kuboEnv);
  await run(ipfs, ["config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/0"], ".", kuboEnv);
  kubo = launch(ipfs, ["daemon", "--offline"], ".", kuboEnv);
  report.kuboPid = kubo.child.pid;
  for (let index = 0; index < 300; index++) {
    if (kubo.exited) throw new Error(kubo.stderr);
    try {
      const address = (await readFile("owned-kubo/api", "utf8")).trim().split("/");
      const candidate = `http://${address[2]}:${address[4]}`;
      if ((await http(`${candidate}/api/v0/version`, { method: "POST" })).ok) { rpc = candidate; break; }
    } catch {}
    await delay(100);
  }
  assert.ok(rpc, "Owned offline Kubo did not become ready.");
  report.kuboRpc = rpc;
  await writeFile("author/echo.mjs", await readFile(join(source, "examples", "task-server", "echo-type.mjs")));
  await writeFile("author/prepare.mjs", `
import {buildTaskBundle} from "@potential-guide/pguide-task-bundle/build";
import {importTaskBundle} from "@potential-guide/pguide-task-bundle/publish";
import {createIpfsClient} from "@potential-guide/ipfs-content";
const schema={type:"object",properties:{message:{type:"string"}},required:["message"],additionalProperties:false};
const built=await buildTaskBundle({declaration:{$schema:"https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json",name:"Outer echo",runtime:{type:"node",minVersion:"22.13.0"},entry:"worker.cjs",inputSchema:schema,resultSchema:schema,messageSchema:false},entry:"echo.mjs",outDirectory:"bundle"});
const published=await importTaskBundle(built.directory,await createIpfsClient(process.argv[2]));
console.log(JSON.stringify({cid:published.cid}));
`);
  const publication = JSON.parse(await run(process.execPath, ["prepare.mjs", rpc], "author", env));
  report.bundleCid = publication.cid;
  assert.equal((await http(`${rpc}/api/v0/block/stat?arg=${publication.cid}`, { method: "POST" })).status, 200);
  const main = resolve("runtime/node_modules/@potential-guide/pguide-task-engine/dist/main.js");
  const top = resolve("runtime/node_modules/pguide/dist/bin.js");
  await writeFile("signal-wrapper.mjs", `import {pathToFileURL} from "node:url";const entry=process.argv[2];process.argv.splice(1,1);process.on("message",()=>process.emit("SIGTERM"));await import(pathToFileURL(entry).href);`);
  const wrapper = resolve("signal-wrapper.mjs");
  const pipe = `\\\\.\\pipe\\pguide-outer-${process.pid}`;
  signalController = createServer((socket) => {
    let text = "";
    socket.on("data", (chunk) => {
      text += chunk;
      if (text.includes("\n")) {
        const pid = Number(text.split("\n")[0]);
        signalSockets.set(pid, socket);
        socket.on("close", () => signalSockets.delete(pid));
      }
    });
  });
  await new Promise((done, reject) => {
    signalController.once("error", reject);
    signalController.listen(pipe, done);
  });
  await writeFile("signal-preload.mjs", `import {connect} from "node:net";const socket=connect(process.env.PGUIDE_OUTER_SIGNAL_PIPE);socket.unref();socket.on("error",()=>{});socket.on("connect",()=>socket.write(process.pid+"\\n"));socket.on("data",()=>{process.emit("SIGTERM");socket.end();});`);
  env.PGUIDE_OUTER_SIGNAL_PIPE = pipe;
  env.NODE_OPTIONS = `--import=${pathToFileURL(resolve("signal-preload.mjs")).href}`;
  const cwd = resolve("runtime/workspace");
  const userFile = "isolated-user/pguide/config.jsonc";
  const projectFile = "runtime/workspace/.pguide/config.jsonc";
  const projectContent = '{"task-engine.port":"excluded","task-engine.database":"must-not-exist.sqlite"}';
  await writeFile(projectFile, projectContent);
  const projectHash = await fingerprint(projectFile);
  const sentinel = Buffer.from("owned old database sentinel; never open or migrate");
  await writeFile("runtime/workspace/old.sqlite", sentinel);
  async function submit(base, proxy) {
    const id = requestId();
    const response = await http(`${base}/tasks`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": id, ...(proxy ?? {}) },
      body: JSON.stringify({ bundle: publication.cid, message: "non-sensitive-outer-proof", timeoutMs: 15_000 }),
    });
    assert.ok([200, 202].includes(response.status), await response.text());
    return id;
  }
  async function complete(url, id) {
    let taskId;
    for (let index = 0; index < 60; index++) {
      const decision = await (await http(`${url}/requests/${id}/status?waitMs=1000`)).json();
      if (decision.status === "accepted") { taskId = decision.taskId; break; }
      assert.equal(decision.status, "preparing", JSON.stringify(decision));
    }
    assert.ok(taskId, "Real Kubo Bundle preparation did not accept.");
    for (let index = 0; index < 150; index++) {
      const task = await (await http(`${url}/tasks/${taskId}`)).json();
      if (task.stage === "completed") {
        assert.deepEqual(task.result, { message: "non-sensitive-outer-proof" });
        return taskId;
      }
      assert.notEqual(task.stage, "failed", JSON.stringify(task));
      await delay(200);
    }
    throw new Error("Task did not complete.");
  }
  async function scenario(label, discovered, args, database, ui = false) {
    const state = launch(process.execPath, [wrapper, discovered ? top : main, ...(discovered ? ["task-engine"] : []), "--cwd", cwd, ...args], cwd, env, true);
    let ready;
    try {
      ready = await waitReady(state);
      assert.equal(Boolean(ready.uiUrl), ui);
      assert.equal((await http(`${ready.url}/tasks`)).status, 200);
      const id = await submit(ready.url);
      const taskId = await complete(ready.url, id);
      assert.equal((await http(`${ready.url}/tasks`, { headers: { origin: "https://evil.invalid" } })).status, 403);
      assert.equal((await http(`${ready.url}/tasks`, { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
      const badHost = await new Promise((done, reject) => {
        get(`${ready.url}/tasks`, { headers: { host: "evil.invalid" } }, (response) => { response.resume(); done(response.statusCode); }).on("error", reject);
      });
      assert.equal(badHost, 403);
      if (ui) {
        assert.match(await (await http(ready.uiUrl)).text(), /<html/);
        for (const asset of ["app.js", "style.css"]) assert.equal((await http(`${ready.uiUrl}/${asset}`)).status, 200);
        const bootstrap = await (await http(`${ready.uiUrl}/api/bootstrap`)).json();
        const headers = { origin: ready.uiUrl, "x-ui-token": bootstrap.csrf, "x-endpoint-binding": bootstrap.endpoints[0].binding };
        assert.equal((await http(`${ready.uiUrl}/api/endpoints/local/tasks/${taskId}`, { headers })).status, 200);
        const proxyId = await submit(`${ready.uiUrl}/api/endpoints/local`, headers);
        await complete(ready.url, proxyId);
        assert.equal((await http(ready.uiUrl, { headers: { origin: "https://evil.invalid" } })).status, 403);
      }
      assert.ok((await stat(database)).size > 0);
      if (discovered) {
        assert.ok(signalSockets.has(ready.pid), "The discovered service must have its own signal channel.");
        signalSockets.get(ready.pid).write("stop\n");
        state.child.disconnect();
      }
      else { state.child.send("stop"); state.child.disconnect(); }
      const code = await bounded(state.exit, "Service exit timeout.");
      assert.equal(code, 0); assert.match(state.stdout, /"event":"closed"/);
      await assert.rejects(http(`${ready.url}/tasks`));
      if (ui) await assert.rejects(http(ready.uiUrl));
      assert.equal((await http(`${rpc}/api/v0/version`, { method: "POST" })).status, 200);
      const db = new DatabaseSync(database, { readOnly: true });
      try { assert.equal(db.prepare("SELECT count(*) AS total FROM requests WHERE request_id=? AND task_id=?").get(id, taskId).total, 1); }
      finally { db.close(); }
      report.scenarios.push({ label, entry: discovered ? "pguide task-engine" : "pguide-task-engine", arguments: args, url: ready.url, uiUrl: ready.uiUrl, database: safe(resolve(database)), requestId: id, taskId, result: { message: "non-sensitive-outer-proof" }, exited: code, graceful: true, kuboSurvived: true });
    } finally {
      if (!state.exited) {
        if (ready) try { process.kill(ready.pid, "SIGKILL"); } catch {}
        state.child.kill("SIGKILL");
        await bounded(state.exit, "Invocation cleanup timeout.");
      }
    }
  }
  await scenario("纯参数 / Engine-only", false, ["--no-global-config", "--port", "0", "--database", "cli/cli.sqlite", "--ipfs-rpc-url", rpc], "runtime/workspace/cli/cli.sqlite");
  await writeFile("runtime/workspace/files/server.yaml", `port: 2345\ndatabase: yaml.sqlite\nipfsRpcUrl: ${rpc}\n`);
  await scenario("发现 / YAML / CLI 端口覆盖", true, ["--no-global-config", "--config", "files/server.yaml", "--port", "0"], "runtime/workspace/files/yaml.sqlite");
  await writeFile("runtime/workspace/files/server.json", JSON.stringify({ port: 0, database: "json.sqlite", ipfsRpcUrl: rpc }));
  await scenario("独立入口 / JSON", false, ["--no-global-config", "--config", "files/server.json"], "runtime/workspace/files/json.sqlite");
  const userValues = { "task-engine.port": 0, "task-engine.database": "user.sqlite", "task-engine.ipfsRpcUrl": rpc, "task-engine.scope": "outer" };
  await writeFile(userFile, `// isolated user settings\n${JSON.stringify(userValues, null, 2).replace(/\n}$/, ",\n}")}\n`);
  await scenario("发现 / 隔离用户 JSONC / 项目排除", true, [], "isolated-user/pguide/user.sqlite");
  await writeFile("runtime/workspace/files/ui.yaml", `port: 3456\ndatabase: ui.sqlite\nipfsRpcUrl: http://127.0.0.1:1\nuiOptions: {host: localhost, port: 0, favoritesFile: ui-favorites.json}\n`);
  await scenario("四层覆盖 / UI HTTP / 实际 RPC", false, ["--config", "files/ui.yaml", "--port", "0", "--ipfs-rpc-url", rpc, "--ui"], "runtime/workspace/files/ui.sqlite", true);
  await writeFile(userFile, "{malformed");
  await writeFile("runtime/workspace/files/isolated.json", JSON.stringify({ port: 0, database: "isolated.sqlite", ipfsRpcUrl: rpc }));
  await scenario("发现 / 禁用损坏全局文件", true, ["--no-global-config", "--config", "files/isolated.json"], "runtime/workspace/files/isolated.sqlite");
  await writeFile("runtime/workspace/files/bad.json", '{"port":"invalid"}');
  await writeFile("runtime/workspace/unsafe.mjs", 'import {writeFileSync} from "node:fs";writeFileSync("executed-marker","unexpected");');
  for (const [entry, prefix] of [[binary, []], [pguide, ["task-engine"]]]) {
    for (const [label, args] of [
      ["损坏用户配置", ["--port", "0", "--ipfs-rpc-url", rpc]],
      ["被覆盖的非法文件值", ["--no-global-config", "--config", "files/bad.json", "--port", "0"]],
      ["非回环监听", ["--no-global-config", "--host", "0.0.0.0"]],
      ["执行模块退役", ["--no-global-config", "--config", "unsafe.mjs"]],
    ]) {
      const state = launch(entry, [...prefix, "--cwd", cwd, ...args], cwd, env);
      const code = await bounded(state.exit, "Invalid configuration exit timeout.");
      assert.notEqual(code, 0); assert.doesNotMatch(state.stdout, /"event":"ready"/);
      report.failures.push({ entry: prefix.length ? "pguide task-engine" : "pguide-task-engine", label, exit: code });
    }
    await writeFile(userFile, '{"task-engine.port":"invalid"}');
    const state = launch(entry, [...prefix, "--cwd", cwd, "--config", "files/server.json", "--port", "0"], cwd, env);
    assert.notEqual(await bounded(state.exit, "Invalid user override timeout."), 0);
    report.failures.push({ entry: prefix.length ? "pguide task-engine" : "pguide-task-engine", label: "被覆盖的非法用户值", exit: state.child.exitCode });
    await writeFile(userFile, "{malformed");
  }
  await assert.rejects(access("runtime/workspace/executed-marker"));
  await assert.rejects(access("runtime/workspace/must-not-exist.sqlite"));
  assert.equal(await fingerprint(projectFile), projectHash);
  assert.deepEqual(await readFile("runtime/workspace/old.sqlite"), sentinel);
  assert.equal(await fingerprint(originalUserFile), originalUserHash);
  report.configurationProtection = { realUserConfigUnchanged: true, projectConfigUnchanged: true, oldDatabaseSentinelUnchanged: true, projectDatabaseAbsent: true, executableConfigMarkerAbsent: true };
  report.cleanup.kuboSurvivedAllServiceStops = true;
  await http(`${rpc}/api/v0/shutdown`, { method: "POST" }).catch(() => {});
  assert.equal(await bounded(kubo.exit, "Owned Kubo shutdown timeout."), 0);
  await assert.rejects(http(`${rpc}/api/v0/version`, { method: "POST" }));
  await run(ipfs, ["repo", "stat"], ".", kuboEnv);
  report.cleanup.kuboExited = true;
  report.cleanup.repoLockReleased = true;
} catch (error) {
  report.error = safe(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  for (const child of children) { try { child.kill("SIGKILL"); } catch {} }
  if (children.size) await delay(1000);
  if (signalController) {
    for (const socket of signalSockets.values()) socket.destroy();
    await new Promise((done) => signalController.close(done));
    report.cleanup.signalControllerClosed = true;
  }
  report.cleanup.remainingOwnedProcesses = children.size;
  report.cleanup.realUserConfigUnchanged = await fingerprint(originalUserFile) === originalUserHash;
  await rm("owned-kubo", { recursive: true, force: true });
  report.cleanup.kuboIdentityRemoved = true;
  await writeFile("results.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ scenarios: report.scenarios.length, rejectedInputs: report.failures.length, cleanup: report.cleanup, error: report.error }));
}
