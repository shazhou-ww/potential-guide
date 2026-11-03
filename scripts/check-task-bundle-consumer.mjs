import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { consumerVersions, verifyConsumerGraph } from "./deployment-consumer.mjs";

/** Separate author install and business-free production host; no in-process business ports. */
export async function checkTaskBundleConsumer(scratch, tarballs, manifests, run) {
  const author = join(scratch, "bundle-author");
  const runtime = join(scratch, "bundle-runtime");
  const artifacts = join(scratch, "task-bundles");
  await mkdir(artifacts);
  const entries = {
    author: [
      "@potential-guide/task-sdk",
      "@potential-guide/check-task",
      "@potential-guide/probe-task",
      "@potential-guide/check-artifacts",
      "@potential-guide/task-engine-http",
    ],
    runtime: [
      "@potential-guide/task-engine-server",
      "@potential-guide/task-engine",
      "@potential-guide/task-engine-http",
      "@potential-guide/task-protocol",
    ],
  };
  for (const [label, directory] of [
    ["author", author],
    ["runtime", runtime],
  ]) {
    await mkdir(directory);
    await writeFile(
      join(directory, "pnpm-workspace.yaml"),
      `packages: []\noverrides: ${JSON.stringify(Object.fromEntries([...tarballs].map(([name, path]) => [name, pathToFileURL(path).href])))}\n`,
    );
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: Object.fromEntries(
          entries[label].map((name) => [name, pathToFileURL(tarballs.get(name)).href]),
        ),
      }),
    );
    await run(
      "pnpm",
      [
        "install",
        "--prod",
        "--prefer-offline",
        "--ignore-scripts",
        "--no-frozen-lockfile",
        "--reporter=append-only",
      ],
      directory,
    );
    const graph = await verifyConsumerGraph(
      directory,
      consumerVersions(manifests, entries[label]),
      entries[label],
      true,
    );
    if (label === "runtime") {
      const names = new Set(graph.map((entry) => entry.name));
      for (const forbidden of [
        "@potential-guide/check-task",
        "@potential-guide/probe-task",
        "@potential-guide/task-sdk",
        "@potential-guide/checker-host",
        "@potential-guide/objective-host",
      ])
        assert.ok(!names.has(forbidden), `Production host unexpectedly installs ${forbidden}.`);
    }
  }
  const token = randomUUID();
  await writeFile(
    join(runtime, "server.mjs"),
    `
import {startTaskServer} from "@potential-guide/task-engine-server";
import {TaskError} from "@potential-guide/task-protocol";
const server=await startTaskServer({port:0,database:"domain-v5.sqlite",bundleDirectory:"cache",
limits:{maxPayloadBytes:100663296,queryPageBytes:100663296,sourceEnvelopeBytes:100663296,maxQueryBytes:536870912},
authorize:()=>true,resolveCaller(request){if(request.headers.get("authorization")!==${JSON.stringify(`Bearer ${token}`)})throw new TaskError("unauthenticated","Token required.");return {scope:"consumer",subject:"consumer"}}});
process.send({type:"ready",url:server.url});
process.on("message",async message=>{if(message==="close"){try{await server.close();process.send({type:"closed"});process.disconnect()}catch(error){console.error(error);process.exit(2)}}});
`,
  );
  const child = spawn(process.execPath, [join(runtime, "server.mjs")], {
    cwd: runtime,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  let diagnostics = "";
  child.stderr.on("data", (chunk) => {
    diagnostics += chunk;
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Runtime startup timed out: ${diagnostics}`)),
      15000,
    );
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Runtime exited ${code}: ${diagnostics}`)));
    child.on("message", (value) => {
      if (value.type === "ready") {
        clearTimeout(timer);
        resolve(value);
      }
    });
  });
  try {
    await writeFile(
      join(author, "build.mjs"),
      `
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {buildTaskBundle,packTaskBundle} from "@potential-guide/task-sdk/build";
import {writeContractArtifact,packContractArtifact} from "@potential-guide/check-artifacts/build";
import {checkerSchemaUri,objectiveSchemaUri} from "@potential-guide/check-artifacts/contracts";
import {checkInputSchema,createCheckTaskType} from "@potential-guide/check-task";
import {probeInputSchema,createProbeTaskType} from "@potential-guide/probe-task";
const root=${JSON.stringify(artifacts)};
const page=Buffer.from(${JSON.stringify("---\ntitle: Packed\ndescription: Independent Bundle\n---\nBody\n")});
const checker=await writeContractArtifact(new Map([
["checker.yaml",Buffer.from(JSON.stringify({$schema:checkerSchemaUri,runtime:{type:"node",minVersion:"22.13.0"},entry:"checker.cjs",subjectSchema:{type:"object"},languages:["en"],problems:["bad"]}))],
["checker.cjs",Buffer.from("exports.execute=async(subject,context)=>{context.progress({step:1});return {status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'bad',parameters:{reason:'observed gap'}}]}}};")],
["references/en/checker.md",page],["references/en/problems/bad.md",page]]),join(root,"checker"));
const objective=await writeContractArtifact(new Map([
["objective.yaml",Buffer.from(JSON.stringify({$schema:objectiveSchemaUri,subjectSchema:{type:"object"},languages:["en"],levels:[{id:"ready",checks:["check"]}],checkers:{check:{url:"https://example.test/checker.tgz",digest:checker.digest,subjectMapping:"$"}}}))],
["references/en/objective.md",page],["references/en/levels/ready.md",page]]),join(root,"objective"));
await packContractArtifact(checker.directory,join(root,"checker.tgz"));
await packContractArtifact(objective.directory,join(root,"objective.tgz"));
const sourceCode=\`import {readFile} from "node:fs/promises";
import {createArtifactSource} from "@potential-guide/check-task";
const source=createArtifactSource({allowedOrigins:["https://example.test"],authorize(_reference,scope){if(scope!=="consumer")throw new Error("Scope mismatch.")},download(url){const path=new URL(url).pathname;if(!["/checker.tgz","/objective.tgz"].includes(path))throw new Error("Unknown controlled resource.");return readFile(new URL("./resources"+path,import.meta.url));}});\`;
const nullSource={authorize(){},async resolve(){throw Error("Author schema extraction performs no business IO.")}};
const check=createCheckTaskType({source:nullSource,directory:"unused"});
async function bundle(kind,inputSchema,resultSchema,callback,resources){
 const yaml=resolve(kind+".yaml"),entry=resolve(kind+".ts");
 await writeFile(yaml,JSON.stringify({$schema:"https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json",name:"Shared display name",runtime:{type:"node",minVersion:"22.13.0"},entry:"worker.cjs",inputSchema,resultSchema,messageSchema:false}));
 await writeFile(entry,callback);
 const built=await buildTaskBundle({declaration:yaml,entry,resources,outDirectory:join(root,kind)});
 const packed=await packTaskBundle(built.directory,join(root,kind+".tar.gz"));
 return {url:pathToFileURL(packed.archive).href,digest:built.digest};
}
const checkBundle=await bundle("check-task",checkInputSchema,check.resultSchema,sourceCode+\`
import {resolve} from "node:path";
import {createCheckTaskType} from "@potential-guide/check-task";
const type=createCheckTaskType({source,directory:resolve("business-workers"),wallMs:10000});
export default (input,context)=>type.run(input,context);\`,{"resources/checker.tgz":join(root,"checker.tgz")});
const probe=createProbeTaskType({source:nullSource,checkEnvironment:checkBundle.digest,checkBundle,children(){throw Error("Authoring does not create child tasks.")}});
const probeBundle=await bundle("probe-task",probeInputSchema,probe.resultSchema,sourceCode+\`
import {createProbeTaskType} from "@potential-guide/probe-task";
import {TaskClient} from "@potential-guide/task-engine-http";
const checkBundle={url:new URL("./resources/check-task.tar.gz",import.meta.url).href,digest:\`+JSON.stringify(checkBundle.digest)+\`};
const client=new TaskClient({url:\`+JSON.stringify(${JSON.stringify(ready.url)})+\`,headers:{Authorization:\`+JSON.stringify(${JSON.stringify(`Bearer ${token}`)})+\`}});
const type=createProbeTaskType({source,checkBundle,checkEnvironment:checkBundle.digest,wallMs:20000,children(scope){return {service:client,caller:{scope,subject:"consumer"},waitForTaskRelease:(id)=>client.waitForTaskRelease(id)}}});
export default (input,context)=>type.run(input,context);\`,{"resources/checker.tgz":join(root,"checker.tgz"),"resources/objective.tgz":join(root,"objective.tgz"),"resources/check-task.tar.gz":join(root,"check-task.tar.gz")});
await writeFile(join(root,"references.json"),JSON.stringify({checkBundle,probeBundle,checkerDigest:checker.digest,objectiveDigest:objective.digest}));
`,
    );
    console.log(await run(process.execPath, [join(author, "build.mjs")], author));
    for (const name of ["check-task.ts", "probe-task.ts", "check-task.yaml", "probe-task.yaml"])
      await rm(join(author, name));
    await rename(join(author, "node_modules"), join(author, "author_modules"));
    await writeFile(
      join(runtime, "consume.mjs"),
      `
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {TaskClient} from "@potential-guide/task-engine-http";
import {newId} from "@potential-guide/task-engine";
const require=createRequire(import.meta.url);
for(const name of ["@potential-guide/check-task","@potential-guide/probe-task","@potential-guide/task-sdk"])
assert.throws(()=>require.resolve(name),{code:"MODULE_NOT_FOUND"});
const refs=JSON.parse(await readFile(${JSON.stringify(join(artifacts, "references.json"))},"utf8"));
const client=new TaskClient({url:${JSON.stringify(ready.url)},headers:{Authorization:${JSON.stringify(`Bearer ${token}`)}}});
async function execute(parameters){
 const request={requestId:newId(),timeoutMs:30000,...parameters};
 let result=await client.submit(request);
 while(result.status==="preparing")result=await client.getRequestStatus(request.requestId,{waitMs:1000});
 assert.equal(result.status,"accepted",JSON.stringify(result));
 for(let i=0;i<2000;i++){
  const task=await client.getTask(result.taskId);
  if(task.termination){assert.equal(task.stage,"completed",JSON.stringify(task.error));return task;}
  await new Promise(resolve=>setTimeout(resolve,10));
 }throw Error("Business Bundle timed out.");
}
const check=await execute({bundle:refs.checkBundle,checker:{kind:"checker",url:"https://example.test/checker.tgz",digest:refs.checkerDigest},subject:{}});
assert.equal(check.result.result.ok,false);
assert.equal(check.result.result.problems[0].id,"bad");
assert.equal(check.result.evidence.prepared.checker.digest,refs.checkerDigest);
assert.ok(check.result.evidence.execution.executionId);
const checkLogs=await client.getRunLogs(check.run.runId);
assert.equal(checkLogs.state.availability,"available");
assert.ok(checkLogs.entries.some(entry=>entry.level==="warn"&&entry.fields.problemId==="bad"));
assert.ok(checkLogs.entries.every(entry=>entry.runId===check.run.runId));
assert.equal((await client.getRunHistory(check.run.runId)).events.some(event=>event.type.includes("log")),false);
let replayed=0;
for await(const page of client.subscribeRunLogs(check.run.runId)){replayed+=page.entries.length;assert.equal(page.runId,check.run.runId);}
assert.equal(replayed,checkLogs.entries.length);
console.log("Packed v1 Check diagnostics: HTTP history and realtime replay verified; Result/evidence unchanged.");
const probe=await execute({bundle:refs.probeBundle,objective:{kind:"objective",url:"https://example.test/objective.tgz",digest:refs.objectiveDigest},subject:{}});
assert.equal(probe.result.observation.current.levelId,"initial");
assert.equal(probe.result.observation.problems[0].problem.id,"bad");
assert.equal(probe.result.observation.problems[0].checker,"check");
assert.equal(probe.result.observation.problems[0].objective.digest,refs.objectiveDigest);
const child=probe.result.evidence.operations.find(entry=>"snapshot" in entry);
assert.ok(child);
assert.equal(child.request.reference.digest,refs.checkerDigest);
assert.equal(child.snapshot.result.evidence.prepared.checker.digest,refs.checkerDigest);
assert.equal(child.environment,refs.checkBundle.digest);
const run=await client.getRun(probe.run.runId);
assert.equal(run.bundle.digest,refs.probeBundle.digest);
console.log("Independent production host: self-contained Check/Probe Bundles, actual negative business results and evidence verified; author node_modules unavailable.");
`,
    );
    console.log(await run(process.execPath, [join(runtime, "consume.mjs")], runtime));
  } finally {
    if (child.connected) child.send("close");
    const ended = await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 15000)),
    ]);
    if (!ended) {
      child.kill();
      await exited;
    }
  }
  assert.equal(child.exitCode, 0, `Production runtime shutdown failed: ${diagnostics}`);
}
