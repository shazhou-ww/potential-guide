import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
export const objectivePackages = [
  "objective-monorepo-standard",
  "objective-package-standard",
  "objective-devbox-health",
  "objective-pguide-setup",
  "objective-pguide-self-check",
  "objective-setup-marker",
];
const generators = {
  "objective-monorepo-standard": "build-monorepo-runtime.mjs",
  "objective-package-standard": "build-monorepo-runtime.mjs",
  "objective-devbox-health": "build-health-runtime.mjs",
  "objective-pguide-setup": "build-setup-runtime.mjs",
  "objective-pguide-self-check": "build-self-check-runtime.mjs",
};
async function copy(source, target) {
  try {
    await cp(source, target, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
for (const name of process.argv[2] ? [process.argv[2]] : objectivePackages) {
  if (!objectivePackages.includes(name)) throw new Error(`Unknown Objective package ${name}.`);
  if (generators[name])
    execFileSync(process.execPath, [join(root, "scripts", generators[name])], { stdio: "inherit" });
  execFileSync(
    process.execPath,
    [join(root, "scripts", "build-check-workers.mjs"), "--package", name],
    { stdio: "inherit" },
  );
  const source = join(root, "packages", name);
  const destination = join(source, "dist", "package");
  await mkdir(destination, { recursive: true });
  for (const path of [
    "objective.yaml",
    "references",
    "README.md",
    "LICENSE",
    "observation-inputs.json",
  ])
    await copy(join(source, path), join(destination, path));
  await copy(join(root, ".staging", name), destination);
  await copy(join(root, "LICENSE"), join(destination, "LICENSE"));
  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  delete manifest.scripts;
  delete manifest.devDependencies;
  delete manifest.private;
  // Only the self-contained workers and their resources are executable exports.
  delete manifest.main;
  delete manifest.types;
  manifest.exports = { "./objective.yaml": "./objective.yaml" };
  manifest.files = [
    "objective.yaml",
    "references",
    "checks",
    "observation-inputs.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.txt",
  ];
  if (manifest.publishConfig) delete manifest.publishConfig.directory;
  // Build dependencies are not runtime code. Objective-to-Objective bindings remain explicit.
  manifest.dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).filter(([id]) =>
      (manifest.objectiveDependencies ?? []).includes(id),
    ),
  );
  for (const [id, spec] of Object.entries(manifest.dependencies)) {
    if (spec.startsWith("workspace:")) {
      const dependency = JSON.parse(
        await readFile(join(root, "packages", id.split("/").at(-1), "package.json"), "utf8"),
      );
      manifest.dependencies[id] =
        `${spec === "workspace:~" ? "~" : spec === "workspace:^" ? "^" : ""}${dependency.version}`;
    }
  }
  if (!Object.keys(manifest.dependencies).length) delete manifest.dependencies;
  await writeFile(join(destination, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
