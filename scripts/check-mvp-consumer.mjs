import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export async function checkMvpConsumer(root, directory, label, graph, run) {
  assert.equal(label, "mvp-server", "Unsupported MVP consumer.");
  const names = new Set(graph.map((entry) => entry.name));
  assert.ok(!names.has("@potential-guide/checker-host"));
  assert.ok(!names.has("@potential-guide/objective-host"));
  for (const forbidden of [
    "@potential-guide/artifact-files",
    "@potential-guide/check-artifacts",
    "@potential-guide/check-runtime-files",
    "@potential-guide/task-sdk",
    "@potential-guide/check-task",
    "@potential-guide/probe-task",
  ])
    assert.ok(!names.has(forbidden), `Generic Task server must not install ${forbidden}.`);
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
  for (const name of ["echo-config.mjs", "echo-type.mjs"])
    await writeFile(
      join(directory, name),
      await readFile(join(root, "examples", "task-server", name)),
    );
  await writeFile(
    join(directory, "consumer-config.mjs"),
    `
import {readFile} from "node:fs/promises";
import {MemoryIpfsClient} from "@potential-guide/task-engine/testing";
import {configureTaskServer} from "./echo-config.mjs";
export default async function configure(){
 const ipfsClient=new MemoryIpfsClient();
 for(const [cid,hex] of JSON.parse(await readFile("content.json","utf8")))ipfsClient.blocks.set(cid,Buffer.from(hex,"hex"));
 return configureTaskServer({token:process.env.TASK_SERVER_TOKEN,port:0,database:process.env.TASK_SERVER_DATABASE??"consumer.sqlite",ipfsClient});
}
`,
  );
  await writeFile(
    join(directory, "mvp.mjs"),
    `
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {startTaskServer} from "@potential-guide/task-engine-server";
import {newId} from "@potential-guide/task-engine";
import {MemoryIpfsClient} from "@potential-guide/task-engine/testing";
const ipfsClient=new MemoryIpfsClient();
const binding=JSON.parse(await readFile(${JSON.stringify(join(directory, "..", "task-sdk", "fixture", "binding.json"))},"utf8"));
for(const [cid,hex] of JSON.parse(await readFile(${JSON.stringify(join(directory, "..", "task-sdk", "fixture", "blocks.json"))},"utf8")))ipfsClient.blocks.set(cid,Buffer.from(hex,"hex"));
const body={bundle:binding.cid,text:"packed",timeoutMs:10000};
await writeFile("content.json",JSON.stringify([...ipfsClient.blocks].map(([cid,bytes])=>[cid,Buffer.from(bytes).toString("hex")])));
process.env.TASK_SERVER_TOKEN="fixture";process.env.TASK_SERVER_PORT="0";
const configure=(await import("./consumer-config.mjs")).default;
const headers={authorization:"Bearer fixture","content-type":"application/json"};
async function exercise(url){
 assert.equal((await fetch(url+"/tasks/"+newId())).status,401);
 const response=await fetch(url+"/tasks",{method:"POST",headers:{...headers,"Idempotency-Key":newId()},body:JSON.stringify(body)});
 assert.ok(response.ok);let decision=await response.json();
 while(decision.status==="preparing")decision=await(await fetch(url+"/requests/"+decision.requestId+"/status?waitMs=1000",{headers})).json();
 assert.equal(decision.status,"accepted");const initial=await(await fetch(url+"/tasks/"+decision.taskId,{headers})).json();
 const stream=await fetch(url+"/events?taskId="+initial.taskId,{headers:{...headers,"Last-Event-ID":initial.revision}});
 assert.equal(stream.status,200);const reader=stream.body.getReader();
 const text=new TextDecoder().decode((await reader.read()).value);
 const cursor=/^id: (.+)$/m.exec(text)[1];await reader.cancel();
 const resumed=await fetch(url+"/events?taskId="+initial.taskId,{headers:{...headers,"Last-Event-ID":cursor}});
 const resumedReader=resumed.body.getReader();await resumedReader.read();await resumedReader.cancel();
 let final;
 for(let i=0;i<500;i++){final=await(await fetch(url+"/tasks/"+initial.taskId,{headers})).json();if(final.termination)break;await new Promise(r=>setTimeout(r,10))}
 assert.equal(final.stage,"completed",JSON.stringify(final));
 assert.deepEqual(final.result,{text:"packed"});
 let next;let events=0;
 do {const url_=new URL(url+"/event-history?taskId="+initial.taskId+"&limit=1");if(next)url_.searchParams.set("cursor",next);const page=await(await fetch(url_,{headers})).json();assert.ok(page.events.every(event=>!event.type.startsWith("run.")));events+=page.events.length;next=page.next}while(next);
 assert.equal(events,3);
 const run=await(await fetch(url+"/runs/"+final.run.runId,{headers})).json();
 assert.equal(run.stage,"completed");
 const history=await(await fetch(url+"/runs/"+run.runId+"/history",{headers})).json();
 assert.ok(history.events.some(event=>event.type==="run.started"));
 assert.ok(history.events.some(event=>event.type==="run.exited"));
 assert.ok(history.events.length>=5);
}
const signals=process.listenerCount("SIGINT");
const server=await startTaskServer(await configure());
assert.equal(process.listenerCount("SIGINT"),signals);
try{await exercise(server.url)}finally{await server.close()}
console.log("packed mvp-server: programmatic readiness, auth, result, history and SSE reconnect; declarative CLI is verified separately");
`,
  );
  console.log(await run(process.execPath, ["mvp.mjs"], directory));
  console.log(`${label} actual production install: ${[...names].sort().join(", ")}`);
}
