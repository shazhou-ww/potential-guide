import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkMvpConsumer } from "./check-mvp-consumer.mjs";
import { consumerVersions, verifyConsumerGraph } from "./deployment-consumer.mjs";
import { discoveryHostBins } from "./release-packages.mjs";

export async function checkPackageConsumers(root, scratch, definitions, tarballs, run) {
  const manifests = new Map();
  for (const { name, directory } of definitions) {
    manifests.set(
      name,
      JSON.parse(await readFile(join(root, "packages", directory, "package.json"), "utf8")),
    );
  }
  const scenarios = [
    [
      "probe-task",
      [
        "@potential-guide/probe-task",
        "@potential-guide/check-task",
        "@potential-guide/check-artifacts",
        "@potential-guide/task-engine",
        "@potential-guide/task-engine-server",
        "@potential-guide/task-protocol",
      ],
    ],
    ["artifact-contracts", ["@potential-guide/check-artifacts"]],
    [
      "mvp-server",
      [
        "@potential-guide/task-engine-server",
        "@potential-guide/task-engine",
        "@potential-guide/task-protocol",
      ],
    ],
    [
      "mvp-check",
      [
        "@potential-guide/check-task",
        "@potential-guide/task-engine-server",
        "@potential-guide/task-engine",
        "@potential-guide/task-protocol",
        "@potential-guide/check-artifacts",
      ],
    ],
    ["task-protocol", ["@potential-guide/task-protocol"]],
    ["task-engine", ["@potential-guide/task-engine"]],
    [
      "task-adapters",
      [
        "@potential-guide/task-engine",
        "@potential-guide/task-engine-http",
        "@potential-guide/task-engine-storage",
      ],
    ],
    [
      "npm-objectives",
      [
        ...definitions.filter((entry) => entry.objective).map((entry) => entry.name),
        "@potential-guide/checker-host",
        "@potential-guide/cli-runtime",
        "@potential-guide/objective-pilot",
        "@potential-guide/effects",
        "@potential-guide/regulation-coordinator",
        "pguide",
        "@potential-guide/pguide-pilot",
        "@potential-guide/pguide-regulate",
      ],
    ],
    [
      "artifact-hosts",
      [
        "@potential-guide/check-artifacts",
        "@potential-guide/checker-host",
        "@potential-guide/objective-host",
      ],
    ],
    ["protocol", ["@potential-guide/pilot-protocol"]],
    ["main", ["pguide"]],
    ["pilot", ["@potential-guide/pguide-pilot"]],
    ["regulation", ["@potential-guide/pguide-regulate"]],
    ["coordinator", ["@potential-guide/effects", "@potential-guide/regulation-coordinator"]],
    ["objectives", ["@potential-guide/pguide-objectives"]],
    ["config", ["@potential-guide/pguide-config"]],
    ["agents", ["@potential-guide/pguide-agents"]],
    [
      "combined",
      [
        "pguide",
        "@potential-guide/pguide-pilot",
        "@potential-guide/pguide-regulate",
        "@potential-guide/pguide-objectives",
        "@potential-guide/pguide-config",
        "@potential-guide/pguide-agents",
      ],
    ],
  ];
  for (const [label, entries] of scenarios) {
    const directory = join(scratch, label);
    await mkdir(directory);
    await writeFile(
      join(directory, "pnpm-workspace.yaml"),
      `packages: []\noverrides: ${JSON.stringify(
        Object.fromEntries([...tarballs].map(([name, path]) => [name, pathToFileURL(path).href])),
      )}\n`,
    );
    const manifest = {
      name: `pguide-consumer-${label}`,
      private: true,
      type: "module",
      dependencies: Object.fromEntries(
        entries.map((name) => [name, pathToFileURL(tarballs.get(name)).href]),
      ),
    };
    await writeFile(join(directory, "package.json"), JSON.stringify(manifest, null, 2));
    await run(
      "pnpm",
      [
        "install",
        "--prefer-offline",
        "--ignore-scripts",
        "--no-frozen-lockfile",
        "--reporter=append-only",
      ],
      directory,
    );
    const closure = consumerVersions(manifests, entries);
    const graph = await verifyConsumerGraph(
      directory,
      closure,
      entries,
      label === "probe-task" ||
        label === "npm-objectives" ||
        label === "artifact-contracts" ||
        label.startsWith("mvp-"),
    );
    if (label === "probe-task") {
      const names = new Set(graph.map((entry) => entry.name));
      for (const forbidden of [
        "@potential-guide/checker-host",
        "@potential-guide/objective-host",
        "@potential-guide/objective-pilot",
      ])
        assert.ok(!names.has(forbidden));
      for (const filename of ["probe-config.mjs", "probe-integration.mjs"])
        await writeFile(
          join(directory, filename),
          await readFile(join(root, "examples", "task-server", filename)),
        );
      console.log(await run(process.execPath, ["probe-integration.mjs"], directory));
    }
    if (label === "artifact-contracts" || label.startsWith("mvp-"))
      await checkMvpConsumer(root, directory, label, graph, run);
    if (label.startsWith("task-")) {
      const script = join(directory, "generic-task.mjs");
      await writeFile(
        join(directory, "type-worker.mjs"),
        `export function createEcho(){return {type:"echo",version:"1",inputSchema:{type:"object"},resultSchema:true,messageSchema:false,async run(input,context){await context.progress({stage:"execution",message:"返回输入"});return input}}}`,
      );
      await writeFile(
        script,
        `
import assert from "node:assert/strict";
${
  label === "task-protocol"
    ? `
import {emptyFacts,json} from "@potential-guide/task-protocol";
assert.equal(emptyFacts().watermark,0);
assert.deepEqual(json({value:2}),{value:2});
`
    : `
import {createTaskEngine,newId} from "@potential-guide/task-engine";
import {MemoryStore} from "@potential-guide/task-engine/testing";
const type={type:"echo",version:"1",environment:"node",inputSchema:{type:"object"},resultSchema:true,messageSchema:false,module:new URL("./type-worker.mjs",import.meta.url).href,exportName:"createEcho",configuration:{}};
${
  label === "task-adapters"
    ? `
import {openSqliteStore} from "@potential-guide/task-engine-storage";
import {createTaskHandler} from "@potential-guide/task-engine-http";
const store=openSqliteStore("consumer.sqlite");
`
    : "const store=new MemoryStore();"
}
const engine=createTaskEngine({store,types:[type],currentVersions:{echo:"1"},authorize:()=>true});
await engine.start();
const caller={scope:"consumer",subject:"fixture"};
const task=engine.submit({requestId:newId(),type:"echo",text:"packed",timeoutMs:10000},caller);
let result;
for(let i=0;i<200;i++){await new Promise(r=>setTimeout(r,10));result=engine.getTask(task.taskId,caller);if(result.stage==="completed")break;}
assert.equal(result.stage,"completed");assert.deepEqual(result.result,{text:"packed"});
${
  label === "task-adapters"
    ? `
const handler=createTaskHandler({service:engine,resolveCaller:()=>caller});
assert.equal((await handler(new Request("http://fixture/tasks/"+task.taskId))).status,200);
`
    : ""
}
await engine.close();store.close();
`
}
`,
      );
      await run(process.execPath, [script], directory);
    }
    if (label === "artifact-hosts") {
      const script = join(directory, "artifact-hosts.mjs");
      await writeFile(
        script,
        `
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {checkerSchemaUri,objectiveSchemaUri} from "@potential-guide/check-artifacts";
import {buildCheckerArtifact,writeContractArtifact,packContractArtifact} from "@potential-guide/check-artifacts/build";
import {ContractStore,CheckKernel,CheckerService,CheckerMaterializer,createServiceRouter,serveServices,closePrivateFileBackend} from "@potential-guide/checker-host";
import {CheckTaskClient} from "@potential-guide/checker-host/v3";
import {ObjectiveService,ObjectiveTaskClient,createObjectiveRouter} from "@potential-guide/objective-host";
const root=resolve("fixture");
await mkdir(root);
const page=Buffer.from("---\\ntitle: Packed\\ndescription: Independent consumer\\n---\\nBody\\n");
await writeFile(join(root,"entry.cjs"),"exports.execute=async()=>({status:200,message:'',payload:{ok:true,problems:[]}});");
await writeFile(join(root,"checker.md"),page);
const built=await buildCheckerArtifact({
  manifest:Buffer.from(JSON.stringify({$schema:checkerSchemaUri,runtime:{type:"node",minVersion:"22.13.0"},entry:"checker.cjs",subjectSchema:{type:"object"},languages:["en"],problems:[]})),
  entry:join(root,"entry.cjs"),references:{"references/en/checker.md":join(root,"checker.md")},
  outDirectory:join(root,"checker")
});
const packedCheck=await packContractArtifact(built.directory,join(root,"checker.tgz"));
const checkUrl="https://example.test/checker/1.tgz";
const objective=await writeContractArtifact(new Map([
  ["objective.yaml",Buffer.from(JSON.stringify({
    $schema:objectiveSchemaUri,subjectSchema:{type:"object"},languages:["en"],
    levels:[{id:"ready",checks:["pass"]}],
    checkers:{pass:{url:checkUrl,digest:built.digest,subjectMapping:"$"}}
  }))],
  ["references/en/objective.md",page],["references/en/levels/ready.md",page]
]),join(root,"objective"));
const packedObjective=await packContractArtifact(objective.directory,join(root,"objective.tgz"));
const objectiveUrl="https://example.test/objective/1.tgz";
const archives=new Map([[checkUrl,await readFile(packedCheck.archive)],[objectiveUrl,await readFile(packedObjective.archive)]]);
const repository=new ContractStore(["https://example.test"],undefined,async(url)=>{
  const bytes=archives.get(url);assert.ok(bytes,"Unexpected artifact source");return bytes;
});
const kernel=await CheckKernel.create(join(root,"snapshots"));
const checks=new CheckerService(repository,new CheckerMaterializer(join(root,"run")),kernel,["en"]);
const objectives=new ObjectiveService(repository,checks,["en"]);
const token=randomUUID();
const host=await serveServices([createServiceRouter(checks,"/checks","checker"),createObjectiveRouter(objectives,"/probes")],token,async()=>{
  await objectives.close();await checks.close();repository.close();await closePrivateFileBackend();
});
const address={endpoint:host.endpoint,token};
const checkerClient=new CheckTaskClient(address,"/checks");
const client=new ObjectiveTaskClient(address,"/probes");
try{
  assert.equal((await client.resolveArtifact(objectiveUrl)).digest,objective.digest);
  const task=await client.probe({objective:{url:objectiveUrl,digest:objective.digest},subject:{}});
  const observed=await task.result();
  assert.equal(observed.result.current.levelId,"ready");
  assert.equal(observed.evidence.checks[0].snapshot.evidence.runtime.version,process.versions.node);
  assert.equal(observed.evidence.checks[0].snapshot.freshness,"started-after-request");
  assert.match(observed.evidence.checks[0].snapshot.evidence.revision,/^[a-f0-9]{64}$/);
  const checked=await checkerClient.check({checker:{url:checkUrl,digest:built.digest},subject:{}});
  assert.deepEqual((await checked.result()).result,{ok:true,problems:[]});
  assert.equal((await client.reference(objective.digest,"checkers/pass")).origin.artifactDigest,built.digest);
  await assert.rejects(()=>client.reference(objective.digest,"system/404"),/not found/);
}finally{
  client.close();checkerClient.close();await host.close();
}
`,
      );
      await run(process.execPath, [script], directory);
    }
    if (label === "npm-objectives") {
      const { defaultPolicy } = await import(
        pathToFileURL(join(root, "packages", "objective-monorepo-standard", "dist", "index.js"))
          .href
      );
      const reportFile = join(root, ".cache", `npm-objectives-installed-${Date.now()}.json`);
      await writeFile(
        join(directory, "objective-consumption.mjs"),
        `
import assert from "node:assert/strict";
import {dirname,resolve,join} from "node:path";
import {createRequire} from "node:module";
import {mkdir,writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {prepareObjectivePackage,withPilot} from "@potential-guide/cli-runtime";
import {CheckKernel,readArtifact,terminal,serve,ensurePrivateDirectory,publishPrivateFile,removePrivateFile} from "@potential-guide/checker-host";
import {observe} from "@potential-guide/objective-pilot";
import {Effect} from "@potential-guide/effects";
import {RequestModel as R,CoordinatorModel as M,coordinatorViews} from "@potential-guide/regulation-coordinator";
const require=createRequire(import.meta.url);
process.env.PGUIDE_CHECK_HOST_DIRECTORY=resolve(".cache","owned-host");
const names=${JSON.stringify(definitions.filter((entry) => entry.objective).map((entry) => entry.name))};
const origins=${JSON.stringify(Object.fromEntries(tarballs))};
const packageSpecs=Object.fromEntries(names.map(name=>[name,dirname(require.resolve(name+"/objective.yaml"))]));
const cacheDirectory=resolve(".cache","frozen");
const kernel=await CheckKernel.create(resolve(".cache","snapshots"));
await ensurePrivateDirectory(process.env.PGUIDE_CHECK_HOST_DIRECTORY);
const token=randomUUID(),host=await serve(kernel,token);
const descriptor=JSON.stringify({endpoint:host.endpoint,token,pid:process.pid,instance:randomUUID()});
assert.equal(await publishPrivateFile(process.env.PGUIDE_CHECK_HOST_DIRECTORY,"host.json",descriptor,null),true);
const inventory={node:process.version,platform:process.platform,graph:${JSON.stringify(graph)},packages:[],artifacts:[]};
let runs=0;
try{
 for(const name of names){
  const prepared=await prepareObjectivePackage(packageSpecs[name],process.cwd(),{cacheDirectory:join(cacheDirectory,"packages")});
  const original=await prepareObjectivePackage(origins[name],process.cwd(),{cacheDirectory:join(cacheDirectory,"packages")});
  assert.equal(prepared.source.packageDigest,original.source.packageDigest,"Installed tree differs from the exact delivery tarball.");
  inventory.packages.push({name,installedSource:prepared.source,tarballSource:original.source});
  assert.equal(prepared.source.packageName,name);
  assert.equal(prepared.source.spec,packageSpecs[name]);
  await withPilot(packageSpecs[name],process.cwd(),undefined,async(spec)=>{
   assert.equal(spec.objectiveId,name);
   assert.equal(spec.version,prepared.source.packageDigest);
   for(const level of spec.manifest.levels)for(const check of level.checks){
    const artifact=await readArtifact(join(prepared.directory,"checks",check.id));
    inventory.artifacts.push({objectiveId:name,levelId:level.id,checkId:check.id,revision:artifact.revision});
    const checkId="installed-"+runs++;
    await kernel.executeCheck({checkId,directory:artifact.directory,revision:artifact.revision,subject:{}});
    while(!terminal(kernel.sample(checkId)))await new Promise(done=>setTimeout(done,10));
    const state=kernel.sample(checkId);
    assert.equal(state.state,"Failed");
    assert.doesNotMatch(state.error,/initialization timed out|Cannot find module|dependencies must be bundled|verified worker source/i);
   }
  },{cacheDirectory,packageSpecs,reports:{enabled:false}});
 }
 assert.equal(runs,16);
 assert.equal(kernel.diagnostics().executions,16);
 const target=resolve(".cache","target");
 const own={root:target,directory:"packages/shared",roles:["internal"],runtime:"universal",allows:[],entries:["src/index.ts"],generated:[],joins:[],deliveries:[]};
 const files={
  "package.json":JSON.stringify({name:"independent-target",private:true}),
  "README.md":"# Independent",
  "pnpm-workspace.yaml":"packages: [packages/*, apps/*]",
  "turbo.json":JSON.stringify({tasks:{build:{outputs:["dist/**"],dependsOn:["^build"]},check:{outputs:[]}}}),
  "packages/shared/package.json":JSON.stringify({name:"shared",private:true,scripts:{build:"MUST_NOT_EXECUTE",check:"MUST_NOT_EXECUTE"}}),
  "packages/shared/README.md":"# Shared",
  "packages/shared/src/index.ts":"export const value=1;",
  "packages/shared/objectives.yaml":JSON.stringify({$schema:"https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json",objectives:{standardize:{description:"Package preparation",objective:"@potential-guide/objective-package-standard",inputSchema:{type:"object",additionalProperties:false,maxProperties:0},subject:JSON.stringify(own)}}})
 };
 for(const [name,bytes] of Object.entries(files)){const path=join(target,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
 let rootSpec,rootObservation;
 const subject={context:{repo:{rootPath:target,origin:null},path:"."},policy:${JSON.stringify(defaultPolicy)},deliveries:[]};
 await withPilot(packageSpecs["@potential-guide/objective-monorepo-standard"],process.cwd(),undefined,async(spec,runtime)=>{
  rootSpec=spec;
  const result=await Effect.runPromise(observe({spec,subject},runtime));
  assert.equal(result.status,200,result.message);
  assert.equal(result.payload.current.levelId,"standardized",JSON.stringify(result));
  assert.equal(Object.keys(result.payload.versions).length,2);
  assert.ok(Object.values(result.payload.sources).every(source=>source.kind==="npm-package"));
  rootObservation=result;
 },{cacheDirectory,packageSpecs,reports:{enabled:false}});
 let state=M.createCoordinatorState("installed-consumer");
 const fact=(value)=>{state=M.reduceCoordinatorState({revision:state.revision+1,occurredAt:"2026-10-24T00:00:00Z",fact:value},state);};
 fact({type:"request",command:{type:"request",requestRef:"installed-npm",objective:rootSpec,subject,desiredLevel:"terminal",priority:0,origin:{kind:"external"}}});
 const binding={id:"installed-fixture",configuration:{}};
 fact({type:"resources",allocation:{kind:"configured",bindings:[{binding,capacity:1}]}});
 const run={id:"installed-consumer:3",requestRef:"installed-npm",resourceRevision:2,hostBindingRevisionId:M.bindingRevisionId("installed-consumer",binding),limits:{timeoutMs:1000,maxAgentRuns:1,maxStallRuns:1}};
 fact({type:"run-start",run});
 fact({type:"run-phase",runId:run.id,phase:"running"});
 fact({type:"observation",runId:run.id,observation:rootObservation});
 fact({type:"run-end",runId:run.id,outcome:{kind:"target-reached"}});
 const replay=M.restoreCoordinatorState(JSON.parse(JSON.stringify(state)));
 assert.deepEqual(coordinatorViews([replay]),coordinatorViews([state]));
 assert.equal(R.requestDetails(replay.requests,"installed-npm").objectiveRevision.packageDigest,rootSpec.version);
 assert.equal(R.requestDetails(replay.requests,"installed-npm").objectiveRevision.commit,undefined);
 inventory.businessObservation=rootObservation;
 inventory.coordinator={objective:R.requestDetails(replay.requests,"installed-npm").objective,packageDigest:rootSpec.version,events:state.events.length,replay:true,views:true};
 await writeFile(${JSON.stringify(reportFile)},JSON.stringify(inventory,null,2)+"\\n",{flag:"wx"});
 console.log(JSON.stringify({packages:names.length,checks:runs,source:"installed-package-directories",runtime:"installed-cli-runtime",workspaceFallback:false,report:${JSON.stringify(reportFile)}}));
}finally{await host.close();await removePrivateFile(process.env.PGUIDE_CHECK_HOST_DIRECTORY,"host.json",descriptor);}
`,
      );
      await run(process.execPath, [join(directory, "objective-consumption.mjs")], directory);
      console.log(`Installed Objective evidence: ${reportFile}`);
    }
    if (label === "coordinator") {
      for (const name of [
        "@potential-guide/objective-portfolio-supervisor",
        "@potential-guide/pguide-supervise",
      ]) {
        assert.ok(!closure.has(name), `Retired package in Coordinator closure: ${name}`);
        const installed = await readFile(join(directory, "pnpm-lock.yaml"), "utf8");
        assert.ok(!installed.includes(name), `Retired package installed: ${name}`);
      }
      await writeFile(
        join(directory, "api.ts"),
        `
        import { Effect, Stream, SubscriptionRef } from "@potential-guide/effects";
        import { regulationCoordinator, coordinator, CoordinatorModel, RequestModel, type BehaviorCoordinatorOptions, type AgentResource, type CoordinatorCommand, type CoordinatorOptions } from "@potential-guide/regulation-coordinator";
        export const behaviorApi = (
          resources: SubscriptionRef.SubscriptionRef<CoordinatorModel.ResourceAllocation>,
          requests: SubscriptionRef.SubscriptionRef<RequestModel.RegulationRequests>,
          options: BehaviorCoordinatorOptions
        ) => Effect.scoped(coordinator(resources, requests, options));
        export const reduceRequest = (command: RequestModel.RequestCommand) =>
          RequestModel.reduceRegulationRequests(command, RequestModel.createRegulationRequests());
        export const restoreRequests = (snapshot: unknown) =>
          RequestModel.restoreRegulationRequests(snapshot);
        export const api = (
          resources: SubscriptionRef.SubscriptionRef<readonly AgentResource[]>,
          commands: Stream.Stream<CoordinatorCommand>,
          options: CoordinatorOptions
        ) => Effect.scoped(regulationCoordinator(resources, commands, options));
        `,
      );
      await writeFile(
        join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2023",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: [],
          },
          files: ["api.ts"],
        }),
      );
      await run(
        process.execPath,
        [
          join(root, "node_modules", "typescript", "bin", "tsc"),
          "-p",
          directory,
          "--pretty",
          "false",
        ],
        directory,
      );
      await run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import assert from "node:assert/strict";
          import { Effect, SubscriptionRef } from "@potential-guide/effects";
          import { regulationCoordinator, RequestModel, CoordinatorModel, coordinator, coordinatorViews } from "@potential-guide/regulation-coordinator";
          assert.equal(typeof regulationCoordinator, "function");
          const state = RequestModel.createRegulationRequests();
          assert.deepEqual(RequestModel.restoreRegulationRequests(JSON.parse(JSON.stringify(state))), state);
          assert.ok(Object.isFrozen(state));
          let closed = false;
          await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const resources = yield* SubscriptionRef.make({ kind: "no-resource" });
            const requests = yield* SubscriptionRef.make(state);
            const service = yield* coordinator(resources, requests, {
              hostId: "packed-host",
              limits: { timeoutMs: 100, maxAgentRuns: 1, maxStallRuns: 1 },
              maxAttemptsPerRequest: 1, maxDependencyRequests: 4, abortGraceMs: 10,
              store: { load: async () => null, save: async () => {}, close: async () => { closed = true; } },
              runner: { start: () => { throw new Error("Unexpected start"); }, recover: async () => ({ kind: "unknown" }) },
              onError: (error) => { throw error; }
            });
            assert.deepEqual(CoordinatorModel.restoreCoordinatorState(service.snapshot()), service.snapshot());
            assert.equal(coordinatorViews([service.snapshot()]).hosts[0].occupancy, 0);
          })));
          assert.equal(closed, true);`,
        ],
        directory,
      );
      await writeFile(
        join(directory, "recurrence.mjs"),
        await readFile(join(root, "scripts", "coordinator-consumer.mjs"), "utf8"),
      );
      console.log(await run(process.execPath, [join(directory, "recurrence.mjs")], directory));
    }
    if (label === "protocol") {
      for (const name of closure.keys())
        assert.doesNotMatch(
          name,
          /objective-(?:pilot|regulator|portfolio)|@potential-guide\/pguide-|cli-runtime/,
        );
    }
    if (label === "protocol") {
      const script = join(directory, "protocol.mjs");
      await writeFile(
        script,
        `
        import assert from "node:assert/strict";
        import * as protocol from "@potential-guide/pilot-protocol";
        assert.equal(protocol.compileDomain({ type: "object" })({}), true);
        assert.throws(() => protocol.parseManifest("{}"), protocol.ObjectiveConfigurationError);
        assert.equal(typeof protocol.loadPilotSpec, "function");
        assert.equal(typeof protocol.parseCheckEnvelope, "function");
        assert.equal(typeof protocol.parseObjectives, "function");
        assert.equal(typeof protocol.projectObjective, "function");
        assert.equal(typeof protocol.bindObjective, "function");
        const declaration = protocol.parseObjectives(JSON.stringify({
          $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json",
          objectives: { standardize: {
            description: "Independent declaration",
            objective: "git+https://example.test/rules.git#package-standard/",
            inputSchema: { type: "object", additionalProperties: false, maxProperties: 0 },
            subject: '{"ready": true}'
          } }
        }));
        assert.deepEqual(protocol.projectObjective(declaration.standardize, {repo:null,path:"/independent"}, undefined), { ready: true });
        const {readFileSync,writeFileSync} = await import("node:fs");
        const {createRequire} = await import("node:module");
        const require = createRequire(import.meta.url);
        for (const format of ["objective", "objectives"]) {
          const version = format === "objective" ? "v3" : "v1";
          const schema = JSON.parse(readFileSync(require.resolve("@potential-guide/pilot-protocol/schemas/" + format + "/" + version + ".json"), "utf8"));
          assert.equal(schema.$id, "https://shazhou-ww.github.io/potential-guide/schemas/" + format + "/" + version + ".json");
          assert.deepEqual(schema, format === "objective" ? protocol.objectiveSchema : protocol.objectivesSchema);
        }
        for (const version of ["v1","v2"]) {
          const historical = JSON.parse(readFileSync(require.resolve("@potential-guide/pilot-protocol/schemas/objective/" + version + ".json"), "utf8"));
          assert.equal(historical.$id, "https://shazhou-ww.github.io/potential-guide/schemas/objective/" + version + ".json");
          assert.notDeepEqual(historical,protocol.objectiveSchema);
        }
        assert.throws(()=>protocol.parseManifest(JSON.stringify({
          $schema:"https://shazhou-ww.github.io/potential-guide/schemas/objective/v2.json",
          subjectSchema:{type:"object"},levels:[{id:"ready",checks:[]}],
          defaultLanguage:"en-US",languages:["en-US"]
        })),protocol.ObjectiveConfigurationError);
        assert.equal(protocol.validateObjectivesDocument({$schema: protocol.OBJECTIVES_SCHEMA_URI, objectives: {}}), true);
        assert.equal(protocol.validateObjectivesDocument({schemaVersion: 1, objectives: {}}), false);
        const legacy = JSON.stringify({
          schemaVersion: 1, domainSchema: {type: "object"},
          levels: [{id:"initial",advancement:{checks:[]}}],
          defaultLanguage:"en-US",languages:["en-US"]
        });
        writeFileSync("legacy-objective.json", legacy);
        const {execFileSync} = await import("node:child_process");
        const {fileURLToPath} = await import("node:url");
        const migration = fileURLToPath(new URL("./migrate-cli.js", import.meta.resolve("@potential-guide/pilot-protocol")));
        const migrationArgs = [migration,"--format","manifest","--input","legacy-objective.json","--output","objective.json","--attainment-levels","ready"];
        execFileSync(process.execPath,migrationArgs,{stdio:"pipe"});
        assert.equal(protocol.parseManifest(readFileSync("objective.json","utf8")).$schema,protocol.OBJECTIVE_SCHEMA_URI);
        assert.equal(readFileSync("legacy-objective.json","utf8"),legacy);
        assert.throws(()=>execFileSync(process.execPath,migrationArgs,{stdio:"pipe"}),/EEXIST/);
        assert.equal(protocol.observe, undefined);
      `,
      );
      await run(process.execPath, [script], directory);
    }
    const binaries = join(directory, "node_modules", ".bin");
    const toolchain = join(directory, "toolchain");
    await mkdir(toolchain);
    await writeFile(
      join(toolchain, process.platform === "win32" ? "node.cmd" : "node"),
      process.platform === "win32"
        ? `@"${process.execPath}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "$@"\n`,
      { mode: 0o755 },
    );
    if (process.platform !== "win32") {
      for (const name of ["dirname", "sed", "uname", "readlink", "realpath"]) {
        const source = (process.env.PATH ?? "")
          .split(delimiter)
          .filter((path) => isAbsolute(path))
          .map((path) => join(path, name))
          .find(existsSync);
        if (["dirname", "sed", "uname"].includes(name))
          assert.ok(source, `Missing shim utility: ${name}`);
        if (source) await symlink(source, join(toolchain, name));
      }
    }
    const env = {
      ...process.env,
      HOME: join(directory, "user"),
      APPDATA: join(directory, "user"),
      XDG_CONFIG_HOME: join(directory, "user"),
      PATH: [binaries, toolchain].join(delimiter),
    };
    for (const definition of definitions.filter(({ name }) => entries.includes(name))) {
      const manifest = manifests.get(definition.name);
      if (manifest.pguide?.settings) {
        const installed = join(directory, "node_modules", definition.name);
        const description = JSON.parse(
          await readFile(join(installed, manifest.pguide.settings), "utf8"),
        );
        assert.equal(description.schemaVersion, 1);
        assert.ok(
          Object.keys(description.settings).every((id) =>
            id.startsWith(`${description.namespace}.`),
          ),
        );
      }
      for (const bin of definition.bins ?? []) {
        const executable = join(binaries, process.platform === "win32" ? `${bin}.cmd` : bin);
        assert.ok(existsSync(executable), `Missing installed executable: ${bin}`);
        if (discoveryHostBins.includes(bin)) continue;
        const result = JSON.parse(
          await run(executable, ["--help", "--format", "json"], directory, env),
        );
        assert.equal(result.schemaVersion, 1);
      }
      if (label === "main") {
        const executable = join(binaries, process.platform === "win32" ? "pguide.cmd" : "pguide");
        const result = JSON.parse(
          await run(executable, ["--help", "--format", "json"], directory, env),
        );
        assert.deepEqual(result.commands.map((entry) => entry.command).sort(), [
          "agents",
          "complete",
          "config",
          "diagnose",
          "objectives",
          "probe",
          "scaffold",
          "validate",
        ]);
        assert.deepEqual(result.conflicts, {});
        for (const command of ["probe", "scaffold", "validate", "config", "agents", "objectives"]) {
          const entry = result.commands.find((entry) => entry.command === command);
          assert.equal(entry.compatible, true);
          assert.equal(entry.source, "bundled");
          const dispatched = JSON.parse(
            await run(executable, [command, "--help", "--format", "json"], directory, env),
          );
          assert.equal(dispatched.command, command);
        }
        const configured = JSON.parse(
          await run(executable, ["config", "path", "--format", "json"], directory, env),
        );
        assert.equal(configured.schemaVersion, 1);
        assert.ok(configured.paths.user.endsWith("config.jsonc"));
        const extension = join(directory, "static-settings");
        await mkdir(extension);
        await writeFile(
          join(extension, "package.json"),
          JSON.stringify({
            name: "@fixture/static-settings",
            pguide: { settings: "./settings.json" },
            main: "./never-run.cjs",
          }),
        );
        await writeFile(
          join(extension, "never-run.cjs"),
          "throw new Error('settings must not execute packages');",
        );
        await writeFile(
          join(extension, "settings.json"),
          JSON.stringify({
            schemaVersion: 1,
            namespace: "fixture",
            settings: {
              "fixture.value": {
                description: "Packed extension",
                schema: { type: "integer" },
                default: 2,
              },
            },
          }),
        );
        await run(
          executable,
          ["config", "packages", "register", extension, "--format", "json"],
          directory,
          env,
        );
        const effective = JSON.parse(
          await run(executable, ["config", "show", "--format", "json"], directory, env),
        );
        assert.equal(effective.config["fixture.value"], 2);
        assert.equal(effective.sources["fixture.value"], "default:@fixture/static-settings");
        await run(
          executable,
          ["config", "set", "fixture.value", "4", "--scope", "project", "--format", "json"],
          directory,
          env,
        );
        const directConfig = result.commands.find(({ command }) => command === "config").path;
        const directValue = JSON.parse(
          await run(
            process.execPath,
            [directConfig, "get", "fixture.value", "--format", "json"],
            directory,
            env,
          ),
        );
        assert.equal(directValue.value, 4);
        await run(
          executable,
          ["config", "unset", "fixture.value", "--format", "json"],
          directory,
          env,
        );
        await run(
          executable,
          ["config", "packages", "unregister", extension, "--format", "json"],
          directory,
          env,
        );
        const objective = join(directory, "pilot");
        const scaffolded = JSON.parse(
          await run(
            executable,
            ["scaffold", "pilot", objective, "--format", "json"],
            directory,
            env,
          ),
        );
        assert.equal(scaffolded.schemaVersion, 1);
        const validated = JSON.parse(
          await run(
            executable,
            ["validate", "pilot", objective, "--format", "json"],
            directory,
            env,
          ),
        );
        assert.equal(validated.schemaVersion, 1);
        const declaration = join(directory, "declaration.json");
        await writeFile(
          declaration,
          JSON.stringify({
            $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json",
            objectives: {
              local: {
                description: "Default CLI alias",
                objective,
                inputSchema: { type: "object", maxProperties: 0 },
                subject: "{}",
              },
            },
          }),
        );
        await run(
          executable,
          [
            "objectives",
            "set",
            "local",
            "--scope",
            "user",
            "--from",
            declaration,
            "--format",
            "json",
          ],
          directory,
          env,
        );
        const aliases = JSON.parse(
          await run(
            executable,
            ["objectives", "show", "local", "--scope", "user", "--format", "json"],
            directory,
            env,
          ),
        );
        assert.equal(aliases.objectives[0].name, "local");
        for (const [command, packageName] of [
          ["regulate", "pguide-regulate"],
          ["continue", "pguide-regulate"],
        ]) {
          const missing = JSON.parse(
            await run(executable, [command, "--format", "json"], directory, env, 2),
          );
          assert.ok(missing.error.includes(`Install @potential-guide/${packageName}`));
        }
        for (const name of closure.keys())
          assert.doesNotMatch(
            name,
            /objective-(?:regulator|portfolio)|pguide-(?:regulate|supervise)$/,
          );
      }
    }
    if (label === "combined") {
      // Discover the actual package-manager shims, not fixture wrappers.
      // PATH contains isolated shims, Node and minimal shell utilities, never global extensions.
      const executable = join(binaries, process.platform === "win32" ? "pguide.cmd" : "pguide");
      const result = JSON.parse(
        await run(executable, ["--help", "--format", "json"], directory, env),
      );
      assert.deepEqual(result.conflicts, {});
      for (const name of [
        "agents",
        "objectives",
        "probe",
        "regulate",
        "continue",
        "scaffold",
        "validate",
        "config",
      ]) {
        assert.ok(
          result.commands.some((entry) => entry.command === name && entry.compatible),
          name,
        );
        const dispatched = JSON.parse(
          await run(executable, [name, "--help", "--format", "json"], directory, env),
        );
        assert.equal(dispatched.command, name);
      }
    }
    console.log(
      `isolated ${label}: ${entries.length} selected, ${closure.size} internal packages; packed consumption passed`,
    );
  }
}
