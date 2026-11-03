import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { bin, root, run, scratch } from "./fixtures.js";

test("retired Hosts have no package, workspace importer or release entry", async () => {
  const lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
  const releases = await readFile(join(root, "scripts", "release-packages.mjs"), "utf8");
  for (const id of ["check-host", "objective-host"]) {
    await assert.rejects(access(join(root, "packages", id, "package.json")));
    assert.ok(!lock.includes(`packages/${id}:`));
    assert.ok(!releases.includes(`directory: "${id}"`));
  }
});

test("artifact validation reports its local-only scope without resolving external Checks", async (t) => {
  const directory = await mkdtemp(join(scratch, "retired-static-validate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { buildExample } = await import(
    pathToFileURL(
      join(root, "packages", "cli-runtime", "examples", "objective-artifact", "build.mjs"),
    ).href
  );
  const built = await buildExample(join(directory, "delivery"));
  const result = await run(bin("validate"), [
    "artifact",
    built.directory,
    "--cwd",
    directory,
    "--format",
    "json",
  ]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    status: "valid",
    objectiveId: "objective:composition",
    artifactDigest: built.digest,
    validationScope: "local-artifact",
  });
});

test("standalone and dispatched execution reject before touching state, reports or Agent configuration", async (t) => {
  const directory = await mkdtemp(join(scratch, "host-retired-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = join(directory, "state", "regulations", "existing");
  await mkdir(state, { recursive: true });
  const record = join(state, "regulation.json");
  const original = '{"legacy":"must remain unchanged","expiresAt":"2000-01-01T00:00:00.000Z"}\n';
  await writeFile(record, original);
  await mkdir(join(directory, ".pguide"));
  const commands = join(directory, "commands");
  await mkdir(commands);
  for (const command of ["regulate", "continue"]) {
    await writeFile(
      join(commands, `pguide-${command}${process.platform === "win32" ? ".cmd" : ""}`),
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${bin(command)}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${bin(command)}" "$@"\n`,
      { mode: 0o755 },
    );
  }
  await writeFile(
    join(directory, ".pguide", "config.jsonc"),
    JSON.stringify({
      "cli-core.stateDirectory": join(directory, "state"),
      "pguide.commandDirectories": [commands],
    }),
  );
  await writeFile(join(directory, ".pguide", "agents.yaml"), "invalid Agent configuration");
  const before = (await readdir(directory)).sort();
  for (const command of ["probe", "regulate", "continue"]) {
    const args = command === "continue" ? ["existing"] : ["--pilot", "must-not-resolve"];
    for (const format of ["json", "markdown"]) {
      for (const dispatched of [false, true]) {
        const result = await run(
          dispatched ? join(root, "packages", "pguide", "dist", "bin.js") : bin(command),
          [...(dispatched ? [command] : []), ...args, "--cwd", directory, "--format", format],
          { ...process.env, PATH: "" },
        );
        assert.equal(result.code, 2, result.stdout + result.stderr);
        assert.match(result.stdout + result.stderr, /Legacy Pilot execution is retired/);
        if (format === "json") {
          const error = JSON.parse(result.stdout);
          assert.equal(error.status, "pilot-error");
          assert.equal(error.schemaVersion, 1);
        }
      }
    }
  }
  assert.equal(await readFile(record, "utf8"), original);
  assert.deepEqual((await readdir(directory)).sort(), before);
});
