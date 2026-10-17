import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { sameDirectory } from "../src/path.js";
import { fixture, scratch } from "./fixtures.js";

const root = resolve(import.meta.dirname, "..", "..", "..");
const tmpdir = () => scratch;
const top = join(root, "packages", "pguide", "dist", "bin.js");
const bins = {
  probe: join(root, "packages", "pguide", "dist", "bin", "probe.js"),
  regulate: join(root, "packages", "pguide", "dist", "bin", "regulate.js"),
  continue: join(root, "packages", "pguide", "dist", "bin", "continue.js"),
  supervise: join(root, "packages", "pguide", "dist", "bin", "supervise.js"),
  scaffold: join(root, "packages", "pguide", "dist", "bin", "scaffold.js"),
  validate: join(root, "packages", "pguide", "dist", "bin", "validate.js"),
  config: join(root, "packages", "pguide-config", "dist", "bin.js"),
};

function run(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ code: code ?? 70, stdout, stderr }));
  });
}

test("all package commands expose direct protocol metadata and help", async () => {
  for (const [command, script] of Object.entries(bins)) {
    const metadata = await run(script, ["--pguide-command-metadata"]);
    assert.equal(metadata.code, 0, metadata.stderr);
    assert.equal(JSON.parse(metadata.stdout).command, command);
    const help = await run(script, ["--help", "--format", "json"]);
    assert.equal(help.code, 0, `${command}: ${help.stderr}\n${help.stdout}`);
    assert.equal(JSON.parse(help.stdout).schemaVersion, 1);
  }
});

test("top-level built-ins return machine-readable help, diagnosis and completion", async () => {
  const help = await run(top, ["--help", "--format", "json"]);
  assert.equal(help.code, 0, help.stderr);
  assert.equal(JSON.parse(help.stdout).name, "pguide");
  const leadingHelp = await run(top, ["--format", "json", "--help", "probe"]);
  assert.equal(JSON.parse(leadingHelp.stdout).name, "pguide");
  const diagnose = await run(top, ["diagnose", "--format", "json"]);
  assert.equal(diagnose.code, 0, diagnose.stdout);
  const complete = await run(top, ["complete", "--shell", "powershell", "--format", "json"]);
  assert.match(JSON.parse(complete.stdout).script, /Register-ArgumentCompleter/);
});

test("scaffold and static validate preserve multilingual Wiki; production probes require committed snapshots", async () => {
  const f = await fixture();
  try {
    const guide = join(f.repository, "objective");
    const manifest = f.manifest;
    const validate = await run(bins.validate, ["pilot", manifest, "--format", "json"]);
    assert.equal(validate.code, 0, validate.stdout);
    const uncommitted = await run(bins.probe, [
      "--pilot",
      manifest,
      "--subject-file",
      f.subject,
      "--format",
      "json",
    ]);
    assert.equal(uncommitted.code, 2);
    assert.match(uncommitted.stdout, /dirty|uncommitted/);
    const commit = await f.commit();
    const probe = await run(bins.probe, [
      "--pilot",
      manifest,
      "--subject-file",
      f.subject,
      "--language",
      "zh-CN",
      "--format",
      "json",
    ]);
    assert.equal(probe.code, 0, probe.stdout);
    assert.equal(JSON.parse(probe.stdout).status, 200);
    assert.equal(JSON.parse(probe.stdout).payload.current.levelId, "terminal");
    assert.equal(JSON.parse(probe.stdout).payload.versions[f.uri], commit);
    const overviewPath = join(guide, "references", "system", "overview", "en-US.md");
    const overview = await readFile(overviewPath, "utf8");
    assert.match(overview, /references: \[\]/);
    const level = await readFile(
      join(guide, "references", "levels", "initial", "en-US.md"),
      "utf8",
    );
    assert.doesNotMatch(level, /\noutcome:/);
    assert.match(level, /---\n\nTODO: describe advancement\./);
    for (const invalid of [
      overview.replace(/description: .*/, 'description: ""'),
      overview.replace(/description: .*/, `description: ${"a".repeat(201)}`),
      overview.replace(/\ndescription: .*/, ""),
      overview.replace("references: []", "references: [pages/missing]"),
    ]) {
      await writeFile(overviewPath, invalid);
      const rejected = await run(bins.validate, ["pilot", manifest, "--format", "json"]);
      assert.equal(rejected.code, 2, rejected.stdout);
      assert.match(rejected.stdout, /pilot-error/);
    }
    await writeFile(overviewPath, overview.replace("\nreferences: []", ""));
    const withoutReferences = await run(bins.validate, ["pilot", manifest, "--format", "json"]);
    assert.equal(withoutReferences.code, 0, withoutReferences.stdout);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("top-level safely dispatches discovered commands and preserves arguments", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "pguide-dispatch-"));
  try {
    const extension = process.platform === "win32" ? ".cmd" : "";
    const commandPath = join(temporary, `pguide-echo${extension}`);
    const fixture = join(temporary, "fixture.mjs");
    await writeFile(
      fixture,
      `if(process.argv[2]==="--pguide-command-metadata")console.log(JSON.stringify({protocol:"pguide-command-v1",command:"echo",description:"fixture",version:"1"}));else console.log(JSON.stringify(process.argv.slice(2)));`,
    );
    await writeFile(
      commandPath,
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`,
      { mode: 0o755 },
    );
    const env = { ...process.env, PATH: `${temporary}${delimiter}${process.env.PATH ?? ""}` };
    const literalArguments = ["one", "a&b", "x|y", "%PATH%", "$(echo nope)", 'say"hello'];
    const dispatched = await run(
      top,
      ["echo", ...literalArguments, "--", "--format", "literal"],
      env,
    );
    assert.equal(dispatched.code, 0, dispatched.stderr);
    assert.deepEqual(JSON.parse(dispatched.stdout), [
      ...literalArguments,
      "--cwd",
      root,
      "--format",
      "markdown",
      "--color",
      "auto",
      "--log-level",
      "warn",
      "--",
      "--format",
      "literal",
    ]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("real-path deduplication follows platform case sensitivity", {
  skip: process.platform === "win32",
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "pguide-case-dedupe-"));
  try {
    const lower = join(temporary, "commands");
    const upper = join(temporary, "COMMANDS");
    await Promise.all([
      import("node:fs/promises").then(({ mkdir }) => mkdir(lower)),
      import("node:fs/promises").then(({ mkdir }) => mkdir(upper)),
    ]);
    for (const directory of [lower, upper]) {
      await writeFile(
        join(directory, "pguide-case"),
        `#!/bin/sh\nif [ "$1" = "--pguide-command-metadata" ]; then echo '{"protocol":"pguide-command-v1","command":"case","description":"fixture","version":"1"}'; fi\n`,
        { mode: 0o755 },
      );
    }
    const config = join(temporary, "config.yaml");
    await writeFile(
      config,
      `schemaVersion: 2\ncommandDirectories:\n  - ${JSON.stringify(lower)}\n  - ${JSON.stringify(upper)}\n`,
    );
    const help = await run(top, ["--config", config, "--help", "--format", "json"]);
    assert.equal(help.code, 0, help.stderr);
    assert.equal(JSON.parse(help.stdout).conflicts.case.length, 2);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Windows cwd exclusion canonicalizes aliases and casing", async () => {
  const aliases = new Map([
    ["C:\\PROGRA~1\\Guide", "C:\\Program Files\\Guide"],
    ["c:\\program files\\guide", "C:\\Program Files\\Guide"],
  ]);
  const canonicalize = async (path: string) => aliases.get(path) ?? path;
  assert.equal(
    await sameDirectory("C:\\PROGRA~1\\Guide", "c:\\program files\\guide", "win32", canonicalize),
    true,
  );
  assert.equal(await sameDirectory("C:\\Guide\\bin", "C:\\Guide", "win32", canonicalize), false);
});

test("all official commands dispatch through the top-level CLI", async () => {
  const binDirectory = await mkdtemp(join(tmpdir(), "pguide-official-bins-"));
  try {
    const extension = process.platform === "win32" ? ".cmd" : "";
    for (const [command, script] of Object.entries(bins)) {
      const commandPath = join(binDirectory, `pguide-${command}${extension}`);
      await writeFile(
        commandPath,
        process.platform === "win32"
          ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
          : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
        { mode: 0o755 },
      );
    }
    const config = join(binDirectory, "config.yaml");
    await writeFile(
      config,
      `schemaVersion: 2\ncommandDirectories:\n  - ${JSON.stringify(binDirectory)}\n`,
    );
    const env = { ...process.env, PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}` };
    for (const command of Object.keys(bins)) {
      const result = await run(
        top,
        command === "probe"
          ? ["--config", config, "--format", "json", command, "--help"]
          : ["--config", config, command, "--help", "--format", "json"],
        env,
      );
      assert.equal(result.code, 0, `${command}: ${result.stderr}\n${result.stdout}`);
      assert.equal(JSON.parse(result.stdout).command, command);
    }
  } finally {
    await rm(binDirectory, { recursive: true, force: true });
  }
});
