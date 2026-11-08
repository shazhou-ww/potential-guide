import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkTaskServiceConsumer(root, directory, run) {
  await writeFile(
    join(directory, "echo-config.mjs"),
    await readFile(join(root, "examples", "task-server", "echo-config.mjs")),
  );
  await writeFile(
    join(directory, "verify-consumer.mjs"),
    await readFile(join(root, "examples", "task-server", "verify-consumer.mjs")),
  );
  await writeFile(
    join(directory, "service-consumer.mjs"),
    `
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {delimiter,dirname,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {MemoryIpfsClient} from "@potential-guide/task-engine/testing";
import {createIpfsGatewayClient} from "@potential-guide/task-engine";
import {buildTaskBundle} from "@potential-guide/pguide-task-bundle/build";
import {readTaskArtifact} from "@potential-guide/pguide-task-bundle/artifact";
import {configureTaskServer} from "./echo-config.mjs";
import {verifyConsumer} from "./verify-consumer.mjs";
const cli=resolve("node_modules/@potential-guide/pguide-task-engine/dist/main.js");
const pguide=resolve("node_modules/pguide/dist/bin.js");
const settings=JSON.parse(await readFile(resolve("node_modules/@potential-guide/pguide-task-engine/settings.json"),"utf8"));
assert.ok(settings.settings["task-engine.ipfsGatewayUrl"]);
assert.ok(settings.settings["task-engine.ipfsGatewayUrls"]);
assert.equal(settings.settings["task-engine.ipfsRpcUrl"],undefined);
assert.equal(settings.settings["task-engine.ipfsTransport"],undefined);
const home=resolve("home");
await mkdir(resolve(home,"pguide"),{recursive:true});
await writeFile(resolve(home,"pguide/config.jsonc"),"{broken");
await mkdir(".pguide");
await writeFile(".pguide/config.jsonc",'{"task-engine.port":"excluded"}');
const systemPaths=process.platform==="win32"?[join(process.env.SystemRoot??"C:\\\\Windows","System32")]:["/usr/bin","/bin"];
const env={...process.env,APPDATA:home,XDG_CONFIG_HOME:home,PATH:[resolve("node_modules/.bin"),dirname(process.execPath),...systemPaths].join(delimiter)};
await writeFile("signal-wrapper.mjs",'process.on("message",()=>process.emit("SIGTERM"));await import('+JSON.stringify(pathToFileURL(cli).href)+');');
const bounded=(p,label)=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error(label)),15000).unref())]);
await writeFile("task.yaml",JSON.stringify({
 $schema:"https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json",
 name:"Packed Gateway",runtime:{type:"node",minVersion:"22.13.0"},entry:"worker.cjs",binary:[],
 inputSchema:{type:"object"},resultSchema:true,messageSchema:false
}));
await writeFile("resource.bin",Buffer.alloc(600000,42));
await writeFile("callback.ts",'export default async(input,context)=>{let bytes=0,sum=0;for await(const chunk of context.bundle.read("resources/nested/value.bin")){bytes+=chunk.length;for(const byte of chunk)sum+=byte}if(bytes!==600000||sum!==25200000)throw Error("Nested Gateway resource mismatch.");return input;}');
const built=await buildTaskBundle({declaration:resolve("task.yaml"),entry:resolve("callback.ts"),binary:["resources/nested/value.bin"],resources:{"resources/nested/value.bin":resolve("resource.bin")},outDirectory:resolve("bundle")});
const memory=new MemoryIpfsClient();
assert.equal(await memory.import((await readTaskArtifact(built.car)).files),built.cid);
delete process.env.IPFS_GATEWAY;
await assert.rejects(configureTaskServer({token:"fixture"}),/Set IPFS_GATEWAY/);
assert.equal((await configureTaskServer({token:"fixture",ipfsClient:memory})).ipfsClient,memory);
let reads=0;
const gateway=createServer((request,response)=>{
 reads++;
 assert.equal(request.method,"GET");
 assert.equal(request.headers.accept,"application/vnd.ipld.raw");
 const url=new URL(request.url,"http://localhost");
 assert.match(url.pathname,/^\\/ipfs\\//);
 assert.equal(url.search,"?format=raw");
 const bytes=memory.blocks.get(url.pathname.split("/").at(-1));
 response.writeHead(bytes?200:404,{"content-type":"application/vnd.ipld.raw"});response.end(bytes);
});
gateway.listen(0,"127.0.0.1");await once(gateway,"listening");
const gatewayUrl="http://127.0.0.1:"+gateway.address().port;
let failedReads=0;
const failedGateway=createServer((request,response)=>{failedReads++;response.writeHead(503).end();});
failedGateway.listen(0,"127.0.0.1");await once(failedGateway,"listening");
const trustedGateways=["http://127.0.0.1:"+failedGateway.address().port,gatewayUrl];
try {
process.env.IPFS_GATEWAY=gatewayUrl;
assert.ok(await (await configureTaskServer({token:"fixture"})).ipfsClient.block.get(built.cid));
delete process.env.IPFS_GATEWAY;
assert.ok(await createIpfsGatewayClient(gatewayUrl).block.get(built.cid));
for(const combined of [false,true])for(const layer of ["user","file","cli","isolated"]){
 const database=(combined?"combined":"engine")+"-"+layer+".sqlite";
 await writeFile(resolve(home,"pguide/config.jsonc"),JSON.stringify(layer==="isolated"
  ?{"task-engine.ipfsTransport":"rpc","task-engine.ipfsRpcUrl":false}
  :{"task-engine.ipfsGatewayUrls":layer==="user"?trustedGateways:["http://127.0.0.1:1"]}));
 await writeFile("server.json",JSON.stringify(layer==="file"?{ipfsGatewayUrls:trustedGateways}
  :layer==="cli"?{ipfsGatewayUrl:"http://127.0.0.1:1"}:{}));
 const child=spawn(process.execPath,[combined?pguide:resolve("signal-wrapper.mjs"),...(combined?["task-engine"]:[]),
  ...(layer==="isolated"?["--no-global-config"]:[]),"--config","server.json","--port","0","--database",database,
  ...(["cli","isolated"].includes(layer)?["--ipfs-gateway-urls",JSON.stringify(trustedGateways)]:[]),
  ...(combined?["--ui","--ui-options",JSON.stringify({host:"127.0.0.1",port:0,favoritesFile:"favorites.json"})]:[])],
  {env,stdio:combined?["ignore","pipe","pipe"]:["ignore","pipe","pipe","ipc"],windowsHide:true});
 let text="",errors="",pid,stopped=false;
 const exited=new Promise(resolve=>child.once("exit",resolve));
 child.stderr.on("data",chunk=>errors+=chunk);
 try{
  const ready=await bounded(new Promise((done,reject)=>{
   child.once("error",reject);child.once("exit",(code,signal)=>reject(Error("Packed service exited "+code+" ("+signal+"): "+errors+"\\n"+text)));
   child.stdout.on("data",chunk=>{text+=chunk;for(const line of text.split("\\n")){try{const value=JSON.parse(line);if(value.event==="ready")done(value)}catch{}}});
  }),"packed service readiness timeout");
  pid=ready.pid;
  assert.equal((await fetch(ready.url+"/tasks")).status,200);
  assert.equal((await fetch(ready.url+"/tasks",{headers:{origin:"https://evil.test"}})).status,403);
  await readFile(database);
  const verified=await verifyConsumer(ready.url,{bundle:built.cid,input:{text:"packed"},expectedResult:{text:"packed"}});
  assert.equal(verified.bundle,built.cid);
  if(combined){
   assert.ok(ready.uiUrl);
   assert.match(await(await fetch(ready.uiUrl)).text(),/<html/);
   for(const asset of ["app.js","style.css"])assert.equal((await fetch(ready.uiUrl+"/"+asset)).status,200);
   process.kill(pid,"SIGTERM");
  }else{
   assert.equal(ready.uiUrl,undefined);child.send("stop");child.disconnect();
  }
  await bounded(exited,"packed service exit timeout");
  stopped=true;
  if(!combined)assert.match(text,/"event":"closed"/);
  await assert.rejects(fetch(ready.url+"/tasks"));
  if(combined)await assert.rejects(fetch(ready.uiUrl));
 }finally{
  if(pid&&!stopped)try{process.kill(pid,"SIGKILL")}catch{}
  if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");
  await bounded(exited,"packed invocation cleanup timeout");
 }
}
assert.ok(reads>4);
assert.ok(failedReads>4);
}finally{await Promise.all([new Promise(done=>gateway.close(done)),new Promise(done=>failedGateway.close(done))]);}
console.log("Packed task-service: both entries x user/file/CLI/disabled-user layers execute same-CID trusted Gateway failover; shared consumer verification; Engine/UI HTTP assets and owned exit cleanup; no RPC.");
`,
  );
  console.log(await run(process.execPath, ["service-consumer.mjs"], directory));
}
