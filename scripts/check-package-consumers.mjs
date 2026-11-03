import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkMvpConsumer } from "./check-mvp-consumer.mjs";
import { checkTaskBundleConsumer } from "./check-task-bundle-consumer.mjs";
import { checkTaskSdkConsumer } from "./check-task-sdk-consumer.mjs";
import { consumerVersions, verifyConsumerGraph } from "./deployment-consumer.mjs";

export async function checkPackageConsumers(root, scratch, definitions, tarballs, run, only) {
  const manifests = new Map();
  for (const { name, directory } of definitions) {
    manifests.set(
      name,
      JSON.parse(await readFile(join(root, "packages", directory, "package.json"), "utf8")),
    );
  }
  const scenarios = [
    [
      "task-sdk",
      [
        "@potential-guide/task-sdk",
        "@potential-guide/task-protocol",
        "@potential-guide/ipfs-content",
      ],
    ],
    [
      "probe-task",
      [
        "@potential-guide/probe-task",
        "@potential-guide/check-task",
        "@potential-guide/check-artifacts",
        "@potential-guide/task-engine",
        "@potential-guide/task-engine-server",
        "@potential-guide/task-protocol",
        "@potential-guide/task-sdk",
        "@potential-guide/task-engine-http",
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
        "@potential-guide/task-sdk",
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
        "@potential-guide/cli-runtime",
        "@potential-guide/check-runtime-files",
        "@potential-guide/pilot-protocol",
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
  if (!only) await checkTaskBundleConsumer(scratch, tarballs, manifests, run);
  for (const [label, entries] of scenarios) {
    if (only && label !== only) continue;
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
      for (const filename of [
        "probe-config.mjs",
        "probe-integration.mjs",
        "echo-config.mjs",
        "echo-type.mjs",
        "build-bundles.mjs",
      ])
        await writeFile(
          join(directory, filename),
          await readFile(join(root, "examples", "task-server", filename)),
        );
      console.log(await run(process.execPath, ["probe-integration.mjs"], directory));
    }
    if (label === "artifact-contracts" || label.startsWith("mvp-"))
      await checkMvpConsumer(root, directory, label, graph, run);
    if (label === "task-sdk") {
      await checkTaskSdkConsumer(directory, run);
    }
    if (label.startsWith("task-") && label !== "task-sdk") {
      const script = join(directory, "generic-task.mjs");
      await writeFile(
        join(directory, "type-worker.mjs"),
        `export default async function echo(input){return input}`,
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
import {MemoryIpfsClient,MemoryStore} from "@potential-guide/task-engine/testing";
import {readFile} from "node:fs/promises";
const binding=JSON.parse(await readFile(${JSON.stringify(join(scratch, "task-sdk", "fixture", "binding.json"))},"utf8"));
const bundle=binding.cid;
const ipfsClient=new MemoryIpfsClient();
for(const [cid,hex] of JSON.parse(await readFile(${JSON.stringify(join(scratch, "task-sdk", "fixture", "blocks.json"))},"utf8")))ipfsClient.blocks.set(cid,Buffer.from(hex,"hex"));
${
  label === "task-adapters"
    ? `
import {openSqliteStore} from "@potential-guide/task-engine-storage";
import {createTaskHandler} from "@potential-guide/task-engine-http";
const store=openSqliteStore("consumer.sqlite");
`
    : "const store=new MemoryStore();"
}
const engine=createTaskEngine({store,ipfsClient,authorize:()=>true});
await engine.start();
const caller={scope:"consumer",subject:"fixture"};
let decision=await engine.submit({requestId:newId(),bundle,text:"packed",timeoutMs:10000},caller);
while(decision.status==="preparing")decision=await engine.getRequestStatus(decision.requestId,{waitMs:1000},caller);
assert.equal(decision.status,"accepted");const task=engine.getTask(decision.taskId,caller);
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
    if (label === "npm-objectives") {
      const script = join(directory, "static-objectives.mjs");
      await writeFile(
        script,
        `
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {dirname,join,resolve} from "node:path";
import {readFile} from "node:fs/promises";
import {prepareObjectivePackage,withPilot} from "@potential-guide/cli-runtime";
import {readArtifact} from "@potential-guide/check-runtime-files";
import {parseManifest} from "@potential-guide/pilot-protocol";
const require=createRequire(import.meta.url);
const origins=${JSON.stringify(Object.fromEntries(tarballs))};
const names=${JSON.stringify(definitions.filter((entry) => entry.objective).map((entry) => entry.name))};
let count=0;
for(const name of names){
 const source=dirname(require.resolve(name+"/objective.yaml"));
 const options={cacheDirectory:resolve(".cache","packages")};
 const prepared=await prepareObjectivePackage(source,process.cwd(),options);
 const exact=await prepareObjectivePackage(origins[name],process.cwd(),options);
 assert.equal(prepared.source.packageName,name);
 assert.equal(prepared.source.packageDigest,exact.source.packageDigest);
 const manifest=parseManifest(await readFile(join(prepared.directory,"objective.yaml"),"utf8"));
 for(const level of manifest.levels)for(const check of level.checks){
  assert.match((await readArtifact(join(prepared.directory,"checks",check.id))).revision,/^[a-f0-9]{64}$/);
  count++;
 }
 await assert.rejects(withPilot(source,process.cwd(),undefined,async()=>assert.fail("Legacy execution must not run")),/Legacy Pilot execution is retired/);
}
assert.equal(count,16);
`,
      );
      await run(process.execPath, [script], directory);
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
