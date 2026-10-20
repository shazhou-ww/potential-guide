import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { bin, fixture, root, run } from "./fixtures.js";

test("probe accepts piped JSON through direct and dispatched commands with Registered Objectives", async () => {
  const f = await fixture();
  try {
    const commit = await f.commit();
    const commands = join(f.directory, "commands");
    await mkdir(commands);
    await writeFile(
      join(commands, `pguide-probe${process.platform === "win32" ? ".cmd" : ""}`),
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${bin("probe")}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${bin("probe")}" "$@"\n`,
      { mode: 0o755 },
    );
    const config = join(f.directory, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        objectives: { remote: f.uri, local: f.manifest },
        commandDirectories: [commands],
      }),
    );
    for (const script of [bin("probe"), join(root, "packages", "pguide", "dist", "bin.js")]) {
      for (const objective of ["remote", "@remote", "local"]) {
        for (const subjectArgs of [[], ["--subject-file", "-"], ["--subject-file", f.subject]]) {
          const result = await run(
            script,
            [
              ...(script === bin("probe") ? [] : ["probe"]),
              "--pilot",
              objective,
              "--revision",
              commit,
              ...subjectArgs,
              "--config",
              config,
              "--format",
              "json",
            ],
            process.env,
            "{}",
          );
          assert.equal(result.code, 0, result.stdout + result.stderr);
          assert.equal(JSON.parse(result.stdout).payload.versions[f.uri], commit);
        }
      }
    }
    for (const input of ["", "{", "[]", "null", '"text"', "1", "{}\n{}"]) {
      const result = await run(
        bin("probe"),
        ["--pilot", "@remote", "--config", config, "--format", "json"],
        process.env,
        input,
      );
      assert.equal(result.code, 2, result.stdout);
      assert.match(JSON.parse(result.stdout).error, /Subject must be/);
    }
    const unknown = await run(
      bin("probe"),
      ["--pilot", "@missing", "--config", config, "--format", "json"],
      process.env,
      "{}",
    );
    assert.equal(unknown.code, 2);
    assert.match(unknown.stdout, /Unknown registered Objective/);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("regulate persists the resolved source and piped subject; continue ignores changed objectives", async () => {
  const f = await fixture();
  try {
    const commit = await f.commit();
    const config = join(f.directory, "config.json");
    const state = join(f.directory, "state");
    const value = {
      schemaVersion: 2,
      objectives: { local: f.manifest },
      defaultAgent: "unused",
      stateDirectory: state,
      agents: {
        unused: {
          type: "acp",
          connection: { protocolVersion: "1" },
          transport: { type: "stdio", command: "must-not-run" },
        },
      },
    };
    await writeFile(config, JSON.stringify(value));
    const subject = { name: "piped", nested: { values: [1, 2], enabled: true } };
    for (const subjectArgs of [[], ["--subject-file", "-"]]) {
      const result = await run(
        bin("regulate"),
        [
          "--pilot",
          "@local",
          ...subjectArgs,
          "--target",
          "terminal",
          "--config",
          config,
          "--format",
          "json",
        ],
        process.env,
        JSON.stringify(subject),
      );
      assert.equal(result.code, 0, result.stdout + result.stderr);
      const id = JSON.parse(result.stdout).regulationId;
      const persisted = JSON.parse(
        await readFile(join(state, "regulations", id, "regulation.json"), "utf8"),
      );
      assert.deepEqual(persisted.subject, subject);
      assert.equal(persisted.pilotUri, f.uri);
      assert.equal(persisted.pilotCommit, commit);
      assert.equal(persisted.sourcePath, f.manifest);
      await writeFile(config, JSON.stringify({ ...value, objectives: { local: "missing" } }));
      const continued = await run(bin("continue"), [id, "--config", config, "--format", "json"]);
      assert.equal(continued.code, 0, continued.stdout + continued.stderr);
      await writeFile(config, JSON.stringify(value));
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
