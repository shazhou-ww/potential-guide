// The destination is newly created and owned by this single verification run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [repository, destination, candidate] = process.argv.slice(2);
assert.ok(repository && destination && candidate, "repository, owned destination and candidate commit are required");
const root = resolve(repository);
const target = resolve(destination);
assert.ok(!target.startsWith(root), "Consumer must be outside source checkout");
await mkdir(target);
const tarballs = join(target, "tarballs");
await mkdir(tarballs);
const manifests = new Map();
for (const folder of await readdir(join(root, "packages"))) {
  const path = join(root, "packages", folder);
  const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
  manifests.set(manifest.name, { path, manifest });
}
const selected = new Set();
function visit(name) {
  if (selected.has(name)) return;
  const item = manifests.get(name);
  assert.ok(item, `Missing internal package ${name}`);
  selected.add(name);
  for (const dependency of Object.keys(item.manifest.dependencies ?? {}))
    if (manifests.has(dependency)) visit(dependency);
}
for (const name of ["task-engine-server", "check-task", "probe-task"]) visit(`@potential-guide/${name}`);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
function run(args, cwd = root, extra = {}) {
  const result = spawnSync(pnpm, args, { cwd, encoding: "utf8", shell: process.platform === "win32", ...extra });
  if (result.status !== 0) throw new Error(`${pnpm} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
}
const dependencies = {};
const hashes = {};
for (const name of [...selected].sort()) {
  const item = manifests.get(name);
  const tarball = join(tarballs, `${name.slice(name.indexOf("/") + 1)}.tgz`);
  run(["--dir", item.path, "pack", "--out", tarball]);
  dependencies[name] = `file:${tarball.replaceAll("\\", "/")}`;
  hashes[name] = createHash("sha256").update(await readFile(tarball)).digest("hex");
}
await writeFile(join(target, "package.json"), `${JSON.stringify({
  name: "schema-discovery-independent-proof",
  private: true,
  type: "module",
  dependencies,
  pnpm: { overrides: dependencies },
}, null, 2)}\n`);
await writeFile(join(target, "pnpm-workspace.yaml"), "packages: []\n");
run(["install", "--ignore-scripts"], target);
await copyFile(join(dirname(fileURLToPath(import.meta.url)), "verify-schema-consumer.mjs"), join(target, "verify.mjs"));
await writeFile(join(target, "package-evidence.json"), `${JSON.stringify({ candidate, packages: hashes }, null, 2)}\n`);
const proof = spawnSync(process.execPath, ["verify.mjs"], { cwd: target, encoding: "utf8", timeout: 120_000, env: { ...process.env, CANDIDATE_COMMIT: candidate } });
process.stdout.write(proof.stdout ?? "");
process.stderr.write(proof.stderr ?? "");
assert.equal(proof.status, 0, "Independent packed consumer failed");
