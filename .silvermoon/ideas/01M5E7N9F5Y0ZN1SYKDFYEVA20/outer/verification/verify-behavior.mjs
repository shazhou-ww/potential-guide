import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import spawn from "cross-spawn";
import { releasePackages } from "../../../../../scripts/release-packages.mjs";
import { verifyConsumerGraph } from "../../../../../scripts/deployment-consumer.mjs";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const accepted = "764bdf07cd0496708947495ae96c8b70f1bdc382";
const acceptedCode = "344136c5b47bd4a55663b23089efd7dd7cedef6b";
const idea = ".silvermoon/ideas/01M5E7N9F5Y0ZN1SYKDFYEVA20";
const output = process.argv[2];
assert.ok(output, "Pass a result JSON path.");
async function run(command, args, cwd = root) {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, args, {
      cwd, windowsHide: true, shell: false,
      env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolveOutput(stdout.trim());
      else reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}
assert.equal(await run("git", ["rev-parse", `HEAD:${idea}/outer/inner`]), accepted);
const sourceCommit = await run("git", ["rev-parse", "HEAD"]);
const contractBlob = await run("git", ["rev-parse", `HEAD:${idea}/outer/Deployment.md`]);
const deploymentRevision = await run("git", ["rev-parse", `HEAD:${idea}/outer`]);
const entries = ["@potential-guide/effects", "@potential-guide/regulation-coordinator"];
await run("pnpm", ["--filter", "@potential-guide/regulation-coordinator...", "build"]);
const definitions = new Map();
for (const definition of releasePackages) {
  const manifest = JSON.parse(await readFile(join(root, "packages", definition.directory, "package.json"), "utf8"));
  definitions.set(definition.name, { ...definition, manifest });
}
const selected = new Map();
function visit(name) {
  if (selected.has(name)) return;
  const definition = definitions.get(name);
  assert.ok(definition, `Missing internal package ${name}`);
  selected.set(name, definition);
  for (const dependency of Object.keys(definition.manifest.dependencies ?? {}))
    if (definitions.has(dependency)) visit(dependency);
}
for (const name of entries) visit(name);
for (const definition of selected.values()) {
  assert.equal(
    await run("git", ["rev-parse", `HEAD:packages/${definition.directory}`]),
    await run("git", ["rev-parse", `${acceptedCode}:packages/${definition.directory}`]),
    `Package ${definition.name} differs from the accepted implementation`,
  );
}
const scratch = await mkdtemp(join(tmpdir(), "coordinator-deployment-"));
const report = {
  checkedAt: new Date().toISOString(), sourceCommit, acceptedCode, implementationRevision: accepted,
  contractBlob, deploymentRevision, node: process.version, pnpm: await run("pnpm", ["--version"]),
  temporaryDirectory: basename(scratch), artifacts: [], consumers: [], cleanup: false,
};
try {
  const packs = join(scratch, "packs");
  const consumer = join(scratch, "consumer");
  await mkdir(packs);
  await mkdir(consumer);
  const tarballs = new Map();
  const versions = new Map();
  for (const [name, definition] of selected) {
    const packed = JSON.parse(await run("pnpm", [
      "--dir", join(root, "packages", definition.directory), "pack", "--pack-destination", packs, "--json",
    ]));
    assert.equal(typeof packed.filename, "string");
    const file = resolve(packed.filename);
    assert.equal(dirname(file), packs);
    await stat(file);
    tarballs.set(name, file);
    versions.set(name, definition.manifest.version);
    report.artifacts.push({
      name, version: definition.manifest.version, file: basename(file),
      sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
      sourceTree: await run("git", ["rev-parse", `HEAD:packages/${definition.directory}`]),
    });
  }
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "coordinator-deployment-consumer", private: true, type: "module",
    dependencies: Object.fromEntries(entries.map((name) => [name, pathToFileURL(tarballs.get(name)).href])),
  }, null, 2));
  await writeFile(join(consumer, "pnpm-workspace.yaml"),
    `packages: []\noverrides: ${JSON.stringify(Object.fromEntries([...tarballs].map(([name, file]) => [name, pathToFileURL(file).href])))}\n`);
  await run("pnpm", ["install", "--prefer-offline", "--ignore-scripts", "--no-frozen-lockfile", "--reporter=append-only"], consumer);
  await verifyConsumerGraph(consumer, versions, entries);
  report.isolatedDependencyGraph = true;
  await cp(fileURLToPath(new URL("./behavior-consumer.mjs", import.meta.url)), join(consumer, "consumer.mjs"));
  await writeFile(join(consumer, "api.ts"), `
import { Effect, SubscriptionRef } from "@potential-guide/effects";
import { coordinator, CoordinatorModel, RequestModel, coordinatorViews, openCoordinatorStore, type BehaviorCoordinatorOptions } from "@potential-guide/regulation-coordinator";
export const consume = (
  resources: SubscriptionRef.SubscriptionRef<CoordinatorModel.ResourceAllocation>,
  requests: SubscriptionRef.SubscriptionRef<RequestModel.RegulationRequests>,
  options: BehaviorCoordinatorOptions,
) => Effect.scoped(coordinator(resources, requests, options));
export const restore = (value: unknown) => coordinatorViews([CoordinatorModel.restoreCoordinatorState(value)]);
export const store = openCoordinatorStore;
`);
  await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: true, types: [] },
    files: ["api.ts"],
  }));
  await run(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", consumer, "--pretty", "false"], consumer);
  report.declarationCheck = true;
  for (const phase of ["first", "resume", "unknown"]) {
    const profile = join(consumer, phase === "unknown" ? "unknown-profile" : "profile");
    report.consumers.push(JSON.parse(await run(process.execPath, ["consumer.mjs", phase, profile], consumer)));
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
  await assert.rejects(stat(scratch), { code: "ENOENT" });
  report.cleanup = true;
}
await writeFile(resolve(output), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  packages: report.artifacts.length, declarations: report.declarationCheck,
  isolated: report.isolatedDependencyGraph,
  consumers: report.consumers.map(({ phase, starts, childStarts, childExits, occupied, revision }) => ({ phase, starts, childStarts, childExits, occupied, revision })),
  cleanup: report.cleanup,
}, null, 2));
