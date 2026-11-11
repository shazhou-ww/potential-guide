import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  parseReleaseTag,
  releasePackageDirectory,
  releasePackages,
  releaseVersion,
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
  for (const id of ["check-runtime-files"]) {
    assert.ok(verificationPackages.some((entry) => entry.id === id));
    assert.throws(() => parseReleaseTag(`${id}-v0.1.0`), /Unsupported package/);
  }
});

test("release inventory contains the new packages and excludes retired Guide and Supervisor", () => {
  assert.equal(releasePackages.length, 22);
  for (const field of ["id", "directory", "name"]) {
    assert.equal(new Set(releasePackages.map((entry) => entry[field])).size, 22);
  }
  for (const name of [
    "@potential-guide/effects",
    "@potential-guide/git-source",
    "@potential-guide/objective-pilot",
    "@potential-guide/regulation-coordinator",
    "@potential-guide/check-sdk",
    "@potential-guide/check-environment",
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
    "check-artifacts",
    "pguide-pilot",
  ]) {
    assert.ok(!releasePackages.some((entry) => entry.id === id));
    assert.throws(() => parseReleaseTag(`${id}-v0.3.0-rc.0`), /Unsupported package/);
  }
});

test("retired Check and Probe adapters have no workspace, consumer dependency, pack or authoring scenario", async () => {
  for (const path of [
    "../packages/probe-task",
    "../packages/check-artifacts",
    "../examples/task-server/probe-config.mjs",
    "../examples/task-server/probe-integration.mjs",
    "../packages/check-task",
    "../examples/task-server/check-config.mjs",
    "../examples/task-server/check-in-process.mjs",
    "./check-task-bundle-consumer.mjs",
    "./embed-task-workers.mjs",
  ])
    await assert.rejects(access(new URL(path, import.meta.url)), { code: "ENOENT" });
  assert.ok(!verificationPackages.some(({ id }) => id === "probe-task"));
  assert.throws(() => parseReleaseTag("probe-task-v0.1.0-rc.0"), /Unsupported package/);
  assert.ok(!verificationPackages.some(({ id }) => id === "check-task"));
  assert.ok(!verificationPackages.some(({ id }) => id === "check-artifacts"));
  assert.throws(() => parseReleaseTag("check-task-v0.1.0-rc.0"), /Unsupported package/);
  for (const workspace of ["packages"])
    for (const entry of await readdir(new URL(`../${workspace}/`, import.meta.url), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const path = new URL(`../${workspace}/${entry.name}/package.json`, import.meta.url);
      let contents;
      try {
        contents = await readFile(path, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const manifest = JSON.parse(contents);
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ])
        assert.equal(
          manifest[field]?.["@potential-guide/probe-task"],
          undefined,
          `${manifest.name} ${field}`,
        );
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ])
        assert.equal(
          manifest[field]?.["@potential-guide/check-task"],
          undefined,
          `${manifest.name} ${field}`,
        );
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ])
        assert.equal(
          manifest[field]?.["@potential-guide/check-artifacts"],
          undefined,
          `${manifest.name} ${field}`,
        );
    }
  for (const path of [
    "../package.json",
    "../turbo.json",
    "../objectives.yaml",
    "../package-layers.yaml",
    "./check-generated-sources.mjs",
    "./check-package-consumers.mjs",
    "./check-packages.mjs",
  ])
    assert.ok(
      !(await readFile(new URL(path, import.meta.url), "utf8")).includes("probe-task"),
      path,
    );
  for (const path of [
    "../package.json",
    "../turbo.json",
    "../objectives.yaml",
    "../package-layers.yaml",
    "./check-generated-sources.mjs",
    "./check-package-consumers.mjs",
    "./check-packages.mjs",
  ])
    assert.ok(
      !/(?:@potential-guide\/|packages\/|["'])check-task(?:["'/]|$)/m.test(
        await readFile(new URL(path, import.meta.url), "utf8"),
      ),
      path,
    );
});

test("retired Pilot command package has no workspace, default dependency, release route or replacement placeholders", async () => {
  for (const id of ["pguide-pilot", "pguide-probe", "pguide-check"])
    await assert.rejects(access(new URL(`../packages/${id}`, import.meta.url)), { code: "ENOENT" });
  assert.ok(!verificationPackages.some(({ id }) => id === "pguide-pilot"));
  assert.throws(() => parseReleaseTag("pguide-pilot-v0.4.0-rc.0"), /Unsupported package/);
  const main = JSON.parse(
    await readFile(new URL("../packages/pguide/package.json", import.meta.url), "utf8"),
  );
  assert.equal(main.dependencies["@potential-guide/pguide-pilot"], undefined);
  const runtime = JSON.parse(
    await readFile(new URL("../packages/cli-runtime/package.json", import.meta.url), "utf8"),
  );
  assert.equal(runtime.dependencies["@potential-guide/check-artifacts"], undefined);
  for (const file of [
    "../objectives.yaml",
    "../package-layers.yaml",
    "../tsconfig.json",
    "../.github/workflows/publish-npm.yaml",
  ])
    assert.ok(
      !(await readFile(new URL(file, import.meta.url), "utf8")).includes("pguide-pilot"),
      file,
    );
});

test("Check packages have independent stable release routes in dependency order", () => {
  const sdk = parseReleaseTag("check-sdk-v0.1.1");
  const environment = parseReleaseTag("check-environment-v0.1.1");
  assert.equal(sdk.name, "@potential-guide/check-sdk");
  assert.equal(environment.name, "@potential-guide/check-environment");
  assert.equal(sdk.distTag, "latest");
  assert.equal(environment.distTag, "latest");
  assert.ok(
    releasePackages.findIndex(({ id }) => id === sdk.id) <
      releasePackages.findIndex(({ id }) => id === environment.id),
  );
});

test("migrated engine products no longer have local publication routes", () => {
  for (const id of [
    "task-protocol",
    "task-sdk",
    "task-engine",
    "task-engine-http",
    "task-engine-storage",
    "task-engine-server",
    "task-engine-webui",
    "pguide-task-engine",
    "pguide-task-bundle",
  ]) {
    assert.throws(() => parseReleaseTag(`${id}-v0.1.0-rc.0`), /Unsupported package/);
    assert.ok(!verificationPackages.some((entry) => entry.id === id));
  }
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
    [],
  );
  const bootstrap = await readFile(
    new URL("./create-npm-bootstrap-packages.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(bootstrap.includes("releasePackageDirectory(entry)"));
  assert.ok(bootstrap.includes("join(temporaryRoot, entry.id)"));
  assert.ok(!bootstrap.includes('join(root, "packages",'));
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
    if (entry.id === "cli-core")
      assert.throws(() => parseReleaseTag(`${entry.id}-v0.3.0`), /require an RC version/);
    else assert.equal(parseReleaseTag(`${entry.id}-v0.3.0`).distTag, "latest");
  }
});

test("command wrappers use pguide-prefixed names including config", () => {
  for (const id of ["pguide-regulate", "pguide-objectives", "pguide-config", "pguide-agents"]) {
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
  const cache = new URL("../.cache/", import.meta.url);
  await mkdir(cache, { recursive: true });
  const outputDirectory = await mkdtemp(new URL("pguide-release-metadata-", cache));
  try {
    for (const id of ["effects"]) {
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
      assert.equal(result.status, 0, result.stderr);
      const metadata = await readFile(output, "utf8");
      assert.ok(metadata.includes(`directory=${releasePackageDirectory(entry)}\n`));
      assert.ok(metadata.includes(`name=${entry.name}\n`));
      assert.ok(metadata.includes(`version=${manifest.version}\n`));
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
