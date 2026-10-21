import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseReleaseTag, releasePackages, releaseVersion } from "./release-packages.mjs";

test("release inventory contains the new packages and excludes the retired Guide", () => {
  assert.equal(releasePackages.length, 17);
  for (const field of ["id", "directory", "name"]) {
    assert.equal(new Set(releasePackages.map((entry) => entry[field])).size, 17);
  }
  for (const name of [
    "@potential-guide/effects",
    "@potential-guide/git-source",
    "@potential-guide/objective-pilot",
    "@potential-guide/regulation-coordinator",
  ]) {
    assert.ok(releasePackages.some((entry) => entry.name === name));
  }
  assert.ok(!releasePackages.some(({ id }) => id === "objective-guide"));
});

test("package-specific RC tags preserve package identity and never select latest", () => {
  for (const entry of releasePackages) {
    const parsed = parseReleaseTag(`${entry.id}-v0.3.0-rc.12`);
    assert.equal(parsed.name, entry.name);
    assert.equal(parsed.directory, entry.directory);
    assert.equal(parsed.version, "0.3.0-rc.12");
    assert.equal(parsed.distTag, "rc");
  }
  assert.equal(parseReleaseTag("pguide-v0.3.0").distTag, "latest");
});

test("command wrappers use pguide-prefixed names including config", () => {
  for (const id of [
    "pguide-pilot",
    "pguide-regulate",
    "pguide-supervise",
    "pguide-objectives",
    "pguide-config",
    "pguide-agents",
  ]) {
    const entry = releasePackages.find((entry) => entry.id === id);
    assert.equal(entry?.name, `@potential-guide/${id}`);
    assert.equal(entry?.directory, id);
  }
  const config = releasePackages.find((entry) => entry.id === "pguide-config");
  assert.equal(config.name, "@potential-guide/pguide-config");
  assert.deepEqual(config.bins, ["pguide-config"]);
});

test("release metadata rejects 1.0, malformed SemVer, unknown packages and retired tags", () => {
  for (const version of [
    "1.0.0",
    "1.0.0-rc.0",
    "0.03.0-rc.0",
    "0.3.00-rc.0",
    "0.3.0-rc.01",
    "0.3.0-beta.0",
    "0.3.0-rc.-1",
    "0.3.0-rc.0-extra",
  ]) {
    assert.equal(releaseVersion.test(version), false, version);
    assert.throws(() => parseReleaseTag(`pguide-v${version}`));
  }
  assert.throws(() => parseReleaseTag("objective-guide-v0.3.0-rc.0"));
  assert.throws(() => parseReleaseTag("unknown-v0.3.0-rc.0"));
  assert.throws(() => parseReleaseTag("config-v0.3.0-rc.0"));
});

test("publication workflow covers the inventory and its embedded scripts compile", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/publish-npm.yaml", import.meta.url),
    "utf8",
  );
  assert.ok(workflow.includes("./scripts/release-packages.mjs"));
  const dispatchPackages =
    workflow.match(/ {6}package:\r?\n([\s\S]*?)^ {6}mode:/m)?.[1].split(/\r?\n/) ?? [];
  for (const { id } of releasePackages) {
    assert.ok(workflow.includes(`"${id}-v*"`), `Missing release trigger: ${id}`);
    assert.ok(dispatchPackages.includes(`          - ${id}`), `Missing dispatch choice: ${id}`);
  }
  assert.ok(!workflow.includes('"objective-guide-v*"'));
  const scripts = [
    ...workflow.matchAll(/node --input-type=(module|commonjs) <<'NODE'\r?\n([\s\S]*?)^\s+NODE$/gmu),
  ];
  assert.ok(scripts.length >= 4);
  for (const [, type, source] of scripts) {
    const result = spawnSync(process.execPath, ["--check", `--input-type=${type}`], {
      input: source,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }
});
