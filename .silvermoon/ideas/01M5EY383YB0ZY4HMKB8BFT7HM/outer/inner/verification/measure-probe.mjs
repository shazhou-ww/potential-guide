import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const originalSpawn = childProcess.spawn;
const base = dirname(dirname(fileURLToPath(import.meta.url)));
const target = resolve(base, "baseline-target");
const label = process.argv[2];
assert.ok(label, "A unique measurement label is required.");
const directory = join(base, "measurements", label);
await mkdir(directory, { recursive: true });
const preload = pathToFileURL(join(base, "probe-count-preload.mjs"));
preload.searchParams.set("report", directory);
preload.searchParams.set("root", target);
const hostPreload = new URL(preload);
hostPreload.searchParams.set("role", "host");
const host = await import(hostPreload.href);
let processCount = 0;
childProcess.spawn = function (command, args, options) {
  if (options?.env?.PGUIDE_PROBE_TEMP_DIR && /(?:^|[\\/])node(?:\.exe)?$/i.test(command)) {
    processCount++;
    args = ["--import", preload.href, ...args];
  }
  return originalSpawn.call(this, command, args, options);
};
syncBuiltinESMExports();

const { withPilot } = await import("@potential-guide/cli-runtime");
const { Effect } = await import("@potential-guide/effects");
const { observe, parseObjectives, projectObjective } = await import("@potential-guide/objective-pilot");
const declaration = parseObjectives(await readFile(join(target, "objectives.yaml"), "utf8")).standardize;
const subject = projectObjective(declaration, {
  repo: { rootPath: target, origin: "https://github.com/shazhou-ww/potential-guide.git" },
  path: ".",
}, undefined);
const sourceCommit = process.env.PROBE_SOURCE_COMMIT ?? "a163adf0cd032b9ee085225f32da72bf96585b47";
const checkCalls = [];
const started = performance.now();
let observationMs;
const observation = await withPilot(
  declaration.objective,
  target,
  sourceCommit,
  async (spec, runtime) => {
    runtime.observationBudget = { timeoutMs: 300_000, maxDepth: 32, maxObservations: 128 };
    const originalResolve = runtime.resolveCheck;
    runtime.resolveCheck = (reference) => {
      const probe = originalResolve(reference);
      return async (wire, signal) => {
        checkCalls.push(reference);
        return probe(wire, signal);
      };
    };
    const observationStarted = performance.now();
    const result = await Effect.runPromise(observe({ spec, subject }, runtime));
    observationMs = performance.now() - observationStarted;
    return result;
  },
  {
    preparationTimeoutMs: 300_000,
    probeTimeoutMs: 300_000,
    reports: { enabled: true, directory: join(directory, "evidence") },
  },
);
const elapsedMs = performance.now() - started;
const hostCounts = structuredClone(host.counts);
const hostTargetCounts = structuredClone(host.targetCounts);
await writeFile(join(directory, "observation.json"), `${JSON.stringify(observation, null, 2)}\n`);
assert.equal(observation.status, 200, observation.message);
assert.ok(observation.payload);
assert.equal(observation.payload.current.levelId, "standardized", JSON.stringify(observation));
assert.deepEqual(observation.payload.problems, []);
const childRecords = [];
for (const file of await readdir(directory)) {
  if (/^\d+-[0-9a-f-]+\.json$/.test(file))
    childRecords.push(JSON.parse(await readFile(join(directory, file), "utf8")));
}
assert.equal(childRecords.length, processCount, "Every check child must flush its counter.");
const counts = Object.fromEntries(
  Object.keys(hostCounts).map((key) => [
    key,
    childRecords.reduce((sum, child) => sum + child.counts[key], 0),
  ]),
);
const targetCounts = Object.fromEntries(Object.keys(hostCounts).map((key) => [
  key, childRecords.reduce((sum, child) => sum + child.targetCounts[key], 0),
]));
const allCounts = Object.fromEntries(Object.keys(counts).map((key) => [
  key, counts[key] + hostCounts[key],
]));
const allTargetCounts = Object.fromEntries(Object.keys(counts).map((key) => [
  key, targetCounts[key] + hostTargetCounts[key],
]));
const result = {
  label,
  node: process.version,
  sourceCommit,
  target: "Fixed archive of a163adf0cd03 plus that checkout's baseline dist; same input for all runs.",
  budgetsMs: { preparation: 300_000, observation: 300_000, check: 300_000 },
  instrumentation: "Identical Node --import preload in each check; counts fs/promises and root inventory.",
  elapsedMs,
  observationMs,
  preparationAndCleanupMs: elapsedMs - observationMs,
  processCount,
  checkCalls,
  counts,
  hostCounts,
  hostTargetCounts,
  allCounts,
  allTargetCounts,
  current: observation.payload.current,
  versions: observation.payload.versions,
  sources: observation.payload.sources,
};
await writeFile(join(directory, "summary.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ label, elapsedMs, observationMs, processCount, allCounts, allTargetCounts, current: result.current }));
