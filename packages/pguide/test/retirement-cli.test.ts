import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commandPackages, loadSettingsCatalog } from "@potential-guide/cli-core";
import { root, run } from "./fixtures.js";

const pguide = join(root, "packages", "pguide", "dist", "bin.js");
const env = { ...process.env, PATH: "" };

test("retired Supervisor packages have no workspace, settings or built-in command", async () => {
  for (const id of ["objective-portfolio-supervisor", "pguide-supervise"]) {
    await assert.rejects(access(join(root, "packages", id, "package.json")));
    const lockfile = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
    assert.ok(!lockfile.includes(`packages/${id}:`));
  }
  assert.ok(!Object.hasOwn(commandPackages, "supervise"));
  const catalog = await loadSettingsCatalog();
  assert.ok(![...catalog.settings.keys()].some((key) => key.startsWith("supervise.")));
});

test("supervise is unknown rather than redirected or recommended for installation", async () => {
  for (const format of ["json", "markdown"]) {
    const result = await run(pguide, ["supervise", "--format", format], env);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /Unknown command.*supervise/u);
    assert.doesNotMatch(result.stdout + result.stderr, /pguide-supervise|pnpm add|npm install/u);
  }
});

test("root help and every completion shell omit the retired command", async () => {
  const help = await run(pguide, ["--help"], env);
  assert.equal(help.code, 0, help.stdout + help.stderr);
  assert.doesNotMatch(help.stdout, /supervise|portfolio/iu);
  for (const shell of ["bash", "zsh", "fish", "powershell"]) {
    const completion = await run(pguide, ["complete", "--shell", shell], env);
    assert.equal(completion.code, 0, completion.stdout + completion.stderr);
    assert.doesNotMatch(completion.stdout, /supervise/u);
    assert.match(completion.stdout, /regulate/u);
  }
});

test("retired Pilot commands have no package, descriptor, help entry or installation recommendation", async () => {
  for (const id of ["pguide-pilot", "pguide-probe", "pguide-check"])
    await assert.rejects(access(join(root, "packages", id, "package.json")), { code: "ENOENT" });
  const catalog = await loadSettingsCatalog();
  assert.ok(![...catalog.settings.keys()].some((key) => key.startsWith("pilot.")));
  const help = await run(pguide, ["--help", "--format", "json"], env);
  assert.equal(help.code, 0, help.stdout + help.stderr);
  assert.deepEqual(
    JSON.parse(help.stdout)
      .commands.map(({ command }: { command: string }) => command)
      .sort(),
    ["agents", "complete", "config", "diagnose", "objectives"],
  );
  for (const command of ["probe", "check", "validate", "scaffold"]) {
    assert.ok(!Object.hasOwn(commandPackages, command));
    const rejected = await run(pguide, [command, "--format", "json"], env);
    assert.equal(rejected.code, 2, rejected.stdout + rejected.stderr);
    assert.match(JSON.parse(rejected.stdout).error, new RegExp(`Unknown command.*${command}`));
    assert.doesNotMatch(rejected.stdout + rejected.stderr, /Install|pguide-pilot/);
  }
  for (const shell of ["bash", "zsh", "fish", "powershell"]) {
    const completion = await run(pguide, ["complete", "--shell", shell], env);
    assert.equal(completion.code, 0, completion.stdout + completion.stderr);
    assert.doesNotMatch(completion.stdout, /\b(?:probe|check|validate|scaffold)\b/);
  }
});
