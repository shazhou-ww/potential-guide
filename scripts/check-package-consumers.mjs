import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyConsumerGraph } from "./deployment-consumer.mjs";

export async function checkPackageConsumers(root, scratch, definitions, tarballs, run) {
  const manifests = new Map();
  for (const { name, directory } of definitions) {
    manifests.set(
      name,
      JSON.parse(await readFile(join(root, "packages", directory, "package.json"), "utf8")),
    );
  }
  const scenarios = [
    ["protocol", ["@potential-guide/pilot-protocol"]],
    ["main", ["pguide"]],
    ["pilot", ["@potential-guide/pguide-pilot"]],
    ["regulation", ["@potential-guide/pguide-regulate"]],
    ["supervision", ["@potential-guide/pguide-supervise"]],
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
        "@potential-guide/pguide-supervise",
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
    const closure = new Map();
    function visit(name) {
      if (closure.has(name)) return;
      const manifest = manifests.get(name);
      closure.set(name, manifest.version);
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        if (manifests.has(dependency)) visit(dependency);
      }
    }
    for (const entry of entries) visit(entry);
    await verifyConsumerGraph(directory, closure, entries);
    if (label === "coordinator") {
      await writeFile(
        join(directory, "api.ts"),
        `
        import { Effect, Stream, SubscriptionRef } from "@potential-guide/effects";
        import { regulationCoordinator, type AgentResource, type CoordinatorCommand, type CoordinatorOptions } from "@potential-guide/regulation-coordinator";
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
          'import { regulationCoordinator } from "@potential-guide/regulation-coordinator"; if (typeof regulationCoordinator !== "function") throw new Error("Missing coordinator export");',
        ],
        directory,
      );
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
          ["supervise", "pguide-supervise"],
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
        "supervise",
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
