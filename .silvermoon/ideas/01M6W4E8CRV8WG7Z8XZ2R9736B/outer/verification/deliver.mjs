import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import spawn from "cross-spawn";
import { copyFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "..", "..", "..", "..", "..");
const destination = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "Supply an owned delivery directory outside the repository.");
assert.ok(!destination.toLowerCase().startsWith(repository.toLowerCase()));
const packs = join(destination, "packs");
const consumer = join(destination, "consumer");
await mkdir(packs, { recursive: true });
await mkdir(consumer, { recursive: true });
const evidence = { sourceCommit: "5428223891ebd6a049048aa5d8eb7e3cd972e017", packages: [] };
const { verificationPackages } = await import(
  pathToFileURL(join(repository, "scripts", "release-packages.mjs")).href
);
const wanted = [
  "@potential-guide/probe-sdk",
  "@potential-guide/pguide-task-bundle",
  "@potential-guide/task-engine-server",
  "@potential-guide/task-engine-http",
  "@potential-guide/check-sdk",
];
const manifests = new Map();
for (const name of wanted) {
  const entry = verificationPackages.find((candidate) => candidate.name === name);
  assert.ok(entry, `Unknown package ${name}`);
  const directory = join(repository, entry.workspace ?? "packages", entry.directory);
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  manifests.set(name, { directory, manifest });
  for (const [dependency, version] of Object.entries(manifest.dependencies ?? {}))
    if (version.startsWith("workspace:") && !wanted.includes(dependency)) wanted.push(dependency);
}
function run(command, args, cwd, log) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        pnpm_config_store_dir: join(repository, ".cache", "pnpm-store"),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", async (code) => {
      try {
        await writeFile(join(destination, log), [stdout, stderr].filter(Boolean).join("\n"));
        if (code !== 0) throw new Error(`${command} exited ${code}; see ${log}\n${stderr.slice(-2000)}`);
        resolvePromise(stdout);
      } catch (error) { reject(error); }
    });
  });
}
const dependencies = {};
for (const [name, { directory, manifest }] of manifests) {
  const packed = JSON.parse(await run("pnpm", ["pack", "--pack-destination", packs, "--json"],
    directory, `pack-${name.split("/").at(-1)}.log`));
  const file = packed.filename ?? packed.path;
  assert.ok(file, JSON.stringify(packed));
  const tarball = resolve(directory, file);
  const bytes = await readFile(tarball);
  dependencies[name] = `file:../packs/${basename(tarball)}`;
  evidence.packages.push({
    name, version: manifest.version, tarball: fileURLToPath(pathToFileURL(tarball)),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
for (const [name, workspace] of [
  ["@sinclair/typebox", "probe-sdk"], ["yaml", "probe-sdk"],
  ["@ipld/car", "ipfs-content"], ["multiformats", "ipfs-content"],
]) {
  const pkg = JSON.parse(await readFile(join(repository, "packages", workspace,
    "node_modules", ...name.split("/"), "package.json"), "utf8"));
  dependencies[name] = pkg.version;
}
await writeFile(join(consumer, "package.json"), `${JSON.stringify({
  name: "probe-independent-delivery", private: true, type: "module", dependencies,
}, null, 2)}\n`);
await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer, "install.log");
const graph = await run("npm", ["ls", "--all", "--json"], consumer, "dependency-graph.log");
await writeFile(join(destination, "dependency-graph.json"), graph);
await copyFile(join(consumer, "package-lock.json"), join(destination, "package-lock.json"));
await copyFile(join(here, "consume.mjs"), join(consumer, "consume.mjs"));
evidence.consumer = await realpath(consumer);
evidence.node = process.version;
await writeFile(join(destination, "packages.json"), `${JSON.stringify(evidence, null, 2)}\n`);
const output = await run(process.execPath, ["consume.mjs", destination], consumer, "consume.log");
console.log(output);
