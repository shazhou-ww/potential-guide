import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
      "@potential-guide/pguide-task-bundle",
      "@potential-guide/task-engine",
      "@potential-guide/task-sdk",
      "@potential-guide/check-task",
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
        "@potential-guide/ipfs-content",
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
import {MemoryIpfsClient} from "@potential-guide/task-engine/testing";
import {readFile} from "node:fs/promises";
const content=new MemoryIpfsClient();
let loading;
const ipfsClient={block:{async get(cid,options){
 loading??=readFile(${JSON.stringify(join(artifacts, "blocks.json"))},"utf8").then(text=>{
 for(const [key,hex] of JSON.parse(text))content.blocks.set(key,Buffer.from(hex,"hex"));
 });
 await loading;return content.block.get(cid,options);
}}};
const server=await startTaskServer({port:0,database:"domain-v5.sqlite",ipfsClient,
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
import {writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {buildTaskBundle} from "@potential-guide/pguide-task-bundle/build";
import {readTaskArtifact} from "@potential-guide/pguide-task-bundle/artifact";
import {MemoryIpfsClient} from "@potential-guide/task-engine/testing";
import {writeContractArtifact,packContractArtifact} from "@potential-guide/check-artifacts/build";
import {checkerSchemaUri} from "@potential-guide/check-artifacts/contracts";
import {checkInputSchema,createCheckTaskType} from "@potential-guide/check-task";
const root=${JSON.stringify(artifacts)};
const page=Buffer.from(${JSON.stringify("---\ntitle: Packed\ndescription: Independent Bundle\n---\nBody\n")});
const checker=await writeContractArtifact(new Map([
["checker.yaml",Buffer.from(JSON.stringify({$schema:checkerSchemaUri,runtime:{type:"node",minVersion:"22.13.0"},entry:"checker.cjs",subjectSchema:{type:"object"},languages:["en"],problems:["bad"]}))],
["checker.cjs",Buffer.from("exports.execute=async(subject,context)=>{context.progress({step:1});return {status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'bad',parameters:{reason:'observed gap'}}]}}};")],
["references/en/checker.md",page],["references/en/problems/bad.md",page]]),join(root,"checker"));
await packContractArtifact(checker.directory,join(root,"checker.tgz"));
const check=createCheckTaskType({source:{authorize(){},async resolve(){throw Error("Author schema extraction performs no business IO.")}},directory:"unused"});
const yaml=resolve("check-task.yaml"),entry=resolve("check-task.ts");
await writeFile(yaml,JSON.stringify({$schema:"https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json",name:"Shared display name",runtime:{type:"node",minVersion:"22.13.0"},entry:"worker.cjs",inputSchema:checkInputSchema,resultSchema:check.resultSchema,messageSchema:false}));
await writeFile(entry,\`
import {resolve} from "node:path";
import {createArtifactSource,createCheckTaskType} from "@potential-guide/check-task";
const createSource=context=>createArtifactSource({allowedOrigins:["https://example.test"],authorize(_reference,scope){if(scope!=="consumer")throw Error("Scope mismatch.")},async download(url){if(new URL(url).pathname!=="/checker.tgz")throw Error("Unknown controlled resource.");const chunks=[];for await(const chunk of context.bundle.read("resources/checker.tgz"))chunks.push(chunk);return Buffer.concat(chunks);}});
export default(input,context)=>createCheckTaskType({source:createSource(context),directory:resolve("business-workers"),wallMs:10000}).run(input,context);\`);
const built=await buildTaskBundle({declaration:yaml,entry,resources:{"resources/checker.tgz":join(root,"checker.tgz")},outDirectory:join(root,"check-task")});
const ipfsClient=new MemoryIpfsClient();
const checkBundle=await ipfsClient.import((await readTaskArtifact(built.car)).files);
await writeFile(join(root,"references.json"),JSON.stringify({checkBundle,checkerDigest:checker.digest}));
await writeFile(join(root,"blocks.json"),JSON.stringify([...ipfsClient.blocks].map(([cid,bytes])=>[cid,Buffer.from(bytes).toString("hex")])));
`,
    );
    console.log(await run(process.execPath, [join(author, "build.mjs")], author));
    for (const name of ["check-task.ts", "check-task.yaml"]) await rm(join(author, name));
    // Windows may briefly retain directory handles after the author process exits.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(join(author, "node_modules"), join(author, "author_modules"));
        break;
      } catch (error) {
        if (
          process.platform !== "win32" ||
          !["EACCES", "EBUSY", "EPERM"].includes(error.code) ||
          attempt >= 5
        )
          throw error;
        await delay(100 * (attempt + 1));
      }
    }
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
const request={requestId:newId(),timeoutMs:30000,bundle:refs.checkBundle,checker:{kind:"checker",url:"https://example.test/checker.tgz",digest:refs.checkerDigest},subject:{}};
let decision=await client.submit(request);
while(decision.status==="preparing")decision=await client.getRequestStatus(request.requestId,{waitMs:1000});
assert.equal(decision.status,"accepted",JSON.stringify(decision));
let check;
for(let i=0;i<2000;i++){
 const task=await client.getTask(decision.taskId);
 if(task.termination){assert.equal(task.stage,"completed",JSON.stringify(task.error));check=task;break;}
 await new Promise(resolve=>setTimeout(resolve,10));
}
assert.ok(check,"Business Bundle timed out.");
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
console.log("Independent production host: self-contained Check Bundle, actual negative business result and evidence verified; author node_modules unavailable.");
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
