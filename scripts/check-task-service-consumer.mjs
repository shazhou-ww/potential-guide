import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkTaskServiceConsumer(directory, run) {
  await writeFile(
    join(directory, "service-consumer.mjs"),
    `
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {delimiter,resolve} from "node:path";
import {pathToFileURL} from "node:url";
const cli=resolve("node_modules/@potential-guide/pguide-task-engine/dist/main.js");
const pguide=resolve("node_modules/pguide/dist/bin.js");
const home=resolve("home");
await mkdir(resolve(home,"pguide"),{recursive:true});
await writeFile(resolve(home,"pguide/config.jsonc"),"{broken");
await mkdir(".pguide");
await writeFile(".pguide/config.jsonc",'{"task-engine.port":"excluded"}');
const env={...process.env,APPDATA:home,XDG_CONFIG_HOME:home,PATH:resolve("node_modules/.bin")+delimiter+process.env.PATH};
await writeFile("signal-wrapper.mjs",'process.on("message",()=>process.emit("SIGTERM"));await import('+JSON.stringify(pathToFileURL(cli).href)+');');
const bounded=(p,label)=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error(label)),15000).unref())]);
for(const combined of [false,true]){
 const child=spawn(process.execPath,[combined?pguide:resolve("signal-wrapper.mjs"),...(combined?["task-engine"]:[]),
  "--no-global-config","--port","0","--database",combined?"combined.sqlite":"engine.sqlite",
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
  await readFile(combined?"combined.sqlite":"engine.sqlite");
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
console.log("Packed task-service: independent and discovered CLI, isolated config, Engine/UI HTTP assets, exit cleanup.");
`,
  );
  console.log(await run(process.execPath, ["service-consumer.mjs"], directory));
}
