import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2]);
const source = join(root, "source");
const consumer = join(root, "consumer");
const artifacts = join(root, "artifacts");
const pnpm = process.env.LEVEL_DEPLOY_PNPM;
assert.ok(pnpm, "Set LEVEL_DEPLOY_PNPM to the device pnpm executable.");
const pin = "682311db15c41344232a5d3f5cd806d5750779d5";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, NODE_PATH: "" },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout.trim();
}
const { releasePackages } = await import(
  pathToFileURL(join(source, "scripts", "release-packages.mjs")).href
);
const destination = join(root, "tarballs");
await mkdir(destination, { recursive: true });
const packages = [];
for (const definition of releasePackages) {
  const directory = join(source, "packages", definition.directory);
  const packed = JSON.parse(
    run(pnpm, ["--dir", directory, "pack", "--pack-destination", destination, "--json"], source),
  );
  assert.equal(packed.name, definition.name);
  packages.push({
    name: packed.name,
    version: packed.version,
    filename: packed.filename,
    sha256: hash(await readFile(packed.filename)),
    files: packed.files.length,
  });
}
const dependencies = Object.fromEntries(
  packages.map((entry) => [entry.name, pathToFileURL(entry.filename).href]),
);
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      name: "level-attainment-isolated-consumer",
      private: true,
      type: "module",
      dependencies,
    },
    null,
    2,
  ),
);
await writeFile(
  join(consumer, "pnpm-workspace.yaml"),
  `packages: []\noverrides: ${JSON.stringify(dependencies)}\n`,
);
const installation = run(
  pnpm,
  [
    "install",
    "--prefer-offline",
    "--ignore-scripts",
    "--no-frozen-lockfile",
    "--reporter=append-only",
  ],
  consumer,
);
await writeFile(join(root, "install-consumer.log"), `${installation}\n`);
await writeFile(
  join(artifacts, "packages.json"),
  `${JSON.stringify(
    {
      sourceCommit: pin,
      archiveSha256: hash(await readFile(join(root, "source.zip"))),
      node: process.version,
      pnpmSource: run(pnpm, ["--version"], source),
      pnpmConsumer: run(pnpm, ["--version"], consumer),
      git: run("git", ["--version"]),
      platform: process.platform,
      architecture: process.arch,
      packages,
    },
    null,
    2,
  )}\n`,
);
console.log(`Packed and independently installed ${packages.length} fixed-source packages.`);
