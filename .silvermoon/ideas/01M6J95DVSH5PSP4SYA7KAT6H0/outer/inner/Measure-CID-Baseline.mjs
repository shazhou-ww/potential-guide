import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, realpath, rm, symlink, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import ts from "typescript";

// 只在自有 fixture 中复现共享工作树的 CID 精简基线，不回写任何工作树源码。
const root=resolve("."), base=process.argv[2]??"HEAD";
const output=resolve(process.argv[3]??".cache/cid-baseline.json");
const scratch=join(root,".cache","task-schema-cid-baseline");
const load=path=>import(pathToFileURL(path).href);
const git=path=>execFileSync("git",["show",`${base}:${path}`],{cwd:root,encoding:"utf8"});
const head=execFileSync("git",["rev-parse",base],{cwd:root,encoding:"utf8"}).trim();
const config=ts.getParsedCommandLineOfConfigFile(join(root,"packages","task-sdk","tsconfig.json"),{},ts.sys);
const emit=source=>ts.transpileModule(source,{compilerOptions:{
  ...config.options,module:ts.ModuleKind.ESNext,composite:false,incremental:false,
  declaration:false,sourceMap:false,noEmit:false,
}}).outputText;
const link=async(from,to)=>{await mkdir(dirname(to),{recursive:true});await symlink(await realpath(from),to,process.platform==="win32"?"junction":"dir");};
await mkdir(scratch);
try {
  const sdk=join(scratch,"sdk"), protocol=join(scratch,"protocol"), modules=join(scratch,"node_modules");
  await mkdir(join(sdk,"dist"),{recursive:true});
  await mkdir(protocol);
  let runtime=git("packages/task-sdk/src/index.ts");
  assert.ok(runtime.includes("createInputContract") && runtime.includes("validators"));
  runtime=runtime.replace("  validateBundleReference,\n","")
    .replace("  validateBundleReference(config.bundle.cid);\n","")
    .replace('typeof config.bundle?.cid !== "string"\n','typeof config.bundle?.cid !== "string" ||\n    !config.bundle.cid ||\n    config.bundle.cid.length > 256\n');
  await writeFile(join(sdk,"dist","index.js"),emit(runtime));
  await writeFile(join(sdk,"dist","binding.js"),emit(git("packages/task-sdk/src/binding.ts")));
  await writeFile(join(sdk,"package.json"),git("packages/task-sdk/package.json"));
  await writeFile(join(protocol,"package.json"),JSON.stringify({
    name:"@potential-guide/task-protocol",type:"module",sideEffects:false,
    exports:{".":"./index.js","./worker":"./worker.js"},
  }));
  const protocolRoot=join(root,"packages","task-protocol","dist");
  await writeFile(join(protocol,"index.js"),`export * from ${JSON.stringify(pathToFileURL(join(protocolRoot,"index.js")).href)};`);
  await writeFile(join(protocol,"worker.js"),`export * from ${JSON.stringify(join(protocolRoot,"worker.js"))};
export {createInputContract,createJsonContract} from ${JSON.stringify(join(protocolRoot,"schema-runtime.js"))};`);
  await writeFile(join(scratch,"package.json"),'{"private":true,"type":"module"}');
  await link(sdk,join(modules,"@potential-guide","task-sdk"));
  await link(protocol,join(modules,"@potential-guide","task-protocol"));
  for(const name of ["@potential-guide/artifact-files","@potential-guide/ipfs-content","esbuild","yaml"])
    await link(join(root,"packages","pguide-task-bundle","node_modules",...name.split("/")),join(modules,...name.split("/")));
  const authorRoot=join(root,"packages","pguide-task-bundle","dist");
  const builder=git("packages/pguide-task-bundle/src/build.ts").replace(
    'from "./artifact.js"',`from ${JSON.stringify(pathToFileURL(join(authorRoot,"artifact.js")).href)}`,
  );
  await writeFile(join(scratch,"build.js"),emit(builder));
  const {initTaskBundle}=await load(join(authorRoot,"init.js"));
  const {readTaskBuild}=await load(join(authorRoot,"authoring.js"));
  const {buildTaskBundle,compileTaskBundle}=await load(join(scratch,"build.js"));
  const cases=[];
  for(const name of ["default","repeat"]){
    const directory=join(scratch,name);
    await mkdir(directory);
    await writeFile(join(directory,"package.json"),'{"private":true,"type":"module"}');
    const initialized=await initTaskBundle(directory);
    await link(sdk,join(directory,"node_modules","@potential-guide","task-sdk"));
    await link(join(root,"packages","pguide-task-bundle","node_modules","@sinclair","typebox"),join(directory,"node_modules","@sinclair","typebox"));
    const options=await readTaskBuild(initialized.buildFile);
    const built=await buildTaskBundle(options), analyzed=await compileTaskBundle(options);
    const worker=await readFile(join(built.directory,"worker.cjs"));
    assert.deepEqual(worker,analyzed.contents.get("worker.cjs"));
    const contributions={};
    for(const result of Object.values(analyzed.metafile.outputs))
      for(const [path,{bytesInOutput}] of Object.entries(result.inputs))
        contributions[path.replaceAll("\\","/").replaceAll(root.replaceAll("\\","/"),"<root>")]=bytesInOutput;
    cases.push({
      name,cid:built.cid,workerBytes:worker.length,workerSha256:createHash("sha256").update(worker).digest("hex"),
      totalBytes:[...analyzed.contents.values()].reduce((sum,bytes)=>sum+bytes.length,0),
      carBytes:(await readFile(built.car)).length,
      files:Object.fromEntries([...analyzed.contents].map(([path,bytes])=>[path,bytes.length])),
      contributions,
    });
  }
  assert.equal(cases[0].cid,cases[1].cid);
  assert.equal(cases[0].workerSha256,cases[1].workerSha256);
  const result={
    baseCommit:head,normalization:"Original build + SDK with parent CID opaque-identity delta; protocol runtime contract APIs retained.",
    node:process.version,typescript:ts.version,esbuild:(await import("esbuild")).version,
    lockSha256:createHash("sha256").update(await readFile(join(root,"pnpm-lock.yaml"))).digest("hex"),
    sdkSourceSha256:createHash("sha256").update(runtime).digest("hex"),cases,
  };
  await writeFile(output,`${JSON.stringify(result,null,2)}\n`);
  console.log(JSON.stringify({baseCommit:head,worker:cases[0].workerBytes,total:cases[0].totalBytes,car:cases[0].carBytes}));
} finally {await rm(scratch,{recursive:true,force:true});}
