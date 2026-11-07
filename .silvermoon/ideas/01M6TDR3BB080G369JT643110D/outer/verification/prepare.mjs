import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [repository, destination] = process.argv.slice(2);
assert.ok(repository && destination, "Usage: node prepare.mjs <repository> <NEW outside-repository workspace>");
const repo = await realpath(resolve(repository));
const workspace = resolve(destination);
function outside(root, path) {
  const distance = relative(root, path);
  return isAbsolute(distance) || distance === ".." || distance.startsWith(`..${sep}`);
}
assert.ok(outside(repo, workspace), "Use a separate consumer project, not a repository descendant.");
await mkdir(workspace); // Refuse to overwrite any existing project.
assert.ok(outside(repo, await realpath(workspace)), "Consumer must not resolve back into source.");
const require = createRequire(join(repo, "package.json"));
const spawn = require("cross-spawn");
const { consumerVersions, verifyConsumerGraph } = await import(
  pathToFileURL(join(repo, "scripts", "deployment-consumer.mjs")).href
);
const env = { ...process.env, CI: "true", NODE_PATH: "" };
function run(command, args, cwd) {
  const child = spawn.sync(command, args, {
    cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 240_000,
    windowsHide: true, shell: false,
  });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, `${command} ${args.join(" ")}\n${child.stdout}\n${child.stderr}`);
  return child.stdout;
}
const revision = run("git", ["rev-parse", "HEAD"], repo).trim();
const packages = [
  "pguide-cli-core", "task-protocol", "task-sdk", "pguide-task-bundle",
  "task-engine", "check-sdk", "check-environment",
];
const manifests = new Map();
const tarballs = new Map();
const packs = join(workspace, "packs");
await mkdir(packs);
for (const directory of packages) {
  const root = join(repo, "packages", directory);
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const packed = JSON.parse(run("pnpm", [
    "--dir", root, "pack", "--pack-destination", packs, "--json",
  ], repo));
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  manifests.set(manifest.name, manifest);
  tarballs.set(manifest.name, resolve(packed.filename));
}
const inventory = [];
for (const [name, path] of tarballs) {
  inventory.push({
    name, version: manifests.get(name).version, path,
    sha256: createHash("sha256").update(await readFile(path)).digest("hex"),
  });
}
await writeFile(join(workspace, "packs.json"), JSON.stringify(inventory, null, 2));
const authorEntries = [
  "@potential-guide/pguide-task-bundle", "@potential-guide/check-sdk",
  "@potential-guide/check-environment", "@potential-guide/task-sdk",
];
const runtimeEntries = ["@potential-guide/task-engine"];
for (const [label, entries] of [["author", authorEntries], ["runtime", runtimeEntries]]) {
  const directory = join(workspace, label);
  await mkdir(directory);
  await writeFile(join(directory, "package.json"), JSON.stringify({
    name: `independent-check-documentation-${label}`, private: true, type: "module",
    packageManager: "pnpm@11.22.0",
    dependencies: {
      ...Object.fromEntries(entries.map((name) => [name, pathToFileURL(tarballs.get(name)).href])),
      ...(label === "author" ? { "@sinclair/typebox": "0.34.52" } : {}),
    },
  }, null, 2));
  await writeFile(join(directory, "pnpm-workspace.yaml"),
    `packages: []\noverrides: ${JSON.stringify(Object.fromEntries(
      [...tarballs].map(([name, path]) => [name, pathToFileURL(path).href]),
    ))}\n`);
  run("pnpm", [
    "install", "--prod", "--ignore-scripts", "--no-frozen-lockfile",
    "--reporter=append-only", "--store-dir", join(workspace, "store"),
  ], directory);
  const graph = await verifyConsumerGraph(
    directory, consumerVersions(manifests, entries), entries, true,
  );
  if (label === "runtime") {
    for (const forbidden of authorEntries)
      assert.ok(!graph.some((item) => item.name === forbidden),
        `Author dependency reached runtime: ${forbidden}`);
  }
  await writeFile(join(workspace, `${label}-dependencies.json`), JSON.stringify(graph, null, 2));
}
const here = dirname(fileURLToPath(import.meta.url));
await copyFile(join(here, "build-text.mjs"), join(workspace, "author", "build-text.mjs"));
await copyFile(join(here, "consume.mjs"), join(workspace, "runtime", "consume.mjs"));
await writeFile(join(workspace, "author", "source-provenance.json"), JSON.stringify({
  repository: repo, sourceRevision: revision,
  implementationCommit: "5a1684d75ee92720a76daa3e0b0cf1e7abcb4c61",
  implementationRevision: "d4afe07fe4dd7fd4791ddcfb403958bc190d52b6",
}, null, 2));
run(process.execPath, ["build-text.mjs"], join(workspace, "author"));
await cp(join(workspace, "author", "artifacts"), join(workspace, "runtime", "artifacts"),
  { recursive: true });
console.log(JSON.stringify({
  workspace, sourceRevision: revision, packs: join(workspace, "packs.json"),
  runtime: join(workspace, "runtime"), next: "node consume.mjs http://127.0.0.1:55713",
}, null, 2));
