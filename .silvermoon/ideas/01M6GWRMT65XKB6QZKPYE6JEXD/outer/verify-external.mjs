import assert from "node:assert/strict";
import { spawn as nativeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, values) => {
    if (index % 2 === 0) pairs.push([value.replace(/^--/, ""), values[index + 1]]);
    return pairs;
  }, []),
);
for (const key of ["base", "packs", "pnpm", "node", "evidence"])
  assert.ok(args[key], `Required: --${key} <path>`);
const repository = process.cwd();
const base = resolve(args.base);
const consumer = join(base, "consumer");
assert.ok(isAbsolute(relative(repository, consumer)) || relative(repository, consumer).startsWith(".."));
await assert.rejects(stat(consumer), { code: "ENOENT" });
await mkdir(consumer);
await mkdir(join(consumer, ".pguide"));
await writeFile(join(consumer, ".pguide", "config.jsonc"), "{}\n");
const facts = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  driverNode: process.version,
  repository,
  sourceCommit: "e9b2985ca1e90bb010aca73ea062516bb82d2bcf",
  acceptedInner: "282fc60f2e22da55ae4e2775e4c62567d641fcb7",
  deploymentContract: "8cdffd1028b4",
  consumer,
  commands: [],
  packages: [],
  failures: [],
};
const env = {
  ...process.env,
  APPDATA: join(consumer, "home"),
  XDG_CONFIG_HOME: join(consumer, "home"),
  NODE_OPTIONS: "",
  NODE_PATH: "",
  PATH: `${dirname(resolve(args.node))}${delimiter}${join(consumer, "author", "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
};
let spawn = nativeSpawn;
async function run(command, arguments_, cwd = consumer, options = {}) {
  const commandRecord = { command, arguments: arguments_, cwd, startedAt: new Date().toISOString() };
  facts.commands.push(commandRecord);
  const result = await new Promise((done, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: { ...env, ...options.env },
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => done({ code, signal, stdout, stderr }));
  });
  Object.assign(commandRecord, result, { finishedAt: new Date().toISOString() });
  if (arguments_[0] === "list") commandRecord.stdout = "Dependency graph captured in structured authorGraph/hostGraph.";
  if (options.failure) assert.notEqual(result.code, 0, "Invalid artifact must be rejected");
  else assert.equal(result.code, 0, `${command}: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
const jsonRun = async (...values) => JSON.parse(await run(...values));
const hash = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
function packageManifest(archive) {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/s, "");
    const size = Number.parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/s, "").trim(), 8) || 0;
    if (name === "package/package.json")
      return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString());
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("Tarball has no package/package.json");
}
async function tree(directory) {
  const files = {};
  async function visit(path, prefix = "") {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(join(path, entry.name), `${name}/`);
      else {
        assert.ok(entry.isFile());
        const bytes = await readFile(join(path, entry.name));
        files[name] = { bytes: bytes.length, sha256: hash(bytes) };
      }
    }
  }
  await visit(directory);
  return files;
}
async function install(directory, name, entries, tarballs) {
  await mkdir(directory);
  await writeFile(join(directory, "package.json"), JSON.stringify({
    name,
    private: true,
    type: "module",
    dependencies: Object.fromEntries(entries.map((entry) => [entry, tarballs.get(entry) ?? "0.34.52"])),
  }, null, 2));
  await writeFile(join(directory, "pnpm-workspace.yaml"), `packages: []\noverrides: ${JSON.stringify(Object.fromEntries(tarballs))}\n`);
  await run(args.pnpm, ["install", "--prod", "--prefer-offline", "--ignore-scripts", "--no-frozen-lockfile", "--reporter=append-only"], directory);
  const listed = await jsonRun(args.pnpm, ["list", "--prod", "--depth", "Infinity", "--json"], directory);
  const graph = new Map();
  function collect(node) {
    if (node.name && node.version) graph.set(`${node.name}@${node.version}`, { name: node.name, version: node.version, path: node.path });
    for (const [name, dependency] of Object.entries({ ...node.dependencies, ...node.optionalDependencies }))
      collect({ ...dependency, name });
  }
  for (const root of listed) collect(root);
  return [...graph.values()];
}
let daemon;
let daemonExit;
let client;
let published;
let failure;
try {
  facts.pnpmVersion = (await run(args.pnpm, ["--version"])).trim();
  const tarballDirectory = join(consumer, "tarballs");
  await mkdir(tarballDirectory);
  const tarballs = new Map();
  for (const filename of (await readdir(args.packs)).filter((name) => name.endsWith(".tgz")).sort()) {
    const bytes = await readFile(join(args.packs, filename));
    const manifest = packageManifest(bytes);
    const destination = join(tarballDirectory, filename);
    await writeFile(destination, bytes, { flag: "wx" });
    tarballs.set(manifest.name, pathToFileURL(destination).href);
    facts.packages.push({ name: manifest.name, version: manifest.version, filename, bytes: bytes.length, sha256: hash(bytes) });
  }
  assert.equal(tarballs.size, 18);
  const author = join(consumer, "author");
  facts.authorGraph = await install(author, "external-bundle-author", ["pguide", "@potential-guide/pguide-task-bundle", "@sinclair/typebox"], tarballs);
  const require = createRequire(await realpath(join(author, "node_modules", "pguide", "package.json")));
  spawn = require("cross-spawn");
  facts.authorNode = (await run("node", ["--version"], author)).trim();
  assert.equal(facts.authorNode, "v22.13.0");
  const metadata = await jsonRun("pguide-task-bundle", ["--pguide-command-metadata"], author);
  assert.equal(metadata.command, "task-bundle");
  facts.discovery = await jsonRun("pguide", ["task-bundle", "--help", "--format", "json"], author);
  assert.deepEqual(facts.discovery.subcommands, ["check", "build", "publish"]);
  const contract = `import {Type} from "@sinclair/typebox";
export default {input:Type.Object({text:Type.String()},{additionalProperties:false}),result:Type.Object({echo:Type.String(),resource:Type.String()}),message:Type.Never()};\n`;
  const callback = `import type contract from "./contract.js";
import type {BundleCallback} from "@potential-guide/pguide-task-bundle";
const callback:BundleCallback<typeof contract>=async(input,context)=>{
 let resource="";for await(const chunk of context.bundle.read("resources/keep.txt"))resource+=new TextDecoder().decode(chunk);
 return {echo:input.text,resource};
};export default callback;\n`;
  async function source(directory) {
    await mkdir(join(directory, "src"), { recursive: true });
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "src", "contract.ts"), contract);
    await writeFile(join(directory, "src", "main.ts"), callback);
    await writeFile(join(directory, "assets", "keep.txt"), "offline-resource\n");
    await writeFile(join(directory, "assets", "obsolete.txt"), "remove me\n");
    await writeFile(join(directory, "task.build.yaml"), JSON.stringify({
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task-build/v1.json",
      name: "Outer external typed bundle",
      runtime: { minVersion: "22.13.0" },
      source: { entry: "src/main.ts", contract: "src/contract.ts" },
      include: [{ from: "assets/**/*.txt", to: "resources/" }],
      outDirectory: "dist",
    }, null, 2));
  }
  const one = join(author, "project-one");
  const two = join(author, "project-two");
  await source(one);
  await source(two);
  const cli = async (command, cwd, ...values) =>
    jsonRun(command, [...values, "--format", "json"], cwd);
  const checked = await cli("pguide-task-bundle", one, "check", "author", "task.build.yaml");
  await assert.rejects(stat(join(one, "dist")), { code: "ENOENT" });
  const first = await cli("pguide", one, "task-bundle", "build", "task.build.yaml");
  const repeated = await cli("pguide-task-bundle", one, "build", "task.build.yaml");
  const alternate = await cli("pguide-task-bundle", two, "build", "task.build.yaml");
  assert.equal(first.result.cid, checked.result.cid);
  assert.equal(repeated.result.cid, first.result.cid);
  assert.equal(alternate.result.cid, first.result.cid);
  assert.deepEqual(await tree(join(one, "dist")), await tree(join(two, "dist")));
  await writeFile(join(one, "assets", "added.txt"), "added resource\n");
  const added = await cli("pguide-task-bundle", one, "build", "task.build.yaml");
  assert.notEqual(added.result.cid, first.result.cid);
  assert.ok(added.result.declaration.include.includes("resources/added.txt"));
  await rm(join(one, "assets", "obsolete.txt"));
  const cleaned = await cli("pguide", one, "task-bundle", "build", "task.build.yaml");
  assert.notEqual(cleaned.result.cid, added.result.cid);
  assert.ok(!cleaned.result.declaration.include.includes("resources/obsolete.txt"));
  const finalCheck = await cli("pguide-task-bundle", one, "check", "artifact", "dist");
  assert.equal(finalCheck.result.cid, cleaned.result.cid);
  const finalRepeat = await cli("pguide-task-bundle", one, "build", "task.build.yaml");
  assert.equal(finalRepeat.result.cid, cleaned.result.cid);
  await assert.rejects(stat(join(one, "task.yaml")), { code: "ENOENT" });
  const publication = join(consumer, "publication");
  const artifact = join(publication, "artifact");
  await mkdir(publication);
  await cp(join(one, "dist"), artifact, { recursive: true });
  facts.artifactBefore = await tree(artifact);
  assert.deepEqual(Object.keys(facts.artifactBefore).sort(), cleaned.result.declaration.include);
  await writeFile(join(one, "src", "contract.ts"), "throw new Error('publishing must not evaluate author source');");
  await rm(join(one, "src", "main.ts"));
  await rm(join(one, "task.build.yaml"));
  assert.deepEqual(await readdir(publication), ["artifact"]);
  facts.offlineAuthor = {
    daemonStarted: false,
    node: facts.authorNode,
    initialCid: first.result.cid,
    otherRootCid: alternate.result.cid,
    addedCid: added.result.cid,
    finalCid: cleaned.result.cid,
    finalRepeatCid: finalRepeat.result.cid,
    declaration: cleaned.result.declaration,
    noAuthorMaintainedTaskYaml: true,
    sourcesRemovedOrPoisonedBeforePublish: true,
  };
  const ipfs = join(base, "runtime", "kubo", "ipfs.exe");
  const ipfsPath = join(base, "kubo-data");
  const nodeConfig = JSON.parse(await readFile(join(ipfsPath, "config"), "utf8"));
  assert.equal(nodeConfig.Addresses.API, "/ip4/127.0.0.1/tcp/0");
  assert.equal(nodeConfig.Addresses.Gateway, "/ip4/127.0.0.1/tcp/0");
  assert.equal(nodeConfig.AutoConf.Enabled, false);
  assert.equal(nodeConfig.Discovery.MDNS.Enabled, false);
  assert.deepEqual(nodeConfig.Bootstrap ?? [], []);
  facts.kubo = {
    executable: ipfs,
    dataDirectory: ipfsPath,
    archiveSha512: hash(await readFile(join(base, "kubo.zip")), "sha512"),
    executableSha512: hash(await readFile(ipfs), "sha512"),
    version: (await run(ipfs, ["version"], consumer, { env: { IPFS_PATH: ipfsPath } })).trim(),
    offline: true,
    config: { API: nodeConfig.Addresses.API, Gateway: nodeConfig.Addresses.Gateway, autoConf: false, mdns: false, bootstrap: nodeConfig.Bootstrap },
  };
  assert.equal(facts.kubo.archiveSha512.toUpperCase(), "E611CECEF25CDDB10B7F907145383608D9B31219AD7120041AEACFE2313882DA1944F2897FDA29BC2D959DD357E4950089EC8F2CBD52B29F2FC472BCAE4356D0");
  let daemonLog = "";
  daemon = nativeSpawn(ipfs, ["daemon", "--offline"], { cwd: consumer, env: { ...env, IPFS_PATH: ipfsPath }, windowsHide: true });
  facts.kubo.pid = daemon.pid;
  daemonExit = new Promise((done) => daemon.once("close", (code, signal) => done({ code, signal })));
  daemon.stdout.on("data", (bytes) => { daemonLog += bytes; });
  daemon.stderr.on("data", (bytes) => { daemonLog += bytes; });
  const readyDeadline = Date.now() + 30000;
  while (!daemonLog.includes("Daemon is ready")) {
    assert.ok(daemon.exitCode === null && Date.now() < readyDeadline, daemonLog);
    await new Promise((done) => setTimeout(done, 100));
  }
  const apiAddress = (await readFile(join(ipfsPath, "api"), "utf8")).trim();
  const port = /^\/ip4\/127\.0\.0\.1\/tcp\/(\d+)$/.exec(apiAddress)?.[1];
  assert.ok(port && port !== "0");
  facts.kubo.rpc = `http://127.0.0.1:${port}`;
  facts.kubo.readyLog = daemonLog;
  const host = join(consumer, "host");
  facts.hostGraph = await install(host, "external-engine-host", ["@potential-guide/task-engine", "@potential-guide/ipfs-content"], tarballs);
  for (const entry of facts.hostGraph) {
    assert.ok(!["@potential-guide/task-sdk", "@potential-guide/pguide-task-bundle", "@sinclair/typebox", "pguide"].includes(entry.name));
    assert.ok(!entry.path?.startsWith(repository));
  }
  const clientModule = join(host, "ipfs-client.mjs");
  await writeFile(clientModule, 'export {createIpfsClient} from "@potential-guide/ipfs-content";\n');
  const ipfsModule = await import(pathToFileURL(clientModule).href);
  client = await ipfsModule.createIpfsClient(facts.kubo.rpc);
  assert.equal((await client.version()).version, "0.43.1");
  const pinRoots = async () => {
    const roots = [];
    for await (const pin of client.pin.ls({ type: "recursive" })) roots.push(pin.cid.toString());
    return roots.sort();
  };
  facts.pinsBefore = await pinRoots();
  assert.ok(!facts.pinsBefore.includes(cleaned.result.cid));
  const publishedReceipt = await cli("pguide-task-bundle", publication, "publish", artifact, "--ipfs-rpc", facts.kubo.rpc);
  published = publishedReceipt.result.cid;
  assert.equal(published, cleaned.result.cid);
  facts.publish = publishedReceipt;
  facts.pinsAfterPublish = await pinRoots();
  assert.ok(facts.pinsAfterPublish.includes(published));
  facts.artifactAfter = await tree(artifact);
  assert.deepEqual(facts.artifactAfter, facts.artifactBefore);
  facts.kuboFiles = {};
  for (const [path, expected] of Object.entries(facts.artifactBefore)) {
    const chunks = [];
    for await (const chunk of client.cat(`${published}/${path}`)) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    facts.kuboFiles[path] = { bytes: bytes.length, sha256: hash(bytes) };
    assert.deepEqual(facts.kuboFiles[path], expected);
  }
  const objectsBefore = String((await client.repo.stat()).numObjects);
  for (const kind of ["extra", "missing"]) {
    const invalid = join(publication, `invalid-${kind}`);
    await cp(artifact, invalid, { recursive: true });
    if (kind === "extra") await writeFile(join(invalid, "extra.txt"), "undeclared");
    else await rm(join(invalid, "resources", "keep.txt"));
    await run("pguide-task-bundle", ["publish", invalid, "--ipfs-rpc", facts.kubo.rpc, "--format", "json"], publication, { failure: true });
  }
  assert.equal(String((await client.repo.stat()).numObjects), objectsBefore);
  assert.deepEqual(await pinRoots(), facts.pinsAfterPublish);
  facts.invalidArtifacts = { extraRejected: true, missingRejected: true, blockCountUnchanged: objectsBefore, pinsUnchanged: true };
  const hostProgram = `
import assert from "node:assert/strict";
import {createTaskEngine,newId} from "@potential-guide/task-engine";
import {MemoryStore} from "@potential-guide/task-engine/testing";
import {createIpfsClient} from "@potential-guide/ipfs-content";
for(const name of ["@potential-guide/task-sdk","@potential-guide/pguide-task-bundle","@sinclair/typebox","pguide"])
 await assert.rejects(import(name),error=>error.code==="ERR_MODULE_NOT_FOUND");
const client=await createIpfsClient(${JSON.stringify(facts.kubo.rpc)});
const store=new MemoryStore();
const engine=createTaskEngine({store,ipfsClient:client,authorize:()=>true});
const caller={scope:"outer-external",subject:"disposable-host"};
let result;
await engine.start();
try {
 let decision=await engine.submit({requestId:newId(),bundle:${JSON.stringify(published)},text:"outer actual",timeoutMs:30000},caller);
 while(decision.status==="preparing")decision=await engine.getRequestStatus(decision.requestId,{waitMs:1000},caller);
 assert.equal(decision.status,"accepted",JSON.stringify(decision));
 let task;const deadline=Date.now()+30000;
 do {task=engine.getTask(decision.taskId,caller);if(task.stage==="completed"||task.stage==="failed")break;await new Promise(done=>setTimeout(done,20))}while(Date.now()<deadline);
 assert.equal(task.stage,"completed",JSON.stringify(task));
 assert.deepEqual(task.result,{echo:"outer actual",resource:"offline-resource\\n"});
 await engine.waitForTaskRelease(task.taskId,caller);
 const run=engine.getRun(task.run.runId,caller);
 assert.ok(run.reclaimedAt);
 result={node:process.version,bundle:${JSON.stringify(published)},taskId:task.taskId,runId:run.runId,stage:task.stage,result:task.result,reclaimedAt:run.reclaimedAt,authorImportsRejected:true,content:"real Kubo RPC blocks",factStore:"disposable MemoryStore (not an IPFS substitute)"};
}finally{await engine.close();store.close()}
console.log(JSON.stringify({...result,engineClosed:true}));
`;
  await writeFile(join(host, "consume.mjs"), hostProgram);
  facts.host = await jsonRun(args.node, ["consume.mjs"], host);
  assert.equal(facts.host.node, "v22.13.0");
  facts.pinsAfterEngineClose = await pinRoots();
  assert.deepEqual(facts.pinsAfterEngineClose, facts.pinsAfterPublish);
  facts.publisherTaskSeparation = "Publish subprocess completed before the Engine host process was started; host alone submits the CID.";
  await writeFile(join(consumer, "kubo.log"), daemonLog);
} catch (error) {
  failure = error;
  facts.failures.push({ message: error.message, stack: error.stack });
} finally {
  if (daemon) {
    try {
      if (published && client) {
        assert.equal((await client.pin.rm(published)).toString(), published);
        facts.publisherPinRemoved = true;
      }
      if (daemon.exitCode === null)
        await run(join(base, "runtime", "kubo", "ipfs.exe"), ["shutdown"], consumer, { env: { IPFS_PATH: join(base, "kubo-data") } });
      facts.kubo.exit = await Promise.race([
        daemonExit,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Owned daemon shutdown timed out")), 10000).unref()),
      ]);
      assert.equal(facts.kubo.exit.code, 0);
      facts.kubo.rpcStopped = await fetch(`${facts.kubo.rpc}/api/v0/version`, { method: "POST", signal: AbortSignal.timeout(1000) }).then(() => false, () => true);
      assert.equal(facts.kubo.rpcStopped, true);
    } catch (error) {
      facts.failures.push({ cleanup: error.message });
      failure ??= error;
      if (daemon.exitCode === null) {
        daemon.kill();
        await daemonExit;
      }
    }
  }
  facts.finishedAt = new Date().toISOString();
  facts.status = failure ? "failed" : "passed";
  await writeFile(args.evidence, `${JSON.stringify(facts, null, 2)}\n`);
}
if (failure) throw failure;
console.log(JSON.stringify({ status: facts.status, evidence: args.evidence, consumer, cid: published, daemonPid: facts.kubo.pid, daemonExit: facts.kubo.exit }));
