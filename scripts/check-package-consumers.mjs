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
    ["objectives", ["@potential-guide/pguide-objectives"]],
    ["config", ["@potential-guide/config"]],
    [
      "combined",
      [
        "pguide",
        "@potential-guide/pguide-pilot",
        "@potential-guide/pguide-regulate",
        "@potential-guide/pguide-supervise",
        "@potential-guide/pguide-objectives",
        "@potential-guide/config",
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
        "--offline",
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
    if (label === "protocol" || label === "main") {
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
        assert.ok(result.commands.every((entry) => entry.builtIn));
        const missing = JSON.parse(
          await run(executable, ["probe", "--format", "json"], directory, env, 2),
        );
        assert.match(missing.error, /Install @potential-guide\/pguide-pilot/);
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
      `isolated ${label}: ${entries.length} selected, ${closure.size} internal packages; offline packed consumption passed`,
    );
  }
}
