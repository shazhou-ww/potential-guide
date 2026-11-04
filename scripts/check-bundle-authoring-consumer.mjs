import assert from "node:assert/strict";
import { copyFile, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { consumerVersions, verifyConsumerGraph } from "./deployment-consumer.mjs";

export async function checkBundleAuthoringConsumer(directory, cid, tarballs, manifests, run) {
  await writeFile(
    join(directory, "publish.mjs"),
    `
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {MemoryIpfsClient} from "@potential-guide/ipfs-content/testing";
import {importTaskBundle} from "@potential-guide/pguide-task-bundle/publish";
const client=new MemoryIpfsClient();
assert.equal((await importTaskBundle("bundle",client)).cid,${JSON.stringify(cid)});
await writeFile("blocks.json",JSON.stringify([...client.blocks].map(([key,bytes])=>[key,Buffer.from(bytes).toString("hex")])));
`,
  );
  for (const file of ["main.ts", "contract.ts", "task.build.yaml"]) await rm(join(directory, file));
  await run(process.execPath, ["publish.mjs"], directory);
  const host = await realpath(await mkdtemp(join(tmpdir(), "pguide-bundle-runtime-")));
  try {
    await copyFile(join(directory, "blocks.json"), join(host, "blocks.json"));
    const entries = ["@potential-guide/task-engine"];
    await writeFile(
      join(host, "pnpm-workspace.yaml"),
      `packages: []\noverrides: ${JSON.stringify(Object.fromEntries([...tarballs].map(([name, path]) => [name, pathToFileURL(path).href])))}\n`,
    );
    await writeFile(
      join(host, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: Object.fromEntries(
          entries.map((name) => [name, pathToFileURL(tarballs.get(name)).href]),
        ),
      }),
    );
    await run(
      "pnpm",
      ["install", "--prod", "--prefer-offline", "--ignore-scripts", "--no-frozen-lockfile"],
      host,
    );
    const graph = await verifyConsumerGraph(
      host,
      consumerVersions(manifests, entries),
      entries,
      true,
    );
    const names = new Set(graph.map((entry) => entry.name));
    for (const name of [
      "@sinclair/typebox",
      "@potential-guide/pguide-task-bundle",
      "@potential-guide/task-sdk",
    ])
      assert.ok(!names.has(name), `Production host must not install ${name}.`);
    await writeFile(
      join(host, "consume.mjs"),
      `
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createTaskEngine,newId} from "@potential-guide/task-engine";
import {MemoryIpfsClient,MemoryStore} from "@potential-guide/task-engine/testing";
for(const name of ["@potential-guide/task-sdk","@potential-guide/pguide-task-bundle","@sinclair/typebox"])
 await assert.rejects(import(name),error=>error.code==="ERR_MODULE_NOT_FOUND");
const client=new MemoryIpfsClient();
for(const [key,hex] of JSON.parse(await readFile("./blocks.json","utf8")))
 client.blocks.set(key,Buffer.from(hex,"hex"));
const store=new MemoryStore();
const engine=createTaskEngine({store,ipfsClient:client,authorize:()=>true});
const caller={scope:"packed-author",subject:"runtime"};
await engine.start();
try {
 let decision=await engine.submit({requestId:newId(),bundle:${JSON.stringify(cid)},text:"typed packed",timeoutMs:10000},caller);
 while(decision.status==="preparing")decision=await engine.getRequestStatus(decision.requestId,{waitMs:1000},caller);
 assert.equal(decision.status,"accepted");
 let task;
 const deadline=Date.now()+15000;
 do {
  task=engine.getTask(decision.taskId,caller);
  if(task.stage==="completed"||task.stage==="failed")break;
  await new Promise(done=>setTimeout(done,20));
 }while(Date.now()<deadline);
 assert.equal(task.stage,"completed");
 assert.equal(task.result,"typed packed");
} finally {await engine.close();store.close();}
console.log("Packed TypeBox artifact: CID-only Engine/real Worker execution passed without author sources or dependencies.");
`,
    );
    console.log(await run(process.execPath, ["consume.mjs"], host));
  } finally {
    await rm(host, { recursive: true, force: true });
  }
}
