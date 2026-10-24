import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { prepareObjectivePackage, withPilot } from "../packages/cli-runtime/dist/index.js";
import { execute } from "./verify-deployment-helpers.mjs";
import { releasePackages } from "./release-packages.mjs";
import { createWorkerHost } from "./worker-test-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pilots = releasePackages.filter((entry) => entry.objective);
const checks = {
  "objective-monorepo-standard": ["structure", "deliveries"],
  "objective-package-standard": ["structure", "deliveries"],
  "objective-devbox-health": ["identity", "system", "toolchains", "order", "sustainability"],
  "objective-pguide-setup": ["installation", "configuration", "sanity"],
  "objective-pguide-self-check": ["installation", "configuration", "sanity"],
  "objective-setup-marker": ["marker"],
};
test("six standalone Objective workspaces each own one root definition", async () => {
  const directories = (await readdir(join(root, "packages"), { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, "packages", entry.name, "objective.yaml")),
    )
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(directories, pilots.map((entry) => entry.directory).sort());
  assert.equal(Object.values(checks).flat().length, 16);
  for (const entry of pilots) {
    const manifest = JSON.parse(
      await readFile(join(root, "packages", entry.directory, "package.json"), "utf8"),
    );
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.private, undefined);
  }
});

test("all six npm Objective tarballs prepare and execute all sixteen self-contained check entries", async () => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const scratch = await mkdtemp(join(root, ".cache", "objective-npm-consumers-"));
  let host;
  try {
    host = await createWorkerHost(join(scratch, "host"));
    const packs = join(scratch, "packs");
    await mkdir(packs);
    const packageSpecs = {};
    for (const entry of pilots) {
      const packed = await execute(
        "pnpm",
        [
          "--dir",
          join(root, "packages", entry.directory),
          "pack",
          "--pack-destination",
          packs,
          "--json",
        ],
        { cwd: root },
      );
      assert.equal(packed.code, 0, packed.stderr);
      const pack = JSON.parse(packed.stdout);
      const paths = pack.files.map(({ path }) => path);
      assert.deepEqual(
        paths.filter((path) => path.endsWith("objective.yaml")),
        ["objective.yaml"],
      );
      for (const required of ["package.json", "objective.yaml", "README.md", "LICENSE"])
        assert.ok(paths.includes(required), `${entry.name}: ${required}`);
      assert.ok(
        paths.every(
          (path) =>
            !path.startsWith("node_modules/") &&
            !path.startsWith("src/") &&
            !path.startsWith("test/"),
        ),
      );
      packageSpecs[entry.name] = pack.filename;
    }
    const cacheDirectory = join(scratch, "frozen");
    for (const entry of pilots) {
      const prepared = await prepareObjectivePackage(packageSpecs[entry.name], root, {
        cacheDirectory: join(cacheDirectory, "packages"),
      });
      assert.equal(prepared.source.packageName, entry.name);
      await withPilot(
        packageSpecs[entry.name],
        root,
        undefined,
        async (spec) => {
          assert.equal(spec.objectiveId, entry.name);
          assert.equal(spec.version, prepared.source.packageDigest);
          assert.deepEqual(
            spec.manifest.levels.flatMap((level) => level.checks.map(({ id }) => id)),
            checks[entry.directory],
          );
        },
        { cacheDirectory, packageSpecs, reports: { enabled: false } },
      );
      for (const id of checks[entry.directory]) {
        const invalid = await host.execute(join(prepared.directory, "checks", id), {});
        assert.equal(invalid.payload, null, `${entry.name}/${id}: ${JSON.stringify(invalid)}`);
        assert.notEqual(invalid.status, 200);
        assert.doesNotMatch(
          invalid.message,
          /Cannot find module|must export execute|dependencies must be bundled|initialization timed out/i,
        );
      }
      if (entry.directory === "objective-setup-marker") {
        const marker = join(scratch, "marker.txt");
        const expected = "a".repeat(48);
        await writeFile(marker, expected);
        const result = await host.execute(join(prepared.directory, "checks", "marker"), {
          marker,
          expected,
        });
        assert.deepEqual(result.payload, { ok: true, problems: [] });
      }
      if (["objective-pguide-setup", "objective-pguide-self-check"].includes(entry.directory)) {
        const version = join(scratch, "version.mjs");
        await writeFile(
          version,
          'console.log(JSON.stringify({schemaVersion:1,name:"pguide",version:"fixture"}));',
        );
        const result = await host.execute(join(prepared.directory, "checks", "installation"), {
          workingDirectory: scratch,
          scratchDirectory: join(scratch, "tasks"),
          pguide: { command: process.execPath, args: [version] },
        });
        assert.equal(result.status, 200, JSON.stringify(result));
        assert.equal(result.payload.ok, true, JSON.stringify(result));
      }
    }
  } finally {
    await host?.close();
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
});
