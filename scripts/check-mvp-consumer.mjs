import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export async function checkMvpConsumer(root, directory, label, graph, run) {
  const names = new Set(graph.map((entry) => entry.name));
  assert.ok(!names.has("@potential-guide/checker-host"));
  assert.ok(!names.has("@potential-guide/objective-host"));
  if (label === "mvp-server") {
    assert.ok(!names.has("@potential-guide/check-artifacts"));
    assert.ok(!names.has("@potential-guide/check-task"));
  } else {
    assert.ok(names.has("esbuild"), "A subpath is not installation dependency isolation.");
    assert.ok(names.has("tar"));
  }
  await writeFile(join(directory, "dependency-graph.json"), JSON.stringify(graph, null, 2));
  if (process.env.PGUIDE_MVP_EVIDENCE_DIRECTORY) {
    const output = resolve(root, process.env.PGUIDE_MVP_EVIDENCE_DIRECTORY);
    const location = relative(root, output);
    assert.ok(
      location && !isAbsolute(location) && location !== ".." && !location.startsWith(`..${sep}`),
    );
    const identities = new Map(
      graph.map((entry) => [entry.manifest, `${entry.name}@${entry.version}`]),
    );
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, `${label}.json`),
      `${JSON.stringify(
        {
          consumer: label,
          source: "packed-production-install-traversal-v1",
          entries: Object.keys(manifest.dependencies),
          install: [
            "pnpm",
            "install",
            "--prefer-offline",
            "--ignore-scripts",
            "--no-frozen-lockfile",
          ],
          platform: process.platform,
          architecture: process.arch,
          node: process.versions.node,
          packages: graph.map(({ reference, name, version, from }) => ({
            reference,
            name,
            version,
            firstReachedFrom: identities.get(from) ?? "consumer",
          })),
        },
        null,
        2,
      )}\n`,
    );
  }
  if (label === "artifact-contracts") {
    await writeFile(
      join(directory, "pure.mjs"),
      `
import assert from "node:assert/strict";
import {createRequire,syncBuiltinESMExports} from "node:module";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const require=createRequire(import.meta.url);
const denied=()=>{throw Error("forbidden contract side effect")};
for(const [module,names] of [
 ["node:fs",["writeFile","writeFileSync","mkdir","mkdirSync","createWriteStream"]],
 ["node:fs/promises",["writeFile","mkdir","rename","unlink"]],
 ["node:worker_threads",["Worker"]],["node:net",["connect","createConnection"]],
 ["node:http",["request","get","createServer"]],["node:https",["request","get"]],
 ["node:child_process",["spawn","fork","exec","execFile"]]]) {
 const object=require(module);for(const name of names)object[name]=denied;
}
globalThis.fetch=denied;syncBuiltinESMExports();
const c=await import("@potential-guide/check-artifacts/contracts");
const local={kind:"checker",url:pathToFileURL(resolve("not-required-to-exist.tgz")).href};
assert.deepEqual(c.parseArtifactReference(c.formatArtifactReference(local)),local);
assert.equal(c.parseFileArtifactUrl(local.url),resolve("not-required-to-exist.tgz"));
assert.throws(()=>c.validateArtifactReference({...local,kind:"objective"}));
const page=Buffer.from("---\\ntitle: Packed\\ndescription: Packed\\n---\\nBody\\n");
const manifest={$schema:c.checkerSchemaUri,runtime:{type:"node",minVersion:"22.13.0"},entry:"checker.cjs",subjectSchema:{type:"object"},languages:["en"],problems:[]};
const bytes=Buffer.from(JSON.stringify(manifest));
const parsed=c.parseCheckerManifest(bytes);
const files=new Map([["checker.yaml",bytes],["checker.cjs",Buffer.from("exports.execute=()=>{}")],["references/en/checker.md",page]]);
assert.equal(c.inspectContractFiles(files).digest,c.gitTreeDigest(files));
assert.ok(c.validateArtifactSubject(parsed,c.mapSubject("$",{})));
assert.equal(c.parseCheckerResult({status:200,message:"",payload:{ok:true,problems:[]}},parsed).ok,true);
c.assertRuntime(parsed,{type:"node",version:process.versions.node});
const objective={$schema:c.objectiveSchemaUri,subjectSchema:{type:"object"},languages:["en"],levels:[{id:"ready",checks:["check"]}],checkers:{check:{url:"https://example.test/a",digest:c.gitTreeDigest(files),subjectMapping:"$"}}};
const objectiveBytes=Buffer.from(JSON.stringify(objective));
c.parseObjectiveArtifactManifest(objectiveBytes);
c.inspectContractFiles(new Map([["objective.yaml",objectiveBytes],["references/en/objective.md",page],["references/en/levels/ready.md",page]]));
console.log("pure-packed: checker/objective manifests, full files, References, digest, subject/result; zero IO");
`,
    );
    console.log(await run(process.execPath, ["pure.mjs"], directory));
  } else {
    await writeFile(
      join(directory, "echo-config.mjs"),
      await readFile(join(root, "examples", "task-server", "echo-config.mjs")),
    );
    await writeFile(
      join(directory, "echo-type.mjs"),
      await readFile(join(root, "examples", "task-server", "echo-type.mjs")),
    );
    if (label === "mvp-check") {
      await writeFile(
        join(directory, "check-config.mjs"),
        `
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createArtifactSource,createCheckTaskType} from "@potential-guide/check-task";
import {TaskError} from "@potential-guide/task-protocol";
export default function configure(){
 const source=createArtifactSource({allowedOrigins:["https://example.test"],allowedFileRoots:[resolve("imports")],authorize(_r,scope){if(scope!=="example")throw Error("denied")},download:()=>readFile("checker.tgz")});
 const check=createCheckTaskType({source,directory:".workers",workers:1});
 return {port:0,database:process.env.TASK_SERVER_DATABASE??"check.sqlite",types:[check],currentVersions:{check:"2"},
 authorize:(caller,_op,scope)=>caller.scope===scope,
 resolveCaller(request){if(request.headers.get("authorization")!=="Bearer fixture")throw new TaskError("unauthenticated","Authentication required.");return {scope:"example",subject:"example"}},
 async closeResources(){await check.close();await source.close()}};
}
`,
      );
    }
    await writeFile(
      join(directory, "mvp.mjs"),
      `
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {writeFile,readdir,mkdir,copyFile} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {startTaskServer} from "@potential-guide/task-engine-server";
import {newId} from "@potential-guide/task-engine";
${
  label === "mvp-check"
    ? `
import {checkerSchemaUri} from "@potential-guide/check-artifacts/contracts";
import {writeContractArtifact,packContractArtifact} from "@potential-guide/check-artifacts/build";
const page=Buffer.from("---\\ntitle: Packed\\ndescription: Packed\\n---\\nBody\\n");
const built=await writeContractArtifact(new Map([
 ["checker.yaml",Buffer.from(JSON.stringify({$schema:checkerSchemaUri,runtime:{type:"node",minVersion:"22.13.0"},entry:"checker.cjs",subjectSchema:{type:"object"},languages:["en"],problems:["bad"]}))],
 ["checker.cjs",Buffer.from("exports.execute=async(s,c)=>{c.progress({step:1});return {status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'bad',parameters:{}}]}}}")],
 ["references/en/checker.md",page],["references/en/problems/bad.md",page]
]),"artifact");
await packContractArtifact(built.directory,"checker.tgz");
await mkdir("imports");await copyFile("checker.tgz",resolve("imports","checker.tgz"));
const body={type:"check",checker:{kind:"checker",url:"https://example.test/checker.tgz",digest:built.digest},subject:{},timeoutMs:10000};
const fileBody={...body,checker:{...body.checker,url:pathToFileURL(resolve("imports","checker.tgz")).href}};
`
    : `const body={type:"echo",text:"packed",timeoutMs:10000};`
}
process.env.TASK_SERVER_TOKEN="fixture";process.env.TASK_SERVER_PORT="0";
const configure=(await import("./${label === "mvp-check" ? "check" : "echo"}-config.mjs")).default;
const headers={authorization:"Bearer fixture","content-type":"application/json"};
async function exercise(url,requestBody=body){
 assert.equal((await fetch(url+"/tasks/"+newId())).status,401);
 const response=await fetch(url+"/tasks",{method:"POST",headers:{...headers,"Idempotency-Key":newId()},body:JSON.stringify(requestBody)});
 assert.equal(response.status,202);const initial=await response.json();
 const stream=await fetch(url+"/events?taskId="+initial.taskId,{headers});
 assert.equal(stream.status,200);const reader=stream.body.getReader();
 const text=new TextDecoder().decode((await reader.read()).value);
 const cursor=/^id: (.+)$/m.exec(text)[1];await reader.cancel();
 const resumed=await fetch(url+"/events?taskId="+initial.taskId,{headers:{...headers,"Last-Event-ID":cursor}});
 const resumedReader=resumed.body.getReader();await resumedReader.read();await resumedReader.cancel();
 let final;
 for(let i=0;i<500;i++){final=await (await fetch(url+"/tasks/"+initial.taskId,{headers})).json();if(final.stage==="completed")break;await new Promise(r=>setTimeout(r,10))}
 assert.equal(final.stage,"completed");
 ${label === "mvp-check" ? `assert.equal(final.result.result.ok,false);assert.ok(final.result.evidence.prepared.checker.digest);` : `assert.deepEqual(final.result,{text:"packed"});`}
 let next;let events=0;
 do {const url_=new URL(url+"/event-history?taskId="+initial.taskId+"&limit=1");if(next)url_.searchParams.set("cursor",next);const page=await(await fetch(url_,{headers})).json();events+=page.events.length;next=page.next}while(next);
 assert.ok(events>=5);
 if(requestBody.checker?.url.startsWith("file:"))console.log(JSON.stringify({case:"packed-real-file-check",url:requestBody.checker.url,digest:requestBody.checker.digest,taskId:final.taskId,runId:final.run.runId,result:final.result}));
}
const signals=process.listenerCount("SIGINT");
const server=await startTaskServer(configure());
assert.equal(process.listenerCount("SIGINT"),signals);
try{await exercise(server.url);${label === "mvp-check" ? "await exercise(server.url,fileBody);" : ""}}finally{await server.close()}
const cli=fileURLToPath(new URL("./main.js",import.meta.resolve("@potential-guide/task-engine-server")));
const child=spawn(process.execPath,[cli,"--config","./${label === "mvp-check" ? "check" : "echo"}-config.mjs"],{env:{...process.env,TASK_SERVER_DATABASE:"cli.sqlite"},stdio:["ignore","pipe","pipe"],windowsHide:true});
let stderr="";child.stderr.on("data",chunk=>stderr+=chunk);
const exited=new Promise(resolve=>child.once("exit",(code,signal)=>resolve({code,signal})));
try{
 const url=await new Promise((resolve,reject)=>{
  let text="";const timer=setTimeout(()=>reject(Error("CLI readiness timeout: "+stderr)),10000);
  child.stdout.on("data",chunk=>{text+=chunk;for(const line of text.split("\\n")){try{const value=JSON.parse(line);if(value.event==="ready"){clearTimeout(timer);resolve(value.url)}}catch{}}});
  child.once("error",error=>{clearTimeout(timer);reject(error)});
  child.once("exit",()=>{clearTimeout(timer);reject(Error(stderr))});
 });
 await exercise(url);
 ${label === "mvp-check" ? "await exercise(url,fileBody);" : ""}
 child.kill("SIGTERM");const result=await exited;
 if(process.platform!=="win32")assert.equal(result.code,0);
 await assert.rejects(fetch(url));
}finally{if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");await exited}
${label === "mvp-check" ? `assert.deepEqual(await readdir(".workers"),[]);` : ""}
console.log("packed ${label}: programmatic + CLI readiness, auth, result, history and SSE reconnect; Windows SIGTERM is forced-process shutdown");
`,
    );
    const help = await run("pnpm", ["exec", "task-engine-server", "--help"], directory);
    assert.match(help, /--config/);
    console.log(await run(process.execPath, ["mvp.mjs"], directory));
  }
  console.log(`${label} actual production install: ${[...names].sort().join(", ")}`);
}
