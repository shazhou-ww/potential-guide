import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseReleaseTag,
  releasePackageDirectory,
  releasePackages,
  releaseVersion,
  taskEngineReleaseIds,
  verificationPackages,
} from "./release-packages.mjs";

test("local verification covers the internal runtime dependency closure without expanding release tags", async () => {
  const names = new Set(verificationPackages.map(({ name }) => name));
  assert.equal(names.size, verificationPackages.length);
  for (const { directory, workspace } of verificationPackages) {
    const manifest = JSON.parse(
      await readFile(
        new URL(`../${workspace ?? "packages"}/${directory}/package.json`, import.meta.url),
        "utf8",
      ),
    );
    for (const [name, range] of Object.entries({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })) {
      if (range.startsWith("workspace:"))
        assert.ok(names.has(name), `${manifest.name} needs a local verification pack for ${name}`);
    }
  }
  for (const id of [
    "check-runtime-files",
    "check-artifacts",
    "check-task",
    "probe-task",
    "check-environment",
  ]) {
    assert.ok(verificationPackages.some((entry) => entry.id === id));
    assert.throws(() => parseReleaseTag(`${id}-v0.1.0`), /Unsupported package/);
  }
});

test("release inventory contains the new packages and excludes retired Guide and Supervisor", () => {
  assert.equal(releasePackages.length, 30);
  for (const field of ["id", "directory", "name"]) {
    assert.equal(new Set(releasePackages.map((entry) => entry[field])).size, 30);
  }
  for (const name of [
    "@potential-guide/pguide-task-bundle",
    "@potential-guide/task-protocol",
    "@potential-guide/task-engine",
    "@potential-guide/task-engine-http",
    "@potential-guide/task-engine-storage",
    "@potential-guide/task-sdk",
    "@potential-guide/task-engine-server",
    "@potential-guide/task-engine-webui",
    "@potential-guide/pguide-task-engine",
    "@potential-guide/effects",
    "@potential-guide/git-source",
    "@potential-guide/objective-pilot",
    "@potential-guide/regulation-coordinator",
  ]) {
    assert.ok(releasePackages.some((entry) => entry.name === name));
  }
  assert.ok(!releasePackages.some(({ id }) => id === "objective-guide"));
  for (const id of [
    "checker-host",
    "objective-host",
    "objective-portfolio-supervisor",
    "pguide-supervise",
    "artifact-files",
  ]) {
    assert.ok(!releasePackages.some((entry) => entry.id === id));
    assert.throws(() => parseReleaseTag(`${id}-v0.3.0-rc.0`), /Unsupported package/);
  }
});

test("generic Task Engine products have an exact public ten-package runtime release closure", async () => {
  const expected = [
    "cli-core",
    "task-protocol",
    "task-sdk",
    "task-engine-http",
    "task-engine-storage",
    "task-engine-webui",
    "pguide-task-bundle",
    "task-engine",
    "task-engine-server",
    "pguide-task-engine",
  ];
  assert.deepEqual(taskEngineReleaseIds, expected);
  const entries = new Map(verificationPackages.map((entry) => [entry.name, entry]));
  const manifests = new Map(
    await Promise.all(
      verificationPackages.map(async (entry) => [
        entry.name,
        JSON.parse(
          await readFile(
            new URL(
              `../${releasePackageDirectory(entry).replaceAll("\\", "/")}/package.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      ]),
    ),
  );
  const visited = new Set();
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const entry = entries.get(name);
    assert.ok(entry, `Missing runtime verification entry: ${name}`);
    assert.ok(
      taskEngineReleaseIds.includes(entry.id),
      `Generic Task Engine runtime closure must not install ${name}; migrate production dependencies before release.`,
    );
    assert.ok(releasePackages.includes(entry), `Missing product release route for ${name}`);
    const manifest = manifests.get(name);
    assert.notEqual(manifest.private, true, `${name} must be public`);
    for (const [dependency, range] of Object.entries({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })) {
      if (range.startsWith("workspace:")) {
        assert.ok(entries.has(dependency), `Missing workspace runtime dependency ${dependency}`);
      }
      if (entries.has(dependency)) visit(dependency);
    }
  }
  visit("@potential-guide/pguide-task-bundle");
  visit("@potential-guide/pguide-task-engine");
  assert.deepEqual([...visited].sort(), expected.map((id) => `@potential-guide/${id}`).sort());
});

test("Artifact Files has no workspace, verification pack, release route or active registration", async () => {
  await assert.rejects(access(new URL("../packages/artifact-files", import.meta.url)), {
    code: "ENOENT",
  });
  assert.ok(!verificationPackages.some(({ id }) => id === "artifact-files"));
  assert.throws(() => parseReleaseTag("artifact-files-v0.1.0-rc.0"), /Unsupported package/);
  for (const file of [
    "../tsconfig.json",
    "../package-layers.yaml",
    "../objectives.yaml",
    "../.github/workflows/publish-npm.yaml",
  ])
    assert.ok(!(await readFile(new URL(file, import.meta.url), "utf8")).includes("artifact-files"));
});

test("release and bootstrap paths resolve both apps and default package workspaces", async () => {
  for (const entry of releasePackages) {
    const relative = releasePackageDirectory(entry);
    assert.equal(relative, join(entry.workspace ?? "packages", entry.directory));
    const manifest = JSON.parse(
      await readFile(
        new URL(`../${relative.replaceAll("\\", "/")}/package.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(manifest.name, entry.name);
  }
  assert.deepEqual(
    releasePackages
      .filter(({ workspace }) => workspace === "apps")
      .map(({ id }) => id)
      .sort(),
    ["pguide-task-engine", "task-engine-webui"],
  );
  const bootstrap = await readFile(
    new URL("./create-npm-bootstrap-packages.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(bootstrap.includes("releasePackageDirectory(entry)"));
  assert.ok(bootstrap.includes("join(temporaryRoot, entry.id)"));
  assert.ok(!bootstrap.includes('join(root, "packages",'));
});

test("Task SDK is runtime-only and author tools do not install legacy Check packages", async () => {
  const manifests = new Map(
    await Promise.all(
      verificationPackages.map(async ({ name, directory, workspace }) => [
        name,
        JSON.parse(
          await readFile(
            new URL(`../${workspace ?? "packages"}/${directory}/package.json`, import.meta.url),
            "utf8",
          ),
        ),
      ]),
    ),
  );
  const sdk = manifests.get("@potential-guide/task-sdk");
  assert.deepEqual(Object.keys(sdk.exports), ["."]);
  assert.deepEqual(Object.keys(sdk.dependencies), ["@potential-guide/task-protocol"]);
  const visited = new Set();
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    assert.ok(
      !["@potential-guide/check-artifacts", "@potential-guide/check-runtime-files"].includes(name),
      `Task author tooling must not install ${name}`,
    );
    const manifest = manifests.get(name);
    assert.ok(manifest, `Missing verification package ${name}`);
    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {}))
      if (range.startsWith("workspace:")) visit(dependency);
  }
  visit("@potential-guide/pguide-task-bundle");
  assert.ok(visited.has("@potential-guide/task-sdk"));
});

test("package-specific RC tags preserve package identity and never select latest", () => {
  for (const entry of releasePackages) {
    const parsed = parseReleaseTag(`${entry.id}-v0.3.0-rc.12`);
    assert.equal(parsed.name, entry.name);
    assert.equal(parsed.directory, entry.directory);
    assert.equal(parsed.workspace, entry.workspace);
    assert.equal(parsed.version, "0.3.0-rc.12");
    assert.equal(parsed.distTag, "rc");
  }
  assert.equal(parseReleaseTag("pguide-v0.3.0").distTag, "latest");
  for (const entry of releasePackages) {
    if (taskEngineReleaseIds.includes(entry.id)) {
      assert.throws(() => parseReleaseTag(`${entry.id}-v0.3.0`), /require an RC version/);
    } else {
      assert.equal(parseReleaseTag(`${entry.id}-v0.3.0`).distTag, "latest");
    }
  }
});

test("command wrappers use pguide-prefixed names including config", () => {
  for (const id of [
    "pguide-pilot",
    "pguide-regulate",
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
  const expectedIds = releasePackages.map(({ id }) => id).sort();
  assert.deepEqual(
    [...workflow.matchAll(/^ {6}- "(.+)-v\*"$/gm)].map(([, id]) => id).sort(),
    expectedIds,
  );
  assert.deepEqual(
    dispatchPackages.flatMap((line) => line.match(/^ {10}- (.+)$/)?.slice(1) ?? []).sort(),
    expectedIds,
  );
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
  const outputDirectory = await mkdtemp(join(tmpdir(), "pguide-release-metadata-"));
  try {
    for (const id of [
      "task-protocol",
      "task-sdk",
      "pguide-task-engine",
      "task-engine-webui",
      "effects",
    ]) {
      const entry = releasePackages.find((candidate) => candidate.id === id);
      const manifest = JSON.parse(
        await readFile(
          new URL(
            `../${releasePackageDirectory(entry).replaceAll("\\", "/")}/package.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const output = join(outputDirectory, id);
      const result = spawnSync(process.execPath, ["--input-type=module"], {
        input: scripts[0][2],
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          PACKAGE_INPUT: id,
          RELEASE_EVENT: "workflow_dispatch",
          GITHUB_OUTPUT: output,
        },
      });
      if (taskEngineReleaseIds.includes(id) && !manifest.version.includes("-rc.")) {
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /Task Engine releases require an RC version/);
      } else {
        assert.equal(result.status, 0, result.stderr);
        const metadata = await readFile(output, "utf8");
        assert.ok(metadata.includes(`directory=${releasePackageDirectory(entry)}\n`));
        assert.ok(metadata.includes(`name=${entry.name}\n`));
        assert.ok(metadata.includes(`version=${manifest.version}\n`));
      }
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
