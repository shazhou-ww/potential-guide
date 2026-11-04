import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function withoutAuthorDependencies(directory, consume) {
  const modules = join(directory, "node_modules");
  const isolated = join(directory, "author_modules");
  await rename(modules, isolated);
  try {
    return await consume();
  } finally {
    await rename(isolated, modules);
  }
}

export async function checkTaskSdkConsumer(directory, run) {
  const fixture = join(directory, "fixture");
  await mkdir(fixture);
  await writeFile(
    join(directory, "task-sdk-build.mjs"),
    `
import assert from "node:assert/strict";
import {rm,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {buildTaskBundle} from "@potential-guide/pguide-task-bundle/build";
import {importTaskBundle} from "@potential-guide/pguide-task-bundle/publish";
import {MemoryIpfsClient} from "@potential-guide/ipfs-content/testing";
import {resolveBundleSchemas,taskSchemaUri,validateTaskBundle} from "@potential-guide/task-protocol";
for(const subpath of ["build","artifact","publish"])
 await assert.rejects(import("@potential-guide/task-sdk/"+subpath),error=>error.code==="ERR_PACKAGE_PATH_NOT_EXPORTED");
const root=resolve("fixture");
const declaration={$schema:taskSchemaUri,name:"Packed echo",runtime:{type:"node",minVersion:"22.13.0"},entry:"worker.cjs",include:["task.yaml","worker.cjs"],inputSchema:{type:"object"},resultSchema:true,messageSchema:false};
assert.equal(validateTaskBundle(declaration).$schema,taskSchemaUri);
for(const version of ["v2","v3"])assert.throws(()=>validateTaskBundle({...declaration,$schema:taskSchemaUri.replace("v1",version)}),{code:"invalid_bundle"});
console.log("Packed Task schema validation: v1 accepted; removed v2 and future v3 rejected.");
await writeFile(join(root,"task.yaml"),JSON.stringify(declaration));
await writeFile(join(root,"callback.ts"),'export default async (input,context)=>{await context.log({level:"info",message:"Packed diagnostic."});await context.progress({stage:"execution",message:"Packed callback."});return input;}');
const built=await buildTaskBundle({declaration:join(root,"task.yaml"),entry:join(root,"callback.ts"),outDirectory:join(root,"bundle")});
const ipfsClient=new MemoryIpfsClient();
const published=await importTaskBundle(built.directory,ipfsClient);
assert.equal(published.cid,built.cid);
await writeFile(join(root,"blocks.json"),JSON.stringify([...ipfsClient.blocks].map(([cid,bytes])=>[cid,Buffer.from(bytes).toString("hex")])));
await writeFile(join(root,"binding.json"),JSON.stringify({cid:built.cid,declaration:resolveBundleSchemas(declaration,[])}));
await rm(join(root,"callback.ts"));
await rm(join(root,"task.yaml"));
`,
  );
  await writeFile(
    join(fixture, "dependency-control.mjs"),
    `
import {parentPort} from "node:worker_threads";
await import("@potential-guide/task-sdk");
parentPort.postMessage("dependency-visible");
`,
  );
  await writeFile(
    join(fixture, "control.mjs"),
    `
import assert from "node:assert/strict";
import {Worker} from "node:worker_threads";
let visible=false,error;
const worker=new Worker(new URL("./dependency-control.mjs",import.meta.url),{execArgv:[],env:{NODE_OPTIONS:"",NODE_PATH:""}});
try {
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("Dependency control timed out.")),10000);
  worker.on("message",value=>{visible=value==="dependency-visible"});
  worker.once("error",value=>{error=value});
  worker.once("exit",()=>{clearTimeout(timer);resolve()});
 });
}finally{await worker.terminate()}
if(process.argv[2]==="visible"){assert.equal(visible,true);assert.equal(error,undefined)}
else{assert.equal(visible,false);assert.equal(error?.code,"ERR_MODULE_NOT_FOUND");assert.match(error.message,/@potential-guide\\/task-sdk/)}
console.log("Dependency control: "+process.argv[2]);
`,
  );
  await writeFile(
    join(fixture, "consume.mjs"),
    `
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Worker} from "node:worker_threads";
for(const name of ["@potential-guide/task-sdk","@potential-guide/check-task","@potential-guide/probe-task"]){
 assert.throws(()=>import.meta.resolve(name),{code:"ERR_MODULE_NOT_FOUND"});
 await assert.rejects(import(name),error=>error.code==="ERR_MODULE_NOT_FOUND");
}
const bundle=JSON.parse(await readFile(new URL("./binding.json",import.meta.url),"utf8"));
const generation="packed-production-consumer";
const worker=new Worker(new URL("./bundle/worker.cjs",import.meta.url),{execArgv:[],env:{NODE_OPTIONS:"",NODE_PATH:""},workerData:{generation,maxInFlight:8,maxPayloadBytes:65536,bundle}});
let complete=false,logs=0;
try{
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error("Packed Worker timed out.")),10000);
 worker.once("error",reject);
 worker.on("message",message=>{
  try{
   assert.equal(message.generation,generation);
   if(message.kind==="ready"){assert.equal(message.value.$schema,"https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json");assert.equal(message.value.cid,bundle.cid);worker.postMessage({generation,kind:"run",runId:"packed",scope:"consumer",input:{text:"self-contained"}});}
   else if(message.kind==="log"){assert.equal(message.value.message,"Packed diagnostic.");logs++;worker.postMessage({generation,runId:"packed",kind:"log-ack",logId:message.logId,value:{state:"stored",sequence:logs}});}
   else if(message.id!==undefined){
    if(message.kind==="complete"){assert.deepEqual(message.value,{text:"self-contained"});complete=true;}
    assert.notEqual(message.kind,"failed");
    worker.postMessage({generation,kind:"ack",id:message.id});
   }else if(message.kind==="released"){assert.ok(complete);assert.equal(logs,1);clearTimeout(timer);resolve();}
   else if(message.kind==="uncertain")throw new Error("Uncertain cleanup.");
  }catch(error){clearTimeout(timer);reject(error);}
 });
});
}finally{await worker.terminate();}
console.log("Packed Task Worker completed without node_modules.");
`,
  );

  // run() resolves on child close, not readiness or a build-complete message.
  console.log(await run(process.execPath, ["task-sdk-build.mjs"], directory));
  const control = join(fixture, "control.mjs");
  console.log(await run(process.execPath, [control, "visible"], directory));
  await withoutAuthorDependencies(directory, async () => {
    console.log(await run(process.execPath, [control, "missing"], directory));
    const consumed = await run(process.execPath, [join(fixture, "consume.mjs")], directory);
    assert.match(consumed, /without node_modules/);
    console.log(consumed);
  });
  console.log(
    "Task SDK author process exited; isolated dependency controls and standalone Worker verified.",
  );
}
