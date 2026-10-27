import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [source, packs, target] = process.argv.slice(2).map((value) => resolve(value));
const manifests = new Map();
for (const entry of await readdir(join(source, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = JSON.parse(await readFile(join(source, "packages", entry.name, "package.json"), "utf8"));
  manifests.set(manifest.name, manifest);
}
const needed = new Set();
function visit(name) {
  if (needed.has(name)) return;
  needed.add(name);
  const manifest = manifests.get(name);
  assert.ok(manifest, name);
  for (const dependency of Object.keys(manifest.dependencies ?? {}))
    if (dependency.startsWith("@potential-guide/")) visit(dependency);
}
visit("@potential-guide/regulation-coordinator");
const inventory = [];
const overrides = {};
for (const name of [...needed].sort()) {
  const manifest = manifests.get(name);
  const filename = `${name.replace("@", "").replaceAll("/", "-")}-${manifest.version}.tgz`;
  const bytes = await readFile(join(packs, filename));
  overrides[name] = `file:${join(packs, filename).replaceAll("\\", "/")}`;
  inventory.push({ name, version: manifest.version, filename, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await mkdir(target, { recursive: false });
await writeFile(join(target, "package.json"), `${JSON.stringify({
  name: "independent-recurrence-consumer",
  private: true,
  type: "module",
  packageManager: "pnpm@11.22.0",
  dependencies: {
    "@potential-guide/regulation-coordinator": overrides["@potential-guide/regulation-coordinator"],
    "@potential-guide/effects": overrides["@potential-guide/effects"],
  },
  devDependencies: { typescript: "5.9.3", "@types/node": "22.20.5" },
  pnpm: { overrides },
}, null, 2)}\n`);
await writeFile(join(target, "tsconfig.json"), `${JSON.stringify({
  compilerOptions: {
    strict: true, exactOptionalPropertyTypes: true, module: "NodeNext",
    moduleResolution: "NodeNext", target: "ES2023", noEmit: true, types: ["node"],
  },
  include: ["consumer.ts"],
}, null, 2)}\n`);
await writeFile(join(target, "package-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
for (const file of ["fixture.mjs", "worker.mjs", "host.mjs", "run.mjs", "consumer.ts"])
  await cp(fileURLToPath(new URL(file, import.meta.url)), join(target, file));
console.log(JSON.stringify({ consumer: target, tarballs: inventory.length }));
