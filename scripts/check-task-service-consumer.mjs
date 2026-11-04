import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkTaskServiceConsumer(root, directory, run) {
  await writeFile(
    join(directory, "echo-config.mjs"),
    await readFile(join(root, "examples", "task-server", "echo-config.mjs")),
  );
  await writeFile(
    join(directory, "service-consumer.mjs"),
    `
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {delimiter,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {MemoryIpfsClient} from "@potential-guide/ipfs-content/testing";
import {createIpfsGatewayClient,openContent} from "@potential-guide/ipfs-content";
import {buildTaskBundle} from "@potential-guide/pguide-task-bundle/build";
import {importTaskBundle} from "@potential-guide/pguide-task-bundle/publish";
import {configureTaskServer} from "./echo-config.mjs";
const cli=resolve("node_modules/@potential-guide/pguide-task-engine/dist/main.js");
const pguide=resolve("node_modules/pguide/dist/bin.js");
const settings=JSON.parse(await readFile(resolve("node_modules/@potential-guide/pguide-task-engine/settings.json"),"utf8"));
assert.ok(settings.settings["task-engine.ipfsGatewayUrl"]);
assert.equal(settings.settings["task-engine.ipfsRpcUrl"],undefined);
assert.equal(settings.settings["task-engine.ipfsTransport"],undefined);
const home=resolve("home");
await mkdir(resolve(home,"pguide"),{recursive:true});
await writeFile(resolve(home,"pguide/config.jsonc"),"{broken");
await mkdir(".pguide");
await writeFile(".pguide/config.jsonc",'{"task-engine.port":"excluded"}');
const env={...process.env,APPDATA:home,XDG_CONFIG_HOME:home,PATH:resolve("node_modules/.bin")+delimiter+process.env.PATH};
await writeFile("signal-wrapper.mjs",'process.on("message",()=>process.emit("SIGTERM"));await import('+JSON.stringify(pathToFileURL(cli).href)+');');
const bounded=(p,label)=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error(label)),15000).unref())]);
await writeFile("task.yaml",JSON.stringify({
 $schema:"https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json",
 name:"Packed Gateway",runtime:{type:"node",minVersion:"22.13.0"},entry:"worker.cjs",
 inputSchema:{type:"object"},resultSchema:true,messageSchema:false
}));
await writeFile("callback.ts","export default async input=>input;");
const built=await buildTaskBundle({declaration:resolve("task.yaml"),entry:resolve("callback.ts"),outDirectory:resolve("bundle")});
const memory=new MemoryIpfsClient();
await importTaskBundle(built.directory,memory);
assert.ok(memory.pins.has(built.cid));
delete process.env.IPFS_GATEWAY;
await assert.rejects(configureTaskServer({token:"fixture"}),/Set IPFS_GATEWAY/);
assert.equal((await configureTaskServer({token:"fixture",ipfsClient:memory})).ipfsClient,memory);
let reads=0;
const gateway=createServer((request,response)=>{
 reads++;
 assert.equal(request.method,"GET");
 assert.equal(request.headers.accept,"application/vnd.ipld.raw");
 const url=new URL(request.url,"http://localhost");
 assert.match(url.pathname,/^\\/base\\/ipfs\\//);
 assert.equal(url.search,"?format=raw");
 const bytes=memory.blocks.get(url.pathname.split("/").at(-1));
 response.writeHead(bytes?200:404,{"content-type":"application/vnd.ipld.raw"});response.end(bytes);
});
gateway.listen(0,"127.0.0.1");await once(gateway,"listening");
const gatewayUrl="http://127.0.0.1:"+gateway.address().port+"/base";
try {
process.env.IPFS_GATEWAY=gatewayUrl;
assert.ok(await openContent((await configureTaskServer({token:"fixture"})).ipfsClient,built.cid,{signal:new AbortController().signal}));
delete process.env.IPFS_GATEWAY;
assert.ok(await openContent(createIpfsGatewayClient(gatewayUrl),built.cid,{signal:new AbortController().signal}));
for(const combined of [false,true])for(const layer of ["user","file","cli","isolated"]){
 const database=(combined?"combined":"engine")+"-"+layer+".sqlite";
 await writeFile(resolve(home,"pguide/config.jsonc"),JSON.stringify(layer==="isolated"
  ?{"task-engine.ipfsTransport":"rpc","task-engine.ipfsRpcUrl":false}
  :{"task-engine.ipfsGatewayUrl":layer==="user"?gatewayUrl:gatewayUrl+"/unused-user"}));
 await writeFile("server.json",JSON.stringify(layer==="file"?{ipfsGatewayUrl:gatewayUrl}
  :layer==="cli"?{ipfsGatewayUrl:gatewayUrl+"/unused-file"}:{}));
 const child=spawn(process.execPath,[combined?pguide:resolve("signal-wrapper.mjs"),...(combined?["task-engine"]:[]),
  ...(layer==="isolated"?["--no-global-config"]:[]),"--config","server.json","--port","0","--database",database,
  ...(["cli","isolated"].includes(layer)?["--ipfs-gateway-url",gatewayUrl]:[]),
  ...(combined?["--ui","--ui-options",JSON.stringify({host:"127.0.0.1",port:0,favoritesFile:"favorites.json"})]:[])],
  {env,stdio:combined?["ignore","pipe","pipe"]:["ignore","pipe","pipe","ipc"],windowsHide:true});
 let text="",errors="",pid,stopped=false;
 const exited=new Promise(resolve=>child.once("exit",resolve));
 child.stderr.on("data",chunk=>errors+=chunk);
 try{
  const ready=await bounded(new Promise((done,reject)=>{
   child.once("error",reject);child.once("exit",()=>reject(Error(errors)));
   child.stdout.on("data",chunk=>{text+=chunk;for(const line of text.split("\\n")){try{const value=JSON.parse(line);if(value.event==="ready")done(value)}catch{}}});
  }),"packed service readiness timeout");
  pid=ready.pid;
  assert.equal((await fetch(ready.url+"/tasks")).status,200);
  assert.equal((await fetch(ready.url+"/tasks",{headers:{origin:"https://evil.test"}})).status,403);
  await readFile(database);
  const requestId="01M6GRRES5EBHYDP1G9DZEGE8E";
  const submitted=await fetch(ready.url+"/tasks",{method:"POST",
   headers:{"content-type":"application/json","Idempotency-Key":requestId},
   body:JSON.stringify({bundle:built.cid,text:"packed",timeoutMs:10000})});
  assert.equal(submitted.status,202,await submitted.text());
  const status=await(await fetch(ready.url+"/requests/"+requestId+"/status?waitMs=10000")).json();
  assert.equal(status.status,"accepted",JSON.stringify(status));
  const deadline=Date.now()+15000;
  for(;;){
   const task=await(await fetch(ready.url+"/tasks/"+status.taskId)).json();
   if(task.stage==="completed"){assert.deepEqual(task.result,{text:"packed"});break;}
   assert.ok(Date.now()<deadline,JSON.stringify(task));
   await new Promise(done=>setTimeout(done,10));
  }
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
}finally{await new Promise(done=>gateway.close(done));}
console.log("Packed task-service: both entries x user/file/CLI/disabled-user layers execute Gateway-only Bundles; Engine/UI HTTP assets, owned exit cleanup; no RPC.");
`,
  );
  console.log(await run(process.execPath, ["service-consumer.mjs"], directory));
}
