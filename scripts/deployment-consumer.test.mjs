import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertLatestVersion,
  consumerManifest,
  consumerMode,
  verifyConsumerGraph,
} from "./deployment-consumer.mjs";
import { releasePackages } from "./release-packages.mjs";
import { createDeploymentWorkspace } from "./verify-deployment-helpers.mjs";

test("entry-only consumers accept shared stable/RC rules and select exact, latest or local overrides", () => {
  for (const version of ["0.4.0", "0.4.1", "0.4.0-rc.0", "0.4.0-rc.12"]) {
    const versions = new Map([
      ["pguide", version],
      ["@potential-guide/effects", "0.1.0-rc.0"],
    ]);
    const tarballs = new Map(
      [...versions.keys()].map((name, i) => [name, join(process.cwd(), `pack ${i}.tgz`)]),
    );
    for (const [args, mode] of [
      [[], "packed"],
      [["--published"], "published"],
      [["--latest"], "latest"],
    ]) {
      assert.equal(consumerMode(args), mode);
      const manifest = consumerManifest(mode, versions, tarballs);
      assert.deepEqual(Object.keys(manifest.dependencies), ["pguide"]);
      assert.equal(
        manifest.dependencies.pguide,
        mode === "packed"
          ? pathToFileURL(tarballs.get("pguide")).href
          : mode === "latest"
            ? "latest"
            : version,
      );
      if (mode === "packed") {
        assert.deepEqual(Object.keys(manifest.overrides), ["@potential-guide/effects"]);
        assert.equal(
          manifest.overrides["@potential-guide/effects"],
          pathToFileURL(tarballs.get("@potential-guide/effects")).href,
        );
      } else assert.equal(manifest.overrides, undefined);
    }
  }
  for (const version of [
    "1.0.0",
    "1.0.0-rc.0",
    "0.04.0",
    "0.4.00",
    "0.4.0-rc.01",
    "0.4.0-beta.1",
    "0.4.0+build",
    "latest",
    "",
  ]) {
    assert.throws(() => consumerManifest("published", new Map([["pguide", version]])));
  }
  for (const args of [["--unknown"], ["--published", "--latest"], ["--latest", "--latest"]])
    assert.throws(() => consumerMode(args));
  assert.throws(() => consumerManifest("packed", new Map([["pguide", "0.4.0"]])));
  assertLatestVersion("0.4.0", "0.4.0");
  assert.throws(() => assertLatestVersion("0.3.0", "0.4.0"));
});

test("entry graph requires every expected dependency, rejects missing, nested wrong versions and workspace ranges", async () => {
  const workspace = await createDeploymentWorkspace();
  const versions = new Map([
    ["pguide", "0.4.0"],
    ["@potential-guide/config", "0.3.0"],
    ["@potential-guide/cli-core", "0.3.0"],
  ]);
  async function manifest(base, name, version, dependencies = {}) {
    const directory = join(base, "node_modules", ...name.split("/"));
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name, version, dependencies }),
    );
    return directory;
  }
  try {
    await manifest(workspace.path, "pguide", "0.4.0", { "@potential-guide/config": "^0.3.0" });
    const config = await manifest(workspace.path, "@potential-guide/config", "0.3.0");
    await assert.rejects(
      verifyConsumerGraph(workspace.path, versions),
      /Selected entries must reach/,
    );
    await manifest(workspace.path, "@potential-guide/config", "0.3.0", {
      "@potential-guide/cli-core": "^0.3.0",
    });
    await assert.rejects(verifyConsumerGraph(workspace.path, versions), /Missing transitive/);
    await manifest(workspace.path, "@potential-guide/cli-core", "0.3.0");
    await verifyConsumerGraph(workspace.path, versions);
    const isolated = join(workspace.path, "isolated");
    await manifest(isolated, "pguide", "0.4.0", { "@potential-guide/config": "^0.3.0" });
    await assert.rejects(verifyConsumerGraph(isolated, versions), /Missing transitive/);
    await manifest(config, "@potential-guide/cli-core", "0.2.0");
    await assert.rejects(
      verifyConsumerGraph(workspace.path, versions),
      /Unexpected transitive version/,
    );
    await manifest(config, "@potential-guide/cli-core", "0.3.0");
    await verifyConsumerGraph(workspace.path, versions);
    await manifest(workspace.path, "@potential-guide/config", "0.3.0", {
      "@potential-guide/cli-core": "^0.2.0",
    });
    await assert.rejects(verifyConsumerGraph(workspace.path, versions), /packed internal range/);
    await manifest(workspace.path, "pguide", "0.4.0", { "@potential-guide/config": "workspace:^" });
    await assert.rejects(
      verifyConsumerGraph(workspace.path, versions),
      /unresolved workspace range/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("current CLI command versions match their package candidate", async () => {
  const root = new URL("../", import.meta.url);
  for (const [directory, files] of [
    ["pguide", ["src/bin.ts"]],
    ["pguide-config", ["src/bin.ts"]],
  ]) {
    const manifest = JSON.parse(
      await readFile(new URL(`packages/${directory}/package.json`, root), "utf8"),
    );
    for (const file of files) {
      const source = await readFile(new URL(`packages/${directory}/${file}`, root), "utf8");
      assert.ok(
        source.includes(`"${manifest.version}"`),
        `${file} must advertise ${manifest.version}`,
      );
    }
  }
  for (const definition of releasePackages) {
    const manifest = JSON.parse(
      await readFile(new URL(`packages/${definition.directory}/package.json`, root), "utf8"),
    );
    consumerManifest("published", new Map([["pguide", manifest.version]]));
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (releasePackages.some((entry) => entry.name === name)) assert.equal(range, "workspace:^");
    }
  }
});
