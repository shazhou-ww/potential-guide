import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { releasePackages } from "./release-packages.mjs";
import { execute } from "./verify-deployment-helpers.mjs";
import { prepareObjectivePackage } from "../packages/cli-runtime/dist/index.js";
import { readArtifact } from "../packages/check-runtime-files/dist/index.js";
import { parseManifest } from "../packages/pilot-protocol/dist/index.js";

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

test("six Objective tarballs retain exact package identities and all sixteen static worker artifacts", async (t) => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const scratch = await mkdtemp(join(root, ".cache", "objective-static-packs-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const packs = join(scratch, "packs");
  await mkdir(packs);
  let artifacts = 0;
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
    for (const file of ["package.json", "objective.yaml", "README.md", "LICENSE"])
      assert.ok(paths.includes(file), `${entry.name}: ${file}`);
    const prepared = await prepareObjectivePackage(pack.filename, root, {
      cacheDirectory: join(scratch, "frozen"),
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(prepared.source.packageName, entry.name);
    const manifest = parseManifest(
      await readFile(join(prepared.directory, "objective.yaml"), "utf8"),
    );
    assert.deepEqual(
      manifest.levels.flatMap((level) => level.checks.map(({ id }) => id)),
      checks[entry.directory],
    );
    for (const id of checks[entry.directory]) {
      const artifact = await readArtifact(join(prepared.directory, "checks", id));
      assert.match(artifact.revision, /^[a-f0-9]{64}$/);
      artifacts++;
    }
  }
  assert.equal(artifacts, 16);
});
