import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const [source, consumer, output] = process.argv.slice(2).map((path) => resolve(path));
assert.ok(source && consumer && output);
const packages = new Map();
for (const workspace of ["packages", "apps"]) {
  for (const directory of await readdir(join(source, workspace))) {
    const path = join(source, workspace, directory);
    const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    packages.set(manifest.name, { path, manifest });
  }
}
const pending = ["@potential-guide/pguide-task-engine", "@potential-guide/task-engine"];
const selected = new Set(pending);
for (const name of pending) {
  const entry = packages.get(name);
  assert.ok(entry, name);
  for (const [dependency, range] of Object.entries({
    ...entry.manifest.dependencies,
    ...entry.manifest.optionalDependencies,
  })) {
    if (range.startsWith("workspace:") && !selected.has(dependency)) {
      selected.add(dependency);
      pending.push(dependency);
    }
  }
}
assert.ok(!selected.has("@potential-guide/check-artifacts"));
await mkdir(output, { recursive: true });
await mkdir(join(output, "packs"));
const dependencies = {};
const records = [];
for (const name of selected) {
  const { path, manifest } = packages.get(name);
  const packed = JSON.parse(
    execFileSync(
      "pnpm",
      ["--dir", path, "pack", "--pack-destination", join(output, "packs"), "--json"],
      { encoding: "utf8" },
    ),
  );
  const bytes = await readFile(packed.filename);
  dependencies[name] = `file:${packed.filename}`;
  records.push({
    name,
    version: manifest.version,
    filename: packed.filename,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    files: packed.files,
  });
}
await writeFile(join(output, "tarballs.json"), JSON.stringify(records, null, 2) + "\n");
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      name: "owned-silvermoon-deployment-consumer",
      private: true,
      type: "module",
      dependencies,
    },
    null,
    2,
  ) + "\n",
);
await copyFile(
  join(source, "examples", "task-server", "verify-consumer.mjs"),
  join(consumer, "verify-consumer.mjs"),
);
console.log(JSON.stringify({ packages: records.length, consumer, output }));
