import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const outer = dirname(fileURLToPath(import.meta.url));
const repository = resolve(outer, "../../../..");
const invocation = randomUUID();
const external = join(dirname(repository), `potential-guide-check-consumer-${invocation}`);
const marker = `check-artifacts:${invocation}`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (parent, path) => {
  const child = relative(parent, path);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
};
async function command(command, args, cwd, environment = {}) {
  const result = await exec(command, args, {
    cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "", ...environment },
  });
  return { stdout: result.stdout, stderr: result.stderr };
}
async function pnpm(args, cwd = repository) {
  // Use the exact pnpm installation exposed to the author; data is passed over stdin.
  const script = `$ErrorActionPreference='Stop'; $r=[Console]::In.ReadToEnd()|ConvertFrom-Json; Set-Location -LiteralPath $r.cwd; $parameters=@($r.args | ForEach-Object { [string]$_ }); & pnpm @parameters; exit $LASTEXITCODE`;
  const child = execFile(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
    "-NoProfile", "-NonInteractive", "-Command", script,
  ], {
    cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
  });
  child.stdin.end(JSON.stringify({ cwd, args }));
  return await new Promise((done, fail) => {
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", fail);
    child.once("close", (code) => code === 0 ? done({ stdout, stderr }) : fail(new Error(`pnpm exited ${code}: ${stdout}\n${stderr}`)));
  });
}
const consumerProgram = String.raw`
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {chmod,lstat,readFile,readdir,realpath,rm,writeFile} from "node:fs/promises";
import {isAbsolute,join,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {prepareCheckArtifact,inspectCheckArtifact} from "@potential-guide/check-artifacts";
import {CheckKernel,terminal,closePrivateFileBackend} from "@potential-guide/check-host";

const root=process.cwd();
const delivery=JSON.parse(await readFile("delivery.json","utf8"));
const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
const inside=(parent,path)=>{const p=relative(parent,path);return p===""||(!isAbsolute(p)&&p!==".."&&!p.startsWith(".."+sep));};
const result={root,sourceRepository:delivery.repository,node:process.version,platform:process.platform,
  nodePath:process.env.NODE_PATH??"",nodeOptions:process.env.NODE_OPTIONS??"",
  tlsVerificationDisabled:process.env.NODE_TLS_REJECT_UNAUTHORIZED==="0",modules:[],scenarios:[]};
assert.equal(result.nodePath,"");assert.equal(result.nodeOptions,"");assert.equal(result.tlsVerificationDisabled,false);
for(const name of ["@potential-guide/check-artifacts","@potential-guide/check-host","@potential-guide/effects"]){
  const module=await realpath(fileURLToPath(import.meta.resolve(name)));
  assert.ok(inside(root,module));assert.ok(!inside(delivery.repository,module));
  result.modules.push({name,module});
}
const source={kind:"directory",directory:resolve("delivery/local-check"),digest:delivery.digest};
const remote={kind:"https",url:delivery.url,digest:delivery.digest,transportDigest:delivery.transportDigest};
const kernel=await CheckKernel.create(resolve("snapshots"));
const refs=Object.entries(delivery.files).filter(([name])=>name.startsWith("references/"));
let executionNumber=0;
async function verify(prepared){
  const artifact=await inspectCheckArtifact(prepared.artifactDirectory);
  assert.equal(artifact.digest,delivery.digest);
  for(const [name,bytes] of artifact.files){
    assert.ok(!name.toLowerCase().split("/").includes("node_modules"));
    assert.equal(sha256(bytes),delivery.files[name].sha256);
    assert.equal(bytes.length,delivery.files[name].bytes);
  }
  for(const [name,facts] of refs)assert.equal(sha256(await readFile(join(prepared.artifactDirectory,name))),facts.sha256);
  const entries=(await readdir(prepared.directory)).sort();
  assert.deepEqual(entries,["resources","worker.cjs"]);
  return {digest:prepared.digest,revision:prepared.revision,artifactDirectory:prepared.artifactDirectory,
    directory:prepared.directory,executionEntries:entries,references:refs.map(([name,facts])=>({name,...facts}))};
}
async function run(prepared,label,matching){
  const file=resolve(label+"-target.txt");
  await writeFile(file,matching?Buffer.from(delivery.expected,"base64"):Buffer.from("incorrect external target\n"));
  const checkId=label+"-"+(++executionNumber);
  await kernel.executeCheck({checkId,directory:prepared.directory,revision:prepared.revision,subject:{file}});
  const deadline=Date.now()+15000;
  while(!terminal(kernel.sample(checkId))){assert.ok(Date.now()<deadline,"external Host did not terminate");await new Promise(done=>setTimeout(done,10));}
  const state=kernel.sample(checkId);
  assert.equal(state.state,"Completed");
  assert.equal(state.result.payload.ok,matching);
  assert.deepEqual(state.result.payload.problems.map(p=>p.id),matching?[]:["content-mismatch"]);
  return state;
}
async function failure(label,source,cacheName){
  const cacheDirectory=resolve(cacheName);
  const before=kernel.diagnostics().executions;
  let diagnostic;
  try{await prepareCheckArtifact(source,{cacheDirectory});throw new Error("UNEXPECTED PREPARATION SUCCESS");}
  catch(error){assert.notEqual(error.message,"UNEXPECTED PREPARATION SUCCESS");diagnostic=error.message;}
  assert.equal(kernel.diagnostics().executions,before);
  const cacheEntries=await readdir(cacheDirectory).catch(error=>{if(error.code==="ENOENT")return [];throw error;});
  assert.deepEqual(cacheEntries,[]);
  result.scenarios.push({label,outcome:"rejected",diagnostic,executionsBefore:before,executionsAfter:kernel.diagnostics().executions,cacheEntries});
}
try{
  const local=await prepareCheckArtifact(source,{cacheDirectory:resolve("cache-local")});
  const localFacts=await verify(local);
  result.scenarios.push({label:"local-positive",outcome:"executed",source,...localFacts,state:await run(local,"local-positive",true)});
  result.scenarios.push({label:"local-negative-business",outcome:"executed",state:await run(local,"local-negative",false)});
  const https=await prepareCheckArtifact(remote,{cacheDirectory:resolve("cache-https")});
  assert.equal(https.revision,local.revision);
  result.scenarios.push({label:"https-positive",outcome:"executed",source:remote,...await verify(https),state:await run(https,"https-positive",true)});
  result.scenarios.push({label:"https-negative-business",outcome:"executed",state:await run(https,"https-negative",false)});
  await failure("wrong-logical-digest",{...remote,digest:"sha256-pguide-check-v1:"+"0".repeat(64)},"cache-bad-logical");
  await failure("wrong-transfer-digest",{...remote,transportDigest:"sha256:"+"0".repeat(64)},"cache-bad-transfer");
  await failure("tampered-https-content",{...remote,url:delivery.tamperedURL},"cache-tampered");
  await failure("missing-https-source",{...remote,url:delivery.missingURL},"cache-http-missing");
  await failure("missing-local-source",{...source,directory:resolve("delivery/missing")},"cache-local-missing");
  const tampered=await prepareCheckArtifact(source,{cacheDirectory:resolve("cache-tampered-reference")});
  const reference=join(tampered.artifactDirectory,delivery.checkReference);
  await chmod(reference,0o600);await writeFile(reference,"tampered reference");
  const before=kernel.diagnostics().executions;
  await assert.rejects(prepareCheckArtifact(source,{cacheDirectory:resolve("cache-tampered-reference")}),/digest mismatch/);
  assert.equal(kernel.diagnostics().executions,before);
  assert.equal(await readFile(reference,"utf8"),"tampered reference");
  result.scenarios.push({label:"tampered-cached-reference",outcome:"rejected",executionsBefore:before,executionsAfter:kernel.diagnostics().executions,notRepaired:true});
  const missing=await prepareCheckArtifact(source,{cacheDirectory:resolve("cache-missing-worker")});
  await rm(join(missing.directory,"worker.cjs"),{force:true});
  await assert.rejects(prepareCheckArtifact(source,{cacheDirectory:resolve("cache-missing-worker")}));
  assert.equal(kernel.diagnostics().executions,before);
  result.scenarios.push({label:"missing-cached-worker",outcome:"rejected",executionsBefore:before,executionsAfter:kernel.diagnostics().executions,notRepaired:true});
  // Ask the owned server to stop, and wait for its response to finish.
  const stopped=await fetch(delivery.stopURL,{redirect:"error"});
  assert.equal(stopped.status,200);assert.equal(await stopped.text(),"stopping");
  let unavailable=false;
  try{await fetch(delivery.url,{signal:AbortSignal.timeout(2000),redirect:"error"});}catch{unavailable=true;}
  assert.ok(unavailable,"HTTPS server must really be stopped");
  await failure("unreachable-https-source",{...remote},"cache-unreachable");
  const offline=await prepareCheckArtifact(remote,{cacheDirectory:resolve("cache-https")});
  assert.equal(offline.revision,https.revision);
  result.scenarios.push({label:"offline-https-cache",outcome:"executed",serverUnavailable:true,...await verify(offline),state:await run(offline,"offline",true)});
  result.diagnostics=kernel.diagnostics();
  assert.equal(result.diagnostics.executions,5);assert.equal(result.diagnostics.ownedProcesses,0);
}finally{
  await kernel.close();await closePrivateFileBackend();
  result.cleanup={kernelClosed:true,permissionBackendClosed:true};
}
await writeFile("consumer-results.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({scenarios:result.scenarios.length,executions:result.diagnostics.executions,passed:true}));
`;
let server;
let externalOwned = false;
let author;
let output;
try {
  assert.equal(process.platform, "win32", "This recorded verifier intentionally targets Windows.");
  assert.ok(!inside(repository, external));
  await mkdir(external);
  externalOwned = true;
  await writeFile(join(external, ".operation-owner"), marker, { flag: "wx" });
  const baseline = (await command("git", ["rev-parse", "HEAD"], repository)).stdout.trim();
  const outerPath = relative(repository, outer).split(sep).join("/");
  const deploymentRevision = (await command("git", ["rev-parse", `HEAD:${outerPath}`], repository)).stdout.trim();
  const contractBlob = (await command("git", ["rev-parse", `HEAD:${outerPath}/Deployment.md`], repository)).stdout.trim();
  assert.equal((await command("git", ["hash-object", join(outer, "Deployment.md")], repository)).stdout.trim(), contractBlob);
  assert.equal((await command("git", ["rev-parse", `HEAD:${outerPath}/inner`], repository)).stdout.trim(), "3687d470ca0c7b7930400ef553029a1e18df7fae");
  assert.equal((await command("git", ["status", "--porcelain"], repository)).stdout.trim(), "");
  const packs = join(external, "delivery", "tools");
  await mkdir(packs, { recursive: true });
  const tools = [];
  for (const workspace of ["effects", "check-host", "check-artifacts"]) {
    const packed = await pnpm(["--dir", join(repository, "packages", workspace), "pack", "--pack-destination", packs, "--json"]);
    const manifest = JSON.parse(packed.stdout.trim());
    const bytes = await readFile(manifest.filename);
    tools.push({ name: manifest.name, version: manifest.version, filename: manifest.filename, sha256: sha256(bytes), files: manifest.files.length });
  }
  const { buildCheckArtifact, packCheckArtifact } = await import(pathToFileURL(join(repository, "packages", "check-artifacts", "dist", "build.js")).href);
  const { inspectCheckArtifact } = await import(pathToFileURL(join(repository, "packages", "check-artifacts", "dist", "index.js")).href);
  author = join(repository, ".cache", `check-artifacts-deployment-author-${invocation}`);
  const example = join(repository, "packages", "check-artifacts", "examples", "file-content");
  const manifest = JSON.parse(await readFile(join(example, "check.json"), "utf8"));
  const built = await buildCheckArtifact({
    entry: join(example, "worker.ts"), manifest,
    files: {
      "resources/expected.txt": join(example, "expected.txt"),
      "references/check.md": join(example, "references", "check.md"),
      "references/content-mismatch.md": join(example, "references", "content-mismatch.md"),
    }, outDirectory: author,
  });
  const packed = await packCheckArtifact(built.directory, join(external, "delivery", "check.tgz"));
  const inspection = await inspectCheckArtifact(built.directory);
  await cp(built.directory, join(external, "delivery", "local-check"), { recursive: true });
  const tls = join(external, "tls");
  await mkdir(tls);
  const openssl = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "openssl.exe");
  await command(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", "key.pem", "-out", "cert.pem", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], tls);
  const archive = await readFile(packed.archive);
  const requests = [];
  const stopToken = randomUUID();
  server = createServer({ cert: await readFile(join(tls, "cert.pem")), key: await readFile(join(tls, "key.pem")) }, (request, response) => {
    requests.push({ method: request.method, path: request.url === `/stop/${stopToken}` ? "/stop/<operation-token>" : request.url });
    if (request.url === `/stop/${stopToken}`) {
      response.writeHead(200);response.end("stopping", () => { server.close();server.closeAllConnections(); });
    } else if (request.url === "/check.tgz") {
      response.writeHead(200, { "content-type": "application/gzip", "content-length": String(archive.length) });response.end(archive);
    } else if (request.url === "/tampered.tgz") {
      const tampered = Buffer.from(archive);tampered[0] ^= 0xff;
      response.writeHead(200);response.end(tampered);
    } else { response.writeHead(404);response.end("missing"); }
  });
  await new Promise((done, fail) => { server.once("error", fail);server.listen(0, "127.0.0.1", done); });
  const port = server.address().port;
  const origin = `https://127.0.0.1:${port}`;
  const delivery = {
    repository, digest: packed.digest, transportDigest: packed.transportDigest,
    url: `${origin}/check.tgz`, tamperedURL: `${origin}/tampered.tgz`, missingURL: `${origin}/missing.tgz`,
    stopURL: `${origin}/stop/${stopToken}`, checkReference: manifest.references.check,
    expected: inspection.files.get("resources/expected.txt").toString("base64"),
    files: Object.fromEntries([...inspection.files].map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes) }])),
  };
  await writeFile(join(external, "delivery.json"), JSON.stringify(delivery));
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, pathToFileURL(tool.filename).href]));
  await writeFile(join(external, "package.json"), JSON.stringify({ name: "standalone-check-consumer", private: true, type: "module",
    dependencies: { "@potential-guide/check-artifacts": byName["@potential-guide/check-artifacts"], "@potential-guide/check-host": byName["@potential-guide/check-host"], "@potential-guide/effects": byName["@potential-guide/effects"] } }, null, 2));
  await writeFile(join(external, "pnpm-workspace.yaml"), `packages: []\noverrides: ${JSON.stringify(byName)}\n`);
  const installed = await pnpm(["install", "--offline", "--ignore-scripts", "--reporter=append-only"], external);
  await writeFile(join(external, "consumer.mjs"), consumerProgram);
  const consumed = await command(process.execPath, ["consumer.mjs"], external, {
    NODE_EXTRA_CA_CERTS: join(tls, "cert.pem"), NODE_TLS_REJECT_UNAUTHORIZED: "1",
  });
  const result = JSON.parse(await readFile(join(external, "consumer-results.json"), "utf8"));
  assert.ok(requests.some((entry) => entry.path === "/check.tgz"));
  assert.ok(requests.some((entry) => entry.path === "/tampered.tgz"));
  assert.ok(requests.some((entry) => entry.path === "/missing.tgz"));
  assert.equal(server.listening, false);
  output = {
    baseline: { primaryCommit: baseline, deploymentRevision, contractBlob },
    invocation, externalDirectory: external, operationOwnerVerified: true,
    environment: { node: process.version, platform: process.platform, pnpm: (await pnpm(["--version"])).stdout.trim() },
    tools, delivery: { ...delivery, stopURL: `${origin}/stop/<operation-token>` },
    install: { command: "pnpm install --offline --ignore-scripts --reporter=append-only", ...installed },
    consumerCommand: { command: "node consumer.mjs", cwd: external, NODE_PATH: "", NODE_OPTIONS: "", NODE_EXTRA_CA_CERTS: "<owned tls/cert.pem>", NODE_TLS_REJECT_UNAUTHORIZED: "1", ...consumed },
    requests, result,
    cleanup: { serverClosed: !server.listening, kernelClosed: result.cleanup.kernelClosed, permissionBackendClosed: result.cleanup.permissionBackendClosed },
  };
} finally {
  if (server) { server.closeAllConnections();if (server.listening) await new Promise((done) => server.close(() => done())); }
  if (author) await rm(author, { recursive: true, force: true });
  if (externalOwned) {
    assert.equal(await readFile(join(external, ".operation-owner"), "utf8"), marker);
    await rm(external, { recursive: true, force: true });
  }
}
assert.ok(output, "external verification did not finish");
await assert.rejects(lstat(external), { code: "ENOENT" });
output.cleanup.externalDirectoryRemoved = true;
output.cleanup.certificateAndKeyRemoved = true;
const destination = join(outer, "consumer-evidence.json");
await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ evidence: destination, deploymentRevision: output.baseline.deploymentRevision,
  digest: output.delivery.digest, scenarios: output.result.scenarios.length, executions: output.result.diagnostics.executions,
  cleaned: output.cleanup }, null, 2));
