import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const source = resolve(process.argv[2]);
const home = process.cwd();
const distance = relative(source, home);
assert.ok(distance.startsWith(`..${sep}`), "Run from a new owned directory outside the checkout.");
assert.ok((await readdir(".")).every((name) => ["tools", "run.log"].includes(name)),
  "Refuse a non-fresh external environment.");
const safe = (text) => String(text)
  .replaceAll(pathToFileURL(source).href, "file:///<source>")
  .replaceAll(pathToFileURL(home).href, "file:///<owned-root>")
  .replaceAll(source, "<source>").replaceAll(source.replaceAll("\\", "/"), "<source>")
  .replaceAll(home, "<owned-root>").replaceAll(home.replaceAll("\\", "/"), "<owned-root>")
  .replaceAll(process.execPath, "<node>").replaceAll(homedir(), "<user-home>");
const report = {
  sourceCommit: execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  deploymentBlob: execFileSync("git", ["-C", source, "rev-parse",
    "HEAD:.silvermoon/ideas/01M6GRRES5EBHYDP1G9DZEGE8E/outer/Deployment.md"], { encoding: "utf8" }).trim(),
  platform: process.platform, node: process.version, commands: [], scenarios: [],
  configurationFailures: [], contentFailures: [], cleanup: {}, errors: [],
};
if (process.argv[3]) {
  assert.equal(report.sourceCommit, process.argv[3], "Source moved outside the pinned refresh.");
  report.requestedSourceCommit = process.argv[3];
}
const children = new Set();
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function bounded(promise, message, ms = 30_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  })]); } finally { clearTimeout(timer); }
}
function launch(command, args, cwd = ".", env = process.env, ipc = false) {
  const child = spawn(command, args, { cwd, env, windowsHide: true,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"] });
  const state = { child, stdout: "", stderr: "", exited: false };
  children.add(state);
  child.stdout.on("data", (chunk) => { state.stdout += chunk; });
  child.stderr.on("data", (chunk) => { state.stderr += chunk; });
  state.exit = new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => { state.exited = true; children.delete(state); done(code); });
  });
  state.exit.catch(() => {});
  return state;
}
async function run(command, args, cwd = ".", env = process.env, failure = false) {
  const state = launch(command, args, cwd, env);
  const code = await bounded(state.exit, `Command timeout: ${command}`, 180_000);
  report.commands.push({ command: safe(command), args: args.map(safe), cwd: safe(resolve(cwd)), code });
  if (failure) {
    assert.notEqual(code, 0, safe(state.stdout + state.stderr));
    assert.doesNotMatch(state.stdout, /"event":"ready"/);
  } else assert.equal(code, 0, safe(state.stdout + state.stderr));
  return state;
}
async function http(url, options = {}) {
  return fetch(url, { signal: AbortSignal.timeout(20_000), ...options });
}
async function waitReady(state) {
  for (let count = 0; count < 300; count++) {
    for (const line of state.stdout.split("\n")) {
      try { const value = JSON.parse(line); if (value.event === "ready") return value; } catch {}
    }
    if (state.exited) throw new Error(safe(state.stderr));
    await delay(100);
  }
  throw new Error("Readiness timeout.");
}
function requestId() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = BigInt(Date.now()), prefix = "";
  for (let index = 0; index < 10; index++) { prefix = alphabet[Number(time % 32n)] + prefix; time /= 32n; }
  return prefix + [...randomBytes(16)].map((byte) => alphabet[byte % 32]).join("");
}
async function fingerprint(path) {
  try { return createHash("sha256").update(await readFile(path)).digest("hex"); }
  catch (error) { if (error.code === "ENOENT") return "absent"; throw error; }
}
const originalUserFile = process.platform === "win32"
  ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "pguide", "config.jsonc")
  : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pguide", "config.jsonc");
const originalUserHash = await fingerprint(originalUserFile);
const env = { ...process.env, APPDATA: resolve("isolated-user"),
  XDG_CONFIG_HOME: resolve("isolated-user"), NODE_OPTIONS: "", NODE_PATH: "" };
delete env.IPFS_API;
delete env.IPFS_GATEWAY;
delete env.IPFS_PATH;
let kubo, rpc, rawSource, sourceReady, signalController;
const signalSockets = new Map();
try {
  await writeFile("owned-environment.json", JSON.stringify({
    purpose: "task-engine Gateway Outer verification", sourceCommit: report.sourceCommit,
  }));
  for (const directory of ["packs", "runtime", "author", join("isolated-user", "pguide"),
    join("runtime", "workspace", ".pguide"), join("runtime", "workspace", "files"),
    join("runtime", "workspace", "cli")]) await mkdir(directory, { recursive: true });
  const { verificationPackages } = await import(pathToFileURL(join(source, "scripts", "release-packages.mjs")).href);
  const { consumerVersions, verifyConsumerGraph } = await import(pathToFileURL(join(source, "scripts", "deployment-consumer.mjs")).href);
  const definitions = new Map(), manifests = new Map();
  for (const definition of verificationPackages) {
    const root = join(source, definition.workspace ?? "packages", definition.directory);
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    definitions.set(definition.name, { root, manifest });
    manifests.set(definition.name, manifest);
  }
  const selections = { runtime: ["pguide", "@potential-guide/pguide-task-engine"],
    author: ["@potential-guide/task-sdk", "@potential-guide/ipfs-content"] };
  const needed = new Set();
  for (const entries of Object.values(selections))
    for (const name of consumerVersions(manifests, entries).keys()) needed.add(name);
  const tarballs = new Map();
  for (const name of needed) {
    const state = await run("pnpm.cmd", ["--dir", definitions.get(name).root, "pack",
      "--pack-destination", resolve("packs"), "--json"]);
    tarballs.set(name, JSON.parse(state.stdout).filename);
  }
  report.packedPackages = needed.size;
  report.graphs = {};
  for (const [directory, entries] of Object.entries(selections)) {
    await writeFile(join(directory, "package.json"), JSON.stringify({
      private: true, type: "module",
      dependencies: Object.fromEntries(entries.map((name) => [name, pathToFileURL(tarballs.get(name)).href])),
    }));
    await writeFile(join(directory, "pnpm-workspace.yaml"), `packages: []\noverrides: ${JSON.stringify(
      Object.fromEntries([...tarballs].map(([name, path]) => [name, pathToFileURL(path).href])),
    )}\n`);
    await run("pnpm.cmd", ["install", "--prod", "--prefer-offline", "--ignore-scripts",
      "--no-frozen-lockfile", "--reporter=append-only"], directory, env);
    const versions = consumerVersions(manifests, entries);
    const graph = await verifyConsumerGraph(resolve(directory), versions, entries, true);
    report.graphs[directory] = { entries, internalPackages: versions.size,
      allPhysicalPathsInsideConsumer: true,
      productionPackages: graph.map(({ name, version }) => ({ name, version })) };
    if (directory === "runtime")
      assert.equal(graph.some(({ name }) => name === "@potential-guide/task-sdk"), false);
  }
  const bin = resolve("runtime", "node_modules", ".bin");
  env.PATH = bin + delimiter + process.env.PATH;
  const main = resolve("runtime", "node_modules", "@potential-guide", "pguide-task-engine", "dist", "main.js");
  const top = resolve("runtime", "node_modules", "pguide", "dist", "bin.js");
  assert.equal(JSON.parse((await run(join(bin, "pguide-task-engine.cmd"),
    ["--pguide-command-metadata"], "runtime", env)).stdout).command, "task-engine");
  const help = JSON.parse((await run(join(bin, "pguide.cmd"),
    ["task-engine", "--no-global-config", "--help", "--format", "json"], "runtime", env)).stdout);
  assert.equal(help.defaults.ipfsTransport, "rpc");
  assert.ok(help.options.some((option) => option.includes("--ipfs-gateway-url")));
  const ipfs = resolve("tools", "kubo", "ipfs.exe");
  const kuboEnv = { ...env, IPFS_PATH: resolve("owned-kubo") };
  report.kuboVersion = (await run(ipfs, ["version"], ".", kuboEnv)).stdout.trim();
  const archive = join("tools", "kubo_v0.43.1_windows-amd64.zip");
  report.kuboArchiveSha512 = createHash("sha512").update(await readFile(archive)).digest("hex");
  assert.equal(report.kuboArchiveSha512,
    (await readFile(`${archive}.sha512`, "utf8")).trim().split(/\s+/)[0].toLowerCase());
  report.kuboOfficialRelease = "https://github.com/ipfs/kubo/releases/tag/v0.43.1";
  await run(ipfs, ["init", "--profile=test"], ".", kuboEnv);
  await run(ipfs, ["config", "Addresses.API", "/ip4/127.0.0.1/tcp/0"], ".", kuboEnv);
  await run(ipfs, ["config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/0"], ".", kuboEnv);
  async function startOwnedKubo() {
    kubo = launch(ipfs, ["daemon", "--offline"], ".", kuboEnv);
    for (let index = 0; index < 300; index++) {
      if (kubo.exited) throw new Error(safe(kubo.stderr));
      try {
        const address = (await readFile(join("owned-kubo", "api"), "utf8")).trim().split("/");
        const candidate = `http://${address[2]}:${address[4]}`;
        if ((await http(`${candidate}/api/v0/version`, { method: "POST" })).ok) return candidate;
      } catch {}
      await delay(100);
    }
    throw new Error("Owned offline Kubo failed to start.");
  }
  rpc = await startOwnedKubo();
  report.kubo = { pid: kubo.child.pid, rpc, offline: true, onlyUsedForAuthorAndRpcControl: true };
  await writeFile(join("author", "callback.mjs"), `
export default async function(input,context) {
 let resourceBytes=0;
 for await(const bytes of context.bundle.read("resources/payload.bin"))resourceBytes+=bytes.length;
 return {message:input.message,resourceBytes};
}`);
  await writeFile(join("author", "payload.bin"), Buffer.alloc(600_000, 42));
  await writeFile(join("author", "prepare.mjs"), `
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {buildTaskBundle} from "@potential-guide/pguide-task-bundle/build";
import {importTaskBundle} from "@potential-guide/pguide-task-bundle/publish";
import {MemoryIpfsClient} from "@potential-guide/ipfs-content/testing";
import {createIpfsClient} from "@potential-guide/ipfs-content";
const built=await buildTaskBundle({
 declaration:{$schema:"https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json",
 name:"Gateway Outer",runtime:{type:"node",minVersion:"22.13.0"},entry:"worker.cjs",
 inputSchema:{type:"object"},resultSchema:true,messageSchema:false},
 entry:"callback.mjs",outDirectory:"bundle",resources:{"resources/payload.bin":"payload.bin"}
});
const memory=new MemoryIpfsClient();
await importTaskBundle(built.directory,memory);
const taskYaml=await readFile(join("bundle","task.yaml"),"utf8");
assert.equal(taskYaml.trimStart().startsWith("{"),false,"SDK must emit clean YAML, not JSON");
assert.doesNotMatch(taskYaml,/^resolved:/m,"Private resolved metadata must not enter the declaration");
assert.equal(memory.blocks.size,7,"Keep the bounded seven-block resource fixture");
const published=await importTaskBundle(built.directory,await createIpfsClient(process.argv[2]));
if(published.cid!==built.cid)throw Error("Publication CID mismatch");
await writeFile(join("..","blocks.json"),JSON.stringify([...memory.blocks].map(([cid,bytes])=>[cid,Buffer.from(bytes).toString("base64")])));
console.log(JSON.stringify({cid:built.cid,blocks:memory.blocks.size,pinned:memory.pins.has(built.cid),cleanYaml:true,noPrivateResolvedMetadata:true}));
`);
  const publication = JSON.parse((await run(process.execPath, ["prepare.mjs", rpc], "author", env)).stdout);
  assert.equal(publication.pinned, true);
  report.bundle = { ...publication, expectedResult: { message: "gateway-outer-proof", resourceBytes: 600_000 } };
  assert.equal((await http(`${rpc}/api/v0/block/stat?arg=${publication.cid}`, { method: "POST" })).status, 200);
  assert.equal((await http(`${rpc}/api/v0/pin/ls?arg=${publication.cid}`, { method: "POST" })).status, 200);
  await http(`${rpc}/api/v0/shutdown`, { method: "POST" });
  assert.equal(await bounded(kubo.exit, "Author Kubo shutdown timeout."), 0);
  await assert.rejects(http(`${rpc}/api/v0/version`, { method: "POST" }));
  report.kubo.stoppedForAllGatewayScenarios = true;
  rpc = undefined;
  await writeFile("raw-source.mjs", `
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
const blocks=new Map(JSON.parse(await readFile("blocks.json","utf8")).map(([cid,base64])=>[cid,Buffer.from(base64,"base64")]));
const stats={rpcRequests:0,requests:[],oversizeClosedEarly:false,oversizeBytesWritten:0};
const server=createServer((request,response)=>{
 const url=new URL(request.url,"http://localhost");
 if(url.pathname==="/stats"){response.setHeader("content-type","application/json");response.end(JSON.stringify(stats));return;}
 if(url.pathname.startsWith("/rpc/")){stats.rpcRequests++;response.writeHead(503).end();return;}
 const entry={method:request.method,path:request.url,accept:request.headers.accept,credentialsPresent:Boolean(request.headers.authorization||request.headers.cookie)};
 stats.requests.push(entry);
 const cid=url.pathname.split("/").at(-1);
 if(!url.pathname.includes("/ipfs/")||url.search!=="?format=raw"){response.writeHead(404).end();return;}
 response.setHeader("content-type","application/vnd.ipld.raw");
 if(url.pathname.startsWith("/oversize/")){
  response.writeHead(200);let sent=0;
  const timer=setInterval(()=>{sent+=32768;stats.oversizeBytesWritten=sent;
   response.write(Buffer.alloc(32768,1));if(sent>=3*1024*1024){clearInterval(timer);response.end();}
  },2);
  response.on("close",()=>{clearInterval(timer);stats.oversizeClosedEarly=sent<3*1024*1024;});
 }else if(url.pathname.startsWith("/bad/")){entry.corrupt=true;response.end(Buffer.from("not-the-requested-CID"));}
 else if(url.pathname.startsWith("/good/")&&blocks.has(cid)){entry.bytes=blocks.get(cid).length;response.end(blocks.get(cid));}
 else response.writeHead(404).end();
});
server.listen(0,"127.0.0.1",()=>console.log(JSON.stringify({event:"ready",url:"http://127.0.0.1:"+server.address().port,pid:process.pid})));
process.on("message",()=>{server.closeAllConnections();server.close(()=>{console.log(JSON.stringify({event:"closed"}));process.disconnect();});});
`);
  rawSource = launch(process.execPath, ["raw-source.mjs"], ".", env, true);
  sourceReady = await waitReady(rawSource);
  report.rawSource = sourceReady;
  const gateway = `${sourceReady.url}/good`;
  const probe = `${sourceReady.url}/rpc`;
  const cwd = resolve("runtime", "workspace");
  const files = (...parts) => join(cwd, "files", ...parts);
  const userFile = join("isolated-user", "pguide", "config.jsonc");
  const projectFile = join(cwd, ".pguide", "config.jsonc");
  await writeFile(projectFile, '{"task-engine.ipfsTransport":"invalid-project","task-engine.ipfsGatewayUrl":false,"task-engine.port":"excluded","task-engine.database":"must-not-exist.sqlite"}');
  const projectHash = await fingerprint(projectFile);
  const oldDatabase = join(cwd, "old.sqlite");
  await writeFile(oldDatabase, "owned old database sentinel; never open or migrate");
  const oldDatabaseHash = await fingerprint(oldDatabase);
  await writeFile(userFile, "{}");
  const pipe = `\\\\.\\pipe\\pguide-gateway-outer-${process.pid}`;
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
  await new Promise((done, reject) => { signalController.once("error", reject); signalController.listen(pipe, done); });
  await writeFile("signal-preload.mjs", `import {connect} from "node:net";
const socket=connect(process.env.PGUIDE_OUTER_SIGNAL_PIPE);socket.unref();socket.on("error",()=>{});
socket.on("connect",()=>socket.write(process.pid+"\\n"));
socket.on("data",()=>{process.emit("SIGTERM");socket.end();});`);
  await writeFile("signal-wrapper.mjs", `import {pathToFileURL} from "node:url";
const entry=process.argv[2];process.argv.splice(1,1);
process.on("message",()=>process.emit("SIGTERM"));await import(pathToFileURL(entry).href);`);
  env.PGUIDE_OUTER_SIGNAL_PIPE = pipe;
  env.NODE_OPTIONS = `--import=${pathToFileURL(resolve("signal-preload.mjs")).href}`;
  async function submit(base, headers = {}) {
    const id = requestId();
    const response = await http(`${base}/tasks`, { method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": id, ...headers },
      body: JSON.stringify({ bundle: publication.cid, message: "gateway-outer-proof", timeoutMs: 15_000 }) });
    assert.ok([200, 202].includes(response.status), await response.text());
    return id;
  }
  async function decision(url, id) {
    for (let index = 0; index < 60; index++) {
      const value = await (await http(`${url}/requests/${id}/status?waitMs=1000`)).json();
      if (value.status !== "preparing") return value;
    }
    throw new Error("Preparation did not finish.");
  }
  async function complete(url, id) {
    const accepted = await decision(url, id);
    assert.equal(accepted.status, "accepted", JSON.stringify(accepted));
    for (let count = 0; count < 150; count++) {
      const task = await (await http(`${url}/tasks/${accepted.taskId}`)).json();
      if (task.stage === "completed") {
        assert.deepEqual(task.result, report.bundle.expectedResult);
        return accepted.taskId;
      }
      assert.notEqual(task.stage, "failed", JSON.stringify(task));
      await delay(100);
    }
    throw new Error("Task did not complete.");
  }
  async function stop(state, ready, discovered) {
    if (discovered) {
      assert.ok(signalSockets.has(ready.pid), "Missing discovered-service signal channel.");
      signalSockets.get(ready.pid).write("stop\n");
      state.child.disconnect();
    } else { state.child.send("stop"); state.child.disconnect(); }
    const code = await bounded(state.exit, "Service exit timeout.");
    assert.equal(code, 0);
    assert.match(state.stdout, /"event":"closed"/);
    await assert.rejects(http(`${ready.url}/tasks`));
    if (ready.uiUrl) await assert.rejects(http(ready.uiUrl));
    assert.equal((await http(`${sourceReady.url}/stats`)).status, 200);
    if (rpc) assert.equal((await http(`${rpc}/api/v0/version`, { method: "POST" })).status, 200);
    return code;
  }
  async function scenario(label, discovered, args, database, ui = false, rejected = false, transport = "gateway") {
    const state = launch(process.execPath, [resolve("signal-wrapper.mjs"), discovered ? top : main,
      ...(discovered ? ["task-engine"] : []), "--cwd", cwd, ...args], cwd, env, true);
    let ready;
    try {
      ready = await waitReady(state);
      assert.notEqual(ready.pid, sourceReady.pid);
      assert.equal(Boolean(ready.uiUrl), ui);
      assert.equal((await http(`${ready.url}/tasks`)).status, 200);
      const id = await submit(ready.url);
      let taskId, rejection, proxyTaskId;
      if (rejected) {
        rejection = await decision(ready.url, id);
        assert.equal(rejection.status, "rejected", JSON.stringify(rejection));
        assert.equal((await (await http(`${ready.url}/tasks`)).json()).tasks.length, 0);
      } else taskId = await complete(ready.url, id);
      for (const headers of [{ origin: "https://evil.invalid" }, { "sec-fetch-site": "cross-site" }])
        assert.equal((await http(`${ready.url}/tasks`, { headers })).status, 403);
      const badHost = await new Promise((done, reject) => {
        get(`${ready.url}/tasks`, { headers: { host: "evil.invalid" } }, (response) => {
          response.resume(); done(response.statusCode);
        }).on("error", reject);
      });
      assert.equal(badHost, 403);
      if (ui) {
        assert.match(await (await http(ready.uiUrl)).text(), /<html/);
        for (const asset of ["app.js", "style.css"]) assert.equal((await http(`${ready.uiUrl}/${asset}`)).status, 200);
        const bootstrap = await (await http(`${ready.uiUrl}/api/bootstrap`)).json();
        const headers = { origin: ready.uiUrl, "x-ui-token": bootstrap.csrf,
          "x-endpoint-binding": bootstrap.endpoints[0].binding };
        assert.equal((await http(`${ready.uiUrl}/api/endpoints/local/tasks/${taskId}`, { headers })).status, 200);
        proxyTaskId = await complete(ready.url, await submit(`${ready.uiUrl}/api/endpoints/local`, headers));
        assert.equal((await http(ready.uiUrl, { headers: { origin: "https://evil.invalid" } })).status, 403);
      }
      assert.ok((await stat(database)).size > 0);
      const exited = await stop(state, ready, discovered);
      if (taskId) {
        const db = new DatabaseSync(database, { readOnly: true });
        try {
          const row = db.prepare("SELECT task_id FROM requests WHERE request_id=?").get(id);
          assert.ok(row);
          assert.equal(row.task_id, taskId);
        } finally { db.close(); }
      }
      const result = { label, entry: discovered ? "pguide task-engine" : "pguide-task-engine",
        arguments: args.map(safe), transport, ...ready, database: safe(resolve(database)),
        requestId: id, taskId, proxyTaskId, rejection, result: rejected ? undefined : report.bundle.expectedResult,
        exited, graceful: true, sourceSurvived: true, acceptedRequestVerifiedInDatabase: Boolean(taskId),
        ownedKuboAbsent: transport === "gateway" && rpc === undefined,
        ownedKuboSurvived: transport === "rpc" && Boolean(rpc) };
      (rejected ? report.contentFailures : report.scenarios).push(result);
    } finally {
      if (!state.exited) {
        if (ready) try { process.kill(ready.pid, "SIGKILL"); } catch {}
        state.child.kill("SIGKILL");
        await bounded(state.exit, "Invocation cleanup timeout.");
      }
    }
  }
  const cliGateway = ["--ipfs-transport", "gateway", "--ipfs-gateway-url", gateway, "--ipfs-rpc-url", probe];
  await scenario("纯参数 / Engine-only", false,
    ["--no-global-config", "--port", "0", "--database", join("cli", "cli.sqlite"), ...cliGateway],
    join(cwd, "cli", "cli.sqlite"));
  await writeFile(files("server.yaml"), `port: 2345\ndatabase: yaml.sqlite\nipfsTransport: gateway\nipfsGatewayUrl: ${gateway}/\nipfsRpcUrl: ${probe}\n`);
  await scenario("发现 / YAML / CLI 端口覆盖 / base 尾斜杠", true,
    ["--no-global-config", "--config", join("files", "server.yaml"), "--port", "0"], files("yaml.sqlite"));
  await writeFile(files("server.json"), JSON.stringify({ port: 0, database: "json.sqlite",
    ipfsTransport: "gateway", ipfsGatewayUrl: gateway, ipfsRpcUrl: probe }));
  await scenario("独立入口 / JSON", false,
    ["--no-global-config", "--config", join("files", "server.json")], files("json.sqlite"));
  const userValues = { "task-engine.port": 0, "task-engine.database": "user.sqlite",
    "task-engine.ipfsTransport": "gateway", "task-engine.ipfsGatewayUrl": gateway,
    "task-engine.ipfsRpcUrl": probe, "task-engine.scope": "outer" };
  await writeFile(userFile, `// isolated JSONC\n${JSON.stringify(userValues, null, 2).replace(/\n}$/, ",\n}")}\n`);
  await scenario("发现 / 用户 JSONC / 项目排除 / 用户数据库锚点", true, [],
    join("isolated-user", "pguide", "user.sqlite"));
  await writeFile(userFile, JSON.stringify({ ...userValues, "task-engine.ipfsTransport": "rpc",
    "task-engine.ipfsGatewayUrl": `${sourceReady.url}/unused-user` }));
  await writeFile(files("ui.yaml"), `port: 3456\ndatabase: ui.sqlite\nipfsTransport: gateway\nipfsGatewayUrl: ${sourceReady.url}/unused-file\nuiOptions: {host: localhost, port: 0, favoritesFile: ui-favorites.json}\n`);
  await scenario("四层覆盖 / UI 公开 HTTP / CLI Gateway URL", false,
    ["--config", join("files", "ui.yaml"), "--port", "0", "--ipfs-gateway-url", gateway, "--ui"],
    files("ui.sqlite"), true);
  await writeFile(userFile, "{broken");
  await scenario("发现 / 损坏用户层被完全禁用", true,
    ["--no-global-config", "--config", join("files", "server.json"), "--database", join("cli", "isolated.sqlite")],
    join(cwd, "cli", "isolated.sqlite"));
  for (const discovered of [false, true]) {
    for (const [label, user, file, flags] of [
      ["启用的损坏用户层", "{broken", {}, []],
      ["被覆盖的非法文件 transport", "{}", { ipfsTransport: "auto" }, ["--ipfs-transport", "rpc"]],
      ["被覆盖的非法文件 URL", "{}", { ipfsGatewayUrl: "file:///invalid" }, ["--ipfs-gateway-url", gateway]],
      ["被覆盖的非法用户 transport", '{"task-engine.ipfsTransport":"auto"}', {}, ["--ipfs-transport", "rpc"]],
      ["被覆盖的非法用户 URL", '{"task-engine.ipfsGatewayUrl":"https://invalid.test/?query=1"}', {}, ["--ipfs-gateway-url", gateway]],
      ["Gateway 缺 URL", "{}", { ipfsTransport: "gateway" }, []],
      ["非法 port 被覆盖", "{}", { port: "invalid" }, ["--port", "0"]],
      ["非回环拒绝", "{}", { host: "0.0.0.0" }, []],
    ]) {
      await writeFile(userFile, user);
      await writeFile(files("invalid.json"), JSON.stringify(file));
      const state = await run(process.execPath, [discovered ? top : main,
        ...(discovered ? ["task-engine"] : []), "--cwd", cwd,
        "--config", join("files", "invalid.json"), ...flags], cwd, env, true);
      report.configurationFailures.push({ entry: discovered ? "pguide task-engine" : "pguide-task-engine",
        label, code: await state.exit, noReady: true, diagnostic: safe(state.stderr + state.stdout).trim() });
    }
    await writeFile(userFile, "{}");
    await writeFile(files("unsafe.mjs"), `import {writeFileSync} from "node:fs";writeFileSync("executed-marker","bad");`);
    const state = await run(process.execPath, [discovered ? top : main,
      ...(discovered ? ["task-engine"] : []), "--cwd", cwd, "--config", join("files", "unsafe.mjs")], cwd, env, true);
    await assert.rejects(access(join(cwd, "executed-marker")));
    report.configurationFailures.push({ entry: discovered ? "pguide task-engine" : "pguide-task-engine",
      label: "旧模块拒绝且无副作用", code: await state.exit, noReady: true, markerAbsent: true });
  }
  for (const [label, path, discovered] of [
    ["坏 CID 内容", "/bad", false], ["超限 chunked 流", "/oversize", true],
    ["不可达 Gateway", null, false],
  ]) {
    let url = path ? `${sourceReady.url}${path}` : undefined;
    if (!url) {
      const reserve = createServer();
      await new Promise((done) => reserve.listen(0, "127.0.0.1", done));
      url = `http://127.0.0.1:${reserve.address().port}`;
      await new Promise((done) => reserve.close(done));
    }
    await scenario(label, discovered, ["--no-global-config", "--port", "0", "--database",
      `${report.contentFailures.length}-failure.sqlite`, "--ipfs-transport", "gateway",
      "--ipfs-gateway-url", url, "--ipfs-rpc-url", probe],
      join(cwd, `${report.contentFailures.length}-failure.sqlite`), false, true);
    assert.equal((await (await http(`${sourceReady.url}/stats`)).json()).rpcRequests, 0);
  }
  rpc = await startOwnedKubo();
  report.kubo.controlRpc = rpc;
  report.kubo.controlPid = kubo.child.pid;
  await scenario("默认 RPC 对照 / Gateway URL 不自动选择 transport", true,
    ["--no-global-config", "--port", "0", "--database", join("cli", "rpc.sqlite"),
      "--ipfs-rpc-url", rpc, "--ipfs-gateway-url", `${sourceReady.url}/unused-rpc`],
    join(cwd, "cli", "rpc.sqlite"), false, false, "rpc");
  report.rawSourceStats = await (await http(`${sourceReady.url}/stats`)).json();
  assert.equal(report.rawSourceStats.rpcRequests, 0);
  assert.equal(report.rawSourceStats.requests.some(({ path }) => path.startsWith("/unused")), false);
  assert.ok(report.rawSourceStats.oversizeClosedEarly);
  const good = report.rawSourceStats.requests.filter(({ path }) => path.startsWith("/good/"));
  assert.ok(new Set(good.map(({ path }) => path)).size >= publication.blocks);
  for (const request of report.rawSourceStats.requests) {
    assert.equal(request.method, "GET");
    assert.equal(request.accept, "application/vnd.ipld.raw");
    assert.equal(request.credentialsPresent, false);
  }
  report.configProtection = { originalUserUnchanged: originalUserHash === await fingerprint(originalUserFile),
    projectUnchanged: projectHash === await fingerprint(projectFile),
    oldDatabaseUnchanged: oldDatabaseHash === await fingerprint(oldDatabase),
    projectDatabaseAbsent: await fingerprint(join(cwd, "must-not-exist.sqlite")) === "absent" };
  for (const value of Object.values(report.configProtection)) assert.equal(value, true);
  rawSource.child.send("close");
  rawSource.child.disconnect();
  assert.equal(await bounded(rawSource.exit, "Raw source exit timeout."), 0);
  await assert.rejects(http(`${sourceReady.url}/stats`));
  report.cleanup.rawSourceGracefulExit = true;
  await http(`${rpc}/api/v0/shutdown`, { method: "POST" });
  assert.equal(await bounded(kubo.exit, "Kubo shutdown timeout."), 0);
  await assert.rejects(http(`${rpc}/api/v0/version`, { method: "POST" }));
  await run(ipfs, ["repo", "stat"], ".", kuboEnv);
  report.cleanup.ownedKuboGracefulExitAndRepoLockReleased = true;
} catch (error) {
  report.errors.push(safe(error.stack ?? error));
  process.exitCode = 1;
} finally {
  for (const state of [...children]) {
    if (!state.exited) {
      state.child.kill("SIGKILL");
      try { await bounded(state.exit, "Helper cleanup timeout.", 10_000); } catch {}
    }
  }
  for (const socket of signalSockets.values()) socket.destroy();
  if (signalController) await new Promise((done) => signalController.close(done));
  report.cleanup.trackedChildrenRemaining = children.size;
  report.cleanup.signalControllerClosed = !signalController?.listening;
  report.cleanup.originalUserUnchanged = originalUserHash === await fingerprint(originalUserFile);
  report.cleanup.externalRootRemovalRequired = true;
  await writeFile("Gateway-Results.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ scenarios: report.scenarios.length,
    configurationFailures: report.configurationFailures.length, contentFailures: report.contentFailures.length,
    trackedChildrenRemaining: children.size, errors: report.errors }));
}
