import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const source = resolve(process.argv[2]);
const owned = process.cwd();
const expectedCommit = process.argv[3];
assert.match(expectedCommit, /^[a-f0-9]{40}$/);
assert.ok(relative(source, owned).startsWith(`..${sep}`), "Use a fresh directory outside the checkout.");
assert.ok((await readdir(".")).every((name) => name === "run.log"), "Refuse a non-fresh directory.");
const safe = (value) => String(value)
  .replaceAll(pathToFileURL(source).href, "file:///<source>")
  .replaceAll(pathToFileURL(owned).href, "file:///<owned-root>")
  .replaceAll(source, "<source>").replaceAll(source.replaceAll("\\", "/"), "<source>")
  .replaceAll(owned, "<owned-root>").replaceAll(owned.replaceAll("\\", "/"), "<owned-root>")
  .replaceAll(process.execPath, "<node>").replaceAll(homedir(), "<user-home>")
  .replace(/file:\/\/\/[a-z]:\/Users\/[^/\s"']+/gi, "file:///<user-home>")
  .replace(/[a-z]:[\\/]Users[\\/][^\\/\s"']+/gi, "<user-home>")
  .replace(/(https?:\/\/)[^/\s@]+@/g, "$1<credentials>@");
const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedCommit);
const report = {
  sourceCommit: expectedCommit,
  deploymentBlob: git("rev-parse", "HEAD:.silvermoon/ideas/01M6GRRES5EBHYDP1G9DZEGE8E/outer/Deployment.md"),
  verifiedDeploymentRevision: git("rev-parse", "HEAD:.silvermoon/ideas/01M6GRRES5EBHYDP1G9DZEGE8E/outer"),
  acceptedInnerRevision: git("rev-parse", "HEAD:.silvermoon/ideas/01M6GRRES5EBHYDP1G9DZEGE8E/outer/inner"),
  platform: process.platform, node: process.version,
  commands: [], graphs: {}, scenarios: [], configurationFailures: [], contentFailures: [],
  lifecycleFailures: [], cleanup: {}, errors: [],
};
const marker = { purpose: "task-engine Gateway-only Outer verification", sourceCommit: expectedCommit };
await writeFile("owned-environment.json", JSON.stringify(marker));
const children = new Set();
const signalSockets = new Map();
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function bounded(promise, message, ms = 30_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
function launch(command, args, cwd = ".", env = process.env, ipc = false) {
  const child = spawn(command, args, {
    cwd, env, windowsHide: true,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
  });
  const state = { child, stdout: "", stderr: "", exited: false };
  children.add(state);
  child.stdout.on("data", (chunk) => { state.stdout += chunk; });
  child.stderr.on("data", (chunk) => { state.stderr += chunk; });
  state.exit = new Promise((done, reject) => {
    child.once("error", (error) => {
      state.exited = true; children.delete(state); reject(error);
    });
    child.once("exit", (code) => {
      state.exited = true; children.delete(state); done(code);
    });
  });
  state.exit.catch(() => {});
  return state;
}
async function run(command, args, cwd = ".", env = process.env, failure = false) {
  const state = launch(command, args, cwd, env);
  const code = await bounded(state.exit, `Command timeout: ${command}`, 180_000);
  await delay(20);
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
  for (let count = 0; count < 400; count++) {
    for (const line of state.stdout.split("\n")) {
      try { const value = JSON.parse(line); if (value.event === "ready") return value; } catch {}
    }
    if (state.exited) throw new Error(safe(state.stderr));
    await delay(50);
  }
  throw new Error("Readiness timeout.");
}
async function fingerprint(path) {
  try { return createHash("sha256").update(await readFile(path)).digest("hex"); }
  catch (error) { if (error.code === "ENOENT") return "absent"; throw error; }
}
async function closedPort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
function requestId() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = BigInt(Date.now()), prefix = "";
  for (let i = 0; i < 10; i++) { prefix = alphabet[Number(time % 32n)] + prefix; time /= 32n; }
  return prefix + [...randomBytes(16)].map((byte) => alphabet[byte % 32]).join("");
}
const originalUserFile = process.platform === "win32"
  ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "pguide", "config.jsonc")
  : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pguide", "config.jsonc");
const originalUserHash = await fingerprint(originalUserFile);
const env = { ...process.env, APPDATA: resolve("isolated-user"),
  XDG_CONFIG_HOME: resolve("isolated-user"), NODE_OPTIONS: "", NODE_PATH: "" };
for (const name of ["IPFS_API", "IPFS_GATEWAY", "IPFS_PATH"]) delete env[name];
let rawSource, sourceReady, signalController;
try {
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
  const selections = {
    runtime: ["pguide", "@potential-guide/pguide-task-engine"],
    author: ["@potential-guide/pguide-task-bundle"],
  };
  const needed = new Set();
  for (const entries of Object.values(selections))
    for (const name of consumerVersions(manifests, entries).keys()) needed.add(name);
  const tarballs = new Map();
  for (const name of needed) {
    const state = await run("pnpm.cmd", ["--dir", definitions.get(name).root, "pack",
      "--pack-destination", resolve("packs"), "--json"]);
    const packed = JSON.parse(state.stdout);
    if (name === "@potential-guide/task-engine-server")
      assert.equal(packed.files.some(({ path }) => /^dist\/main\./.test(path)), false,
        "Remove only the known retired dist/main.* artifacts before retrying.");
    tarballs.set(name, packed.filename);
  }
  report.packedPackages = needed.size;
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
  const settings = JSON.parse(await readFile(join("runtime", "node_modules", "@potential-guide",
    "pguide-task-engine", "settings.json"), "utf8"));
  assert.ok(settings.settings["task-engine.ipfsGatewayUrl"]);
  for (const id of ["task-engine.ipfsRpcUrl", "task-engine.ipfsTransport"])
    assert.equal(settings.settings[id], undefined);
  report.installedSettings = settings;
  report.metadata = JSON.parse((await run(join(bin, "pguide-task-engine.cmd"),
    ["--pguide-command-metadata"], "runtime", env)).stdout);
  assert.equal(report.metadata.command, "task-engine");
  report.help = {};
  for (const discovered of [false, true]) {
    const state = await run(process.execPath, [discovered ? top : main,
      ...(discovered ? ["task-engine"] : []), "--no-global-config", "--help", "--format", "json"], "runtime", env);
    const help = JSON.parse(state.stdout);
    assert.doesNotMatch(state.stdout, /ipfsRpcUrl|ipfsTransport|--ipfs-rpc-url|--ipfs-transport/);
    assert.equal(help.defaults.ipfsGatewayUrl, undefined);
    assert.ok(help.options.some((option) => option.includes("--ipfs-gateway-url")));
    assert.equal(help.globalConfig, resolve("isolated-user", "pguide", "config.jsonc"));
    report.help[discovered ? "pguide" : "standalone"] = help;
  }
  await writeFile(join("author", "callback.mjs"), `
export default async function(input,context) {
 let resourceBytes=0,resourceSum=0;
 for await(const bytes of context.bundle.read("resources/payload.bin")){
  resourceBytes+=bytes.length;for(const byte of bytes)resourceSum+=byte;
 }
 return {message:input.message,resourceBytes,resourceSum};
}`);
  await writeFile(join("author", "payload.bin"), Buffer.alloc(600_000, 42));
  await writeFile(join("author", "prepare.mjs"), `
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {buildTaskBundle} from "@potential-guide/pguide-task-bundle/build";
import {validateContentCar} from "@potential-guide/pguide-task-bundle/car";
const require=createRequire(import.meta.resolve("@potential-guide/pguide-task-bundle/car"));
const {CarReader}=await import(pathToFileURL(require.resolve("@ipld/car")).href);
const built=await buildTaskBundle({
 declaration:{$schema:"https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json",
 name:"Gateway-only External",runtime:{type:"node",minVersion:"22.13.0"},entry:"worker.cjs",
 inputSchema:{type:"object"},resultSchema:true,messageSchema:false},
 entry:"callback.mjs",outDirectory:"bundle",resources:{"resources/payload.bin":"payload.bin"}
});
const bytes=await readFile(built.car);
assert.equal((await validateContentCar(bytes,built.cid)).cid,built.cid);
const reader=await CarReader.fromBytes(bytes),blocks=[];
assert.equal((await reader.getRoots())[0].toString(),built.cid);
for await(const {cid,bytes} of reader.blocks())blocks.push([cid.toString(),Buffer.from(bytes).toString("base64")]);
assert.ok(blocks.length>3);
await writeFile("../blocks.json",JSON.stringify(blocks));
console.log(JSON.stringify({cid:built.cid,blocks:blocks.length,standardImporter:true,offlineCarValidated:true}));
`);
  const publication = JSON.parse((await run(process.execPath, ["prepare.mjs"], "author", env)).stdout);
  report.bundle = { ...publication, expectedResult: {
    message: "gateway-only-external-proof", resourceBytes: 600_000, resourceSum: 25_200_000,
  } };
  await rm(join("author", "callback.mjs"));
  await rm(join("author", "payload.bin"));
  await rm(join("author", "bundle"), { recursive: true });
  await rm(join("author", "bundle.car"));
  report.bundle.authorSourceAndBundleDirectoryRemovedBeforeRuntime = true;
  await writeFile("raw-source.mjs", `
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
const blocks=new Map(JSON.parse(await readFile("blocks.json","utf8")).map(([cid,base64])=>[cid,Buffer.from(base64,"base64")]));
const stats={rpcRequests:0,requests:[]};
const server=createServer((request,response)=>{
 const url=new URL(request.url,"http://localhost");
 if(url.pathname==="/stats"){response.setHeader("content-type","application/json");response.end(JSON.stringify(stats));return;}
 if(url.pathname.startsWith("/api/v0/")){stats.rpcRequests++;response.writeHead(503).end("No RPC in this fixture");return;}
 const entry={method:request.method,path:request.url,accept:request.headers.accept,credentialsPresent:Boolean(request.headers.authorization||request.headers.cookie)};
 stats.requests.push(entry);
 const cid=url.pathname.split("/").at(-1);
 if(!url.pathname.includes("/ipfs/")||url.search!=="?format=raw"){response.writeHead(404).end();return;}
 response.setHeader("content-type","application/vnd.ipld.raw");
 if(url.pathname.startsWith("/oversize/")){
  response.writeHead(200);let sent=0;entry.streamed=true;
  const timer=setInterval(()=>{sent+=32768;entry.bytesWritten=sent;
   response.write(Buffer.alloc(32768,1));if(sent>=3*1024*1024){clearInterval(timer);response.end();}
  },2);
  response.on("close",()=>{clearInterval(timer);entry.closedEarly=sent<3*1024*1024;});
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
  assert.equal((await http(`${sourceReady.url}/api/v0/version`, { method: "POST" })).status, 503);
  report.rpc = { kuboStartedOrInstalled: false, configuredServiceRpcEndpoint: false,
    ownedEndpointProbeStatus: 503, expectedProbeCount: 1 };
  const gateway = `${sourceReady.url}/good`;
  const cwd = resolve("runtime", "workspace");
  const files = (...parts) => join(cwd, "files", ...parts);
  const userFile = resolve("isolated-user", "pguide", "config.jsonc");
  const projectFile = join(cwd, ".pguide", "config.jsonc");
  await writeFile(projectFile, '{"task-engine.ipfsTransport":"invalid-project","task-engine.ipfsGatewayUrl":false,"task-engine.port":"excluded","task-engine.database":"must-not-exist.sqlite"}');
  const projectHash = await fingerprint(projectFile);
  const oldDatabase = join(cwd, "old.sqlite");
  await writeFile(oldDatabase, "owned old database sentinel; never open or migrate");
  const oldDatabaseHash = await fingerprint(oldDatabase);
  await writeFile(userFile, "{}");
  const pipe = `\\\\.\\pipe\\pguide-gateway-only-outer-${randomBytes(16).toString("hex")}`;
  signalController = createServer((socket) => {
    let text = "";
    socket.on("error", () => {});
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
      body: JSON.stringify({ bundle: publication.cid, message: report.bundle.expectedResult.message, timeoutMs: 15_000 }) });
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
    for (let count = 0; count < 200; count++) {
      const task = await (await http(`${url}/tasks/${accepted.taskId}`)).json();
      if (task.stage === "completed") {
        assert.deepEqual(task.result, report.bundle.expectedResult);
        return accepted.taskId;
      }
      assert.notEqual(task.stage, "failed", JSON.stringify(task));
      await delay(50);
    }
    throw new Error("Task did not complete.");
  }
  async function stop(state, ready) {
    for (let count = 0; count < 40 && !signalSockets.has(ready.pid); count++) await delay(25);
    assert.ok(signalSockets.has(ready.pid), "Missing service-owned graceful signal channel.");
    signalSockets.get(ready.pid).write("stop\n");
    state.child.disconnect();
    const code = await bounded(state.exit, "Service exit timeout.");
    assert.equal(code, 0, safe(state.stderr));
    assert.match(state.stdout, /"event":"closed"/);
    await assert.rejects(http(`${ready.url}/tasks`));
    if (ready.uiUrl) await assert.rejects(http(ready.uiUrl));
    assert.equal((await http(`${sourceReady.url}/stats`)).status, 200);
    return code;
  }
  async function scenario(label, discovered, args, database, ui = false, rejected = false) {
    const userBefore = await fingerprint(userFile);
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
        assert.ok(rejection.error?.code);
        assert.equal((await (await http(`${ready.url}/tasks`)).json()).tasks.length, 0);
      } else taskId = await complete(ready.url, id);
      for (const headers of [{ origin: "https://evil.invalid" }, { "sec-fetch-site": "cross-site" }])
        assert.equal((await http(`${ready.url}/tasks`, { headers })).status, 403);
      assert.equal(await new Promise((done, reject) => {
        get(`${ready.url}/tasks`, { headers: { host: "evil.invalid" } }, (response) => {
          response.resume(); done(response.statusCode);
        }).on("error", reject);
      }), 403);
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
      const exited = await stop(state, ready);
      if (taskId) {
        const db = new DatabaseSync(database, { readOnly: true });
        try {
          assert.equal(db.prepare("SELECT task_id FROM requests WHERE request_id=?").get(id).task_id, taskId);
        } finally { db.close(); }
      }
      assert.equal(await fingerprint(userFile), userBefore);
      const result = { label, entry: discovered ? "pguide task-engine" : "pguide-task-engine",
        arguments: args.map(safe), ...ready, database: safe(resolve(database)), requestId: id,
        taskId, proxyTaskId, rejection, result: rejected ? undefined : report.bundle.expectedResult,
        exited, graceful: true, sourceSurvived: true, userFileUnchanged: true,
        acceptedRequestVerifiedInDatabase: Boolean(taskId) };
      (rejected ? report.contentFailures : report.scenarios).push(result);
    } catch (error) {
      report.invocationFailure = { label, entry: discovered ? "pguide" : "standalone",
        ready, error: safe(error.stack ?? error), stdout: safe(state.stdout), stderr: safe(state.stderr) };
      throw error;
    } finally {
      if (!state.exited) {
        if (state.child.connected) state.child.disconnect();
        if (ready) try { process.kill(ready.pid, "SIGKILL"); } catch {}
        state.child.kill("SIGKILL");
        await bounded(state.exit, "Invocation cleanup timeout.").catch(() => {});
      }
    }
  }
  for (const discovered of [false, true]) {
    const tag = discovered ? "pguide" : "standalone";
    await writeFile(userFile, "{}");
    await scenario("纯参数 / Engine-only", discovered,
      ["--no-global-config", "--port", "0", "--database", join("cli", `${tag}-cli.sqlite`), "--ipfs-gateway-url", gateway],
      join(cwd, "cli", `${tag}-cli.sqlite`));
    await writeFile(files("server.yaml"), `port: 2345\ndatabase: ${tag}-yaml.sqlite\nipfsGatewayUrl: ${gateway}/\n`);
    await scenario("YAML / CLI 端口覆盖 / 文件数据库锚点", discovered,
      ["--no-global-config", "--config", join("files", "server.yaml"), "--port", "0"], files(`${tag}-yaml.sqlite`));
    await writeFile(files("server.json"), JSON.stringify({ port: 0, database: `${tag}-json.sqlite`, ipfsGatewayUrl: gateway }));
    await scenario("JSON / 文件数据库锚点", discovered,
      ["--no-global-config", "--config", join("files", "server.json")], files(`${tag}-json.sqlite`));
    const userValues = { "task-engine.port": 0, "task-engine.database": `${tag}-user.sqlite`,
      "task-engine.ipfsGatewayUrl": gateway, "task-engine.scope": "outer" };
    await writeFile(userFile, `// isolated JSONC\n${JSON.stringify(userValues, null, 2).replace(/\n}$/, ",\n}")}\n`);
    await scenario("用户 JSONC / 项目排除 / 用户数据库锚点", discovered, [], join("isolated-user", "pguide", `${tag}-user.sqlite`));
    await writeFile(userFile, JSON.stringify({ ...userValues, "task-engine.port": 3456,
      "task-engine.database": `${tag}-layered.sqlite`, "task-engine.ipfsGatewayUrl": `${sourceReady.url}/unused-user` }));
    await writeFile(files("ui.yaml"), `port: 2345\nipfsGatewayUrl: ${sourceReady.url}/unused-file\nuiOptions: {host: localhost, port: 0, favoritesFile: ${tag}-favorites.json}\n`);
    await scenario("四层覆盖 / UI 公开 HTTP / 保持低层数据库锚点", discovered,
      ["--config", join("files", "ui.yaml"), "--port", "0", "--ipfs-gateway-url", gateway, "--ui"],
      join("isolated-user", "pguide", `${tag}-layered.sqlite`), true);
    for (const [label, text] of [
      ["禁用损坏用户主文件", "{broken"],
      ["禁用旧字段及非法发现设置", '{"task-engine.ipfsRpcUrl":false,"task-engine.ipfsTransport":"rpc","pguide.commandDirectories":"invalid"}'],
    ]) {
      await writeFile(userFile, text);
      const name = `${tag}-isolated-${report.scenarios.length}.sqlite`;
      await scenario(label, discovered,
        ["--no-global-config", "--port", "0", "--database", join("cli", name), "--ipfs-gateway-url", gateway],
        join(cwd, "cli", name));
    }
  }
  for (const discovered of [false, true]) {
    const prefix = discovered ? [top, "task-engine"] : [main];
    const rejectedPort = await closedPort();
    async function rejectConfig(label, user, file, flags = [], expected = /configuration|config|Invalid|retired|requires/) {
      await writeFile(userFile, user);
      await writeFile(files("invalid.json"), JSON.stringify(file));
      const database = join(cwd, `must-not-open-${report.configurationFailures.length}.sqlite`);
      const userBefore = await fingerprint(userFile);
      const state = await run(process.execPath, [...prefix, "--cwd", cwd, "--config",
        join("files", "invalid.json"), "--port", String(rejectedPort), "--database", database,
        ...flags], cwd, env, true);
      const diagnostic = safe(state.stderr + state.stdout).trim();
      assert.match(diagnostic, expected);
      await assert.rejects(access(database));
      await assert.rejects(http(`http://127.0.0.1:${rejectedPort}/tasks`));
      assert.equal(await fingerprint(userFile), userBefore);
      report.configurationFailures.push({ entry: discovered ? "pguide task-engine" : "pguide-task-engine",
        label, code: await state.exit, noReady: true, noDatabase: true, noListener: true,
        userFileUnchanged: true, diagnostic });
    }
    for (const key of ["ipfsRpcUrl", "ipfsTransport"]) {
      for (const value of key === "ipfsRpcUrl" ? ["http://127.0.0.1:5001", false] : ["rpc", "gateway", null]) {
        for (const layer of ["user", "file"])
          await rejectConfig(`退役 ${layer} ${key}=${JSON.stringify(value)}，合法 Gateway 覆盖仍拒绝`,
            JSON.stringify(layer === "user" ? { [`task-engine.${key}`]: value } : {}),
            layer === "file" ? { [key]: value } : { ipfsGatewayUrl: gateway },
            ["--ipfs-gateway-url", gateway], /retired.*--ipfs-gateway-url/);
      }
    }
    for (const flag of ["--ipfs-rpc-url=http://127.0.0.1:5001", "--ipfs-transport=gateway"])
      await rejectConfig("退役 CLI flag", "{}", { ipfsGatewayUrl: gateway },
        ["--ipfs-gateway-url", gateway, flag], /retired.*--ipfs-gateway-url/);
    await rejectConfig("缺 URL / 无隐藏默认节点", "{}", {}, [], /requires an explicit ipfsGatewayUrl/);
    await rejectConfig("启用损坏用户层", "{broken", {}, ["--ipfs-gateway-url", gateway]);
    await rejectConfig("被覆盖的非法用户 Gateway URL", '{"task-engine.ipfsGatewayUrl":false}', {},
      ["--ipfs-gateway-url", gateway], /ipfsGatewayUrl/);
    await rejectConfig("被覆盖的非法文件 Gateway URL", "{}", { ipfsGatewayUrl: "file:///invalid" },
      ["--ipfs-gateway-url", gateway], /ipfsGatewayUrl/);
    await rejectConfig("未知服务命名空间字段", '{"task-engine.unknown":true}', {},
      ["--ipfs-gateway-url", gateway], /unknown service field/);
    await writeFile(userFile, "{}");
    await writeFile(files("unsafe.mjs"), 'import {writeFileSync} from "node:fs";writeFileSync("executed-marker","bad");');
    const module = await run(process.execPath, [...prefix, "--cwd", cwd, "--config", join("files", "unsafe.mjs")], cwd, env, true);
    assert.match(module.stderr, /Executable .mjs configs are retired/);
    await assert.rejects(access(join(cwd, "executed-marker")));
    report.configurationFailures.push({ entry: discovered ? "pguide task-engine" : "pguide-task-engine",
      label: "旧模块拒绝且不执行", code: await module.exit, noReady: true, markerAbsent: true });
    for (const path of ["/bad", "/oversize", null]) {
      const unavailablePort = path ? undefined : await closedPort();
      let enginePort = await closedPort();
      while (enginePort === unavailablePort) enginePort = await closedPort();
      const url = path ? `${sourceReady.url}${path}` : `http://127.0.0.1:${unavailablePort}`;
      const name = `${report.contentFailures.length}-failure.sqlite`;
      await scenario(path === "/bad" ? "CID 不匹配" : path === "/oversize" ? "超限 chunked 流" : "不可达 Gateway",
        discovered, ["--no-global-config", "--port", String(enginePort), "--database", name,
          "--ipfs-gateway-url", url], join(cwd, name), false, true);
    }
    const enginePort = await closedPort();
    const rollback = await run(process.execPath, [...prefix, "--cwd", cwd, "--no-global-config",
      "--port", String(enginePort), "--database", `rollback-${discovered}.sqlite`,
      "--ipfs-gateway-url", gateway, "--ui", "--ui-options", JSON.stringify({
        host: "127.0.0.1", port: Number(new URL(sourceReady.url).port), favoritesFile: "rollback.json",
      })], cwd, env, true);
    await assert.rejects(http(`http://127.0.0.1:${enginePort}/tasks`));
    assert.equal((await http(`${sourceReady.url}/stats`)).status, 200);
    report.lifecycleFailures.push({ entry: discovered ? "pguide task-engine" : "pguide-task-engine",
      label: "已占用 UI 监听不被接管；本次 Engine 回滚", code: await rollback.exit,
      engineListenerClosed: true, existingSourceListenerSurvived: true });
  }
  report.rawSourceStats = await (await http(`${sourceReady.url}/stats`)).json();
  assert.equal(report.rawSourceStats.rpcRequests, 1, "Only the explicit owned 503 probe may reach an RPC route.");
  const good = report.rawSourceStats.requests.filter(({ path }) => path.startsWith("/good/"));
  assert.ok(new Set(good.map(({ path }) => path)).size >= publication.blocks);
  assert.equal(report.rawSourceStats.requests.some(({ path }) => path.startsWith("/unused")), false);
  for (const request of report.rawSourceStats.requests) {
    assert.equal(request.method, "GET");
    assert.equal(request.accept, "application/vnd.ipld.raw");
    assert.equal(request.credentialsPresent, false);
    if (request.streamed) {
      assert.ok(request.closedEarly);
      assert.ok(request.bytesWritten > 2 * 1024 * 1024 && request.bytesWritten < 3 * 1024 * 1024);
    }
  }
  report.configProtection = {
    originalUserUnchanged: originalUserHash === await fingerprint(originalUserFile),
    projectUnchanged: projectHash === await fingerprint(projectFile),
    oldDatabaseUnchanged: oldDatabaseHash === await fingerprint(oldDatabase),
    projectDatabaseAbsent: await fingerprint(join(cwd, "must-not-exist.sqlite")) === "absent",
    defaultDatabaseAbsent: await fingerprint(join(cwd, "tasks.sqlite")) === "absent",
  };
  for (const value of Object.values(report.configProtection)) assert.equal(value, true);
  rawSource.child.send("close");
  rawSource.child.disconnect();
  assert.equal(await bounded(rawSource.exit, "Raw source exit timeout."), 0);
  await assert.rejects(http(`${sourceReady.url}/stats`));
  report.cleanup.rawSourceGracefulExit = true;
} catch (error) {
  report.errors.push(safe(error.stack ?? error));
  process.exitCode = 1;
} finally {
  report.cleanup.forcedOwnedPids = [];
  for (const socket of signalSockets.values()) socket.write("stop\n");
  await delay(100);
  for (const [pid, socket] of signalSockets) {
    if (!socket.destroyed) try {
      process.kill(pid, "SIGKILL"); report.cleanup.forcedOwnedPids.push(pid);
    } catch {}
    socket.destroy();
  }
  for (const state of [...children]) {
    if (!state.exited) {
      if (state.child.connected) state.child.disconnect();
      state.child.kill("SIGKILL");
      report.cleanup.forcedOwnedPids.push(state.child.pid);
      try { await bounded(state.exit, "Helper cleanup timeout.", 10_000); } catch {}
    }
  }
  if (signalController) await new Promise((done) => signalController.close(done));
  report.cleanup.trackedChildrenRemaining = children.size;
  report.cleanup.signalControllerClosed = !signalController?.listening;
  report.cleanup.originalUserUnchanged = originalUserHash === await fingerprint(originalUserFile);
  report.cleanup.externalRootRemovalRequired = true;
  const sanitized = JSON.stringify(report, (_key, value) => typeof value === "string" ? safe(value) : value, 2);
  await writeFile("Gateway-Only-Results.json", `${sanitized}\n`);
  console.log(JSON.stringify({ scenarios: report.scenarios.length,
    configurationFailures: report.configurationFailures.length, contentFailures: report.contentFailures.length,
    lifecycleFailures: report.lifecycleFailures.length, trackedChildrenRemaining: children.size, errors: report.errors }));
}
