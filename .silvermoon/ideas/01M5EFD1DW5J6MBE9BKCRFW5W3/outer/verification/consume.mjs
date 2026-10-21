import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "@potential-guide/effects";
import { withPilot } from "@potential-guide/cli-runtime";
import { checkObjectiveLevel } from "@potential-guide/objective-pilot";
import { makeRegulatorSpec, regulate } from "@potential-guide/objective-regulator";
import { parseManifest } from "@potential-guide/pilot-protocol";

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2]);
const metadata = JSON.parse(await readFile(join(output, "packages.json"), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reports = [];
const home = join(root, "home");
const fixture = join(root, "objective-fixture");
const calls = join(root, "calls");
const state = join(root, "state");
await Promise.all([home, fixture, calls, state].map((path) => mkdir(path)));
const config = join(root, "config.json");
await writeFile(
  config,
  JSON.stringify({
    schemaVersion: 2,
    stateDirectory: state,
    commandDirectories: [join(root, "node_modules", ".bin")],
    reports: { enabled: false },
  }),
);
const env = {
  ...process.env,
  NODE_PATH: "",
  NODE_OPTIONS: "",
  HOME: home,
  USERPROFILE: home,
  APPDATA: join(home, "AppData", "Roaming"),
};
function processRun(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 90_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}
function git(...args) {
  const result = processRun("git", args, fixture);
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
}
async function packageRoot(name, from = join(root, "package.json")) {
  for (const directory of createRequire(from).resolve.paths(name) ?? []) {
    const candidate = join(directory, ...name.split("/"), "package.json");
    if (!existsSync(candidate)) continue;
    const actual = await realpath(candidate);
    const location = relative(root, actual);
    assert.ok(
      !isAbsolute(location) && location !== ".." && !location.startsWith(`..${sep}`),
      `Package escaped consumer: ${actual}`,
    );
    return dirname(actual);
  }
  assert.fail(`Missing installed package ${name}`);
}
const graph = new Map();
async function visit(name, from = join(root, "package.json")) {
  const directory = await packageRoot(name, from);
  if (graph.has(directory)) return;
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const expected = metadata.packages.find((entry) => entry.name === name);
  if (expected) assert.equal(manifest.version, expected.version);
  assert.equal(manifest.name, name);
  graph.set(directory, { name, version: manifest.version, path: directory });
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    assert.doesNotMatch(range, /^workspace:/);
    await visit(dependency, join(directory, "package.json"));
  }
}
for (const entry of metadata.packages) await visit(entry.name);
await writeFile(
  join(output, "installed-graph.json"),
  `${JSON.stringify([...graph.values()], null, 2)}\n`,
);
async function binary(name, command) {
  const directory = await packageRoot(name);
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin[command];
  assert.ok(entry);
  return resolve(directory, entry);
}
async function cli(label, name, command, args, expectedCode = 0) {
  const result = processRun(process.execPath, [
    "--import",
    pathToFileURL(join(root, "isolation.mjs")).href,
    await binary(name, command),
    ...args,
    "--format",
    "json",
    "--config",
    config,
    "--cwd",
    fixture,
  ]);
  reports.push({ label, command, args, ...result });
  assert.equal(result.exitCode, expectedCode, `${label}: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}
const levels = ["prepared", "ready", "verified"];
const subjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "calls"],
  properties: {
    passed: { type: "integer", minimum: 0, maximum: 3 },
    calls: { type: "string", minLength: 1 },
  },
};
const baseManifest = {
  $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v2.json",
  subjectSchema,
  levels: levels.map((id, index) => ({
    id,
    checks: [{ id: `c${index + 1}`, problems: ["blocked"] }],
  })),
  defaultLanguage: "en-US",
  languages: ["en-US"],
};
const legacyManifest = {
  ...baseManifest,
  $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json",
  levels: [{ id: "initial", checks: [{ id: "c1", problems: ["blocked"] }] }],
};
function page(id) {
  return `---\ntitle: ${JSON.stringify(id)}\ndescription: ${JSON.stringify(`Consumer fixture ${id}`)}\nreferences: []\n---\n\nFixed-version consumer verification.\n`;
}
async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
async function objective(directory, manifest) {
  await put(join(directory, "objective.yaml"), `${JSON.stringify(manifest, null, 2)}\n`);
  const ids = ["system/overview", "system/404", "levels/initial", "levels/terminal"];
  for (const level of manifest.levels) {
    ids.push(`levels/${level.id}`);
    for (const check of level.checks) {
      ids.push(`checks/${check.id}`);
      for (const problem of check.problems)
        ids.push(`levels/${level.id}/checks/${check.id}/problems/${problem}`);
    }
  }
  for (const id of ids)
    await put(join(directory, "references", ...id.split("/"), "en-US.md"), page(id));
}
await objective(join(fixture, "matrix"), baseManifest);
for (let index = 1; index <= 3; index++) {
  await put(
    join(fixture, "matrix", "checks", `c${index}`, "run.cjs"),
    `#!/usr/bin/env node\nconst fs=require("node:fs");let input="";\n` +
      `(async()=>{for await(const c of process.stdin)input+=c;const subject=JSON.parse(input);fs.appendFileSync(subject.calls,${JSON.stringify(`c${index}\n`)});const ok=subject.passed>=${index};console.log(JSON.stringify({status:200,message:"",payload:{ok,problems:ok?[]:[{kind:"internal",id:"blocked",parameters:{}}]}}));})();\n`,
  );
}
const uri = `git+${pathToFileURL(fixture).href}#matrix/`;
const dependentUri = `git+${pathToFileURL(fixture).href}#dependent/`;
const legacyUri = `git+${pathToFileURL(fixture).href}#legacy-v1/`;
await objective(join(fixture, "legacy-v1"), legacyManifest);
await put(
  join(fixture, "legacy-v1", "checks", "c1", "run.cjs"),
  await readFile(join(fixture, "matrix", "checks", "c1", "run.cjs"), "utf8"),
);
await objective(join(fixture, "dependent"), {
  ...baseManifest,
  levels: [{ id: "ready", checks: [{ id: "dependency", problems: [] }] }],
});
await put(
  join(fixture, "dependent", "checks", "dependency", "run.cjs"),
  `#!/usr/bin/env node\n(async()=>{const {createSourceObjectiveDependencyProbe}=await import(${JSON.stringify(import.meta.resolve("@potential-guide/objective-pilot"))});let text="";for await(const c of process.stdin)text+=c;const result=await createSourceObjectiveDependencyProbe({objectiveId:${JSON.stringify(uri)},expectedLevelId:"terminal"})(JSON.parse(text),new AbortController().signal);console.log(JSON.stringify(result));})();\n`,
);
git("init", "-q");
git("config", "user.name", "Level attainment consumer");
git("config", "user.email", "consumer@example.invalid");
git("add", "matrix", "dependent", "legacy-v1");
git(
  "commit",
  "-qm",
  "Pin consumer Objective fixtures",
  "-m",
  "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
);
const fixtureCommit = git("rev-parse", "HEAD");
const matrix = [];
for (let passed = 0; passed <= 3; passed++) {
  const log = join(calls, `probe-${passed}.txt`);
  const subject = join(root, `subject-${passed}.json`);
  await writeFile(subject, JSON.stringify({ passed, calls: log }));
  const report = await cli(`probe-${passed}`, "@potential-guide/pguide-pilot", "pguide-probe", [
    "--pilot",
    uri,
    "--revision",
    fixtureCommit,
    "--subject-file",
    subject,
    "--no-reports",
  ]);
  const expected = passed === 0 ? "initial" : levels[passed - 1];
  assert.equal(report.payload.current.levelId, expected);
  assert.notEqual(report.payload.current.levelId, "terminal");
  if (passed < 3)
    assert.ok(report.payload.problems.every((problem) => problem.ref.levelId === levels[passed]));
  else assert.deepEqual(report.payload.problems, []);
  const invoked = (await readFile(log, "utf8")).trim().split("\n");
  assert.equal(invoked.length, Math.min(passed + 1, 3));
  matrix.push({ passed, current: expected, invoked, observation: report.payload });
}
const api = [];
await withPilot(uri, root, fixtureCommit, async (spec, runtime) => {
  for (let passed = 0; passed <= 3; passed++) {
    for (const target of ["verified", "terminal"]) {
      const result = await Effect.runPromise(
        checkObjectiveLevel(
          {
            spec,
            subject: { passed, calls: join(calls, `api-${passed}.txt`) },
            expectedLevelId: target,
          },
          runtime,
        ),
      );
      assert.equal(result.payload.passed, passed === 3);
      assert.equal(
        result.payload.observation.current.levelId,
        passed === 0 ? "initial" : levels[passed - 1],
      );
      api.push({ passed, target, result });
    }
  }
  const log = join(calls, "api-initial.txt");
  let agentRuns = 0;
  const input = {
    spec: makeRegulatorSpec(
      spec,
      {
        targetLevel: "initial",
        agentExecutionLimits: { timeoutMs: 1000 },
        quota: { timeoutMs: 10000, maxAgentRuns: 1, maxStallRuns: 1 },
      },
      { id: "must-not-run" },
    ),
    subject: { passed: 0, calls: log },
  };
  const result = await Effect.runPromise(
    regulate(input, {
      pilot: runtime,
      executeAgent: async () => {
        agentRuns++;
        assert.fail("Unexpected Agent execution");
      },
    }),
  );
  assert.equal(result.stopReason, "target-reached");
  assert.equal(result.latestObservation.payload.current.levelId, "initial");
  assert.equal(result.iterations, 0);
  assert.equal(agentRuns, 0);
  assert.equal(existsSync(log), false);
  await assert.rejects(
    Effect.runPromise(
      regulate(
        {
          ...input,
          subject: { passed: "invalid", calls: log },
        },
        { pilot: runtime, executeAgent: async () => assert.fail("Unexpected Agent") },
      ),
    ),
  );
  assert.equal(existsSync(log), false);
  api.push({
    target: "initial",
    result,
    agentRuns,
    businessChecks: 0,
    invalidSubjectRejected: true,
  });
});
const initialLog = join(calls, "cli-initial.txt");
const initialSubject = join(root, "initial-subject.json");
await writeFile(initialSubject, JSON.stringify({ passed: 0, calls: initialLog }));
const initial = await cli(
  "initial-no-agent",
  "@potential-guide/pguide-regulate",
  "pguide-regulate",
  [
    "--pilot",
    uri,
    "--revision",
    fixtureCommit,
    "--subject-file",
    initialSubject,
    "--target",
    "initial",
  ],
);
assert.equal(initial.outcome.iterations, 0);
assert.equal(initial.outcome.latestObservation.payload.current.levelId, "initial");
assert.equal(initial.attempts.length, 1);
assert.equal(existsSync(initialLog), false);
const invalidSubject = join(root, "invalid-subject.json");
await writeFile(invalidSubject, JSON.stringify({ passed: "invalid", calls: initialLog }));
const invalid = await cli(
  "initial-invalid-subject",
  "@potential-guide/pguide-regulate",
  "pguide-regulate",
  [
    "--pilot",
    uri,
    "--revision",
    fixtureCommit,
    "--subject-file",
    invalidSubject,
    "--target",
    "initial",
  ],
  2,
);
assert.match(JSON.stringify(invalid), /Invalid subject/);
assert.equal(existsSync(initialLog), false);
for (const passed of [2, 3]) {
  const report = await cli(
    `dependency-${passed}`,
    "@potential-guide/pguide-pilot",
    "pguide-probe",
    [
      "--pilot",
      dependentUri,
      "--revision",
      fixtureCommit,
      "--subject-file",
      join(root, `subject-${passed}.json`),
      "--no-reports",
    ],
  );
  assert.equal(report.payload.current.levelId, passed === 2 ? "initial" : "ready");
  if (passed === 2) {
    assert.equal(report.payload.problems[0].currentLevelId, "ready");
    assert.equal(report.payload.problems[0].expectedLevelId, "terminal");
  }
}
const legacy = legacyManifest;
const legacyInput = join(root, "legacy-objective.json");
await writeFile(legacyInput, `${JSON.stringify(legacy, null, 2)}\n`);
const legacyHash = hash(await readFile(legacyInput));
assert.equal(hash(await readFile(join(fixture, "legacy-v1", "objective.yaml"))), legacyHash);
await assert.rejects(async () => parseManifest(await readFile(legacyInput, "utf8")));
const legacyValidation = await cli(
  "legacy-manifest",
  "@potential-guide/pguide-pilot",
  "pguide-validate",
  ["pilot", join(fixture, "legacy-v1")],
  2,
);
assert.match(JSON.stringify(legacyValidation), /objective\/v2.json/);
const migration = resolve(
  await packageRoot("@potential-guide/pilot-protocol"),
  "dist",
  "migrate-cli.js",
);
function migrate(label, args, expectedCode) {
  const result = processRun(process.execPath, [
    "--import",
    pathToFileURL(join(root, "isolation.mjs")).href,
    migration,
    ...args,
    "--output-format",
    "json",
  ]);
  reports.push({ label, command: "objective-contract-migrate", args, ...result });
  assert.equal(result.exitCode, expectedCode, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
const migratedPath = join(root, "migrated-objective.json");
const migrationArgs = ["--format", "manifest", "--input", legacyInput, "--output", migratedPath];
assert.match(
  migrate("migration-needs-review", migrationArgs, 1).error.message,
  /attainment-levels/,
);
assert.equal(existsSync(migratedPath), false);
migrate("migration-explicit", [...migrationArgs, "--attainment-levels", "prepared"], 0);
const migrated = parseManifest(await readFile(migratedPath, "utf8"));
assert.equal(migrated.levels[0].id, "prepared");
const migratedHash = hash(await readFile(migratedPath));
assert.match(
  migrate("migration-no-overwrite", [...migrationArgs, "--attainment-levels", "prepared"], 1).error
    .message,
  /EEXIST/,
);
assert.equal(hash(await readFile(legacyInput)), legacyHash);
assert.equal(hash(await readFile(migratedPath)), migratedHash);
const pinned = {
  objective: legacyUri,
  revision: fixtureCommit,
  targetLevel: "terminal",
  subject: { passed: 3, calls: join(calls, "legacy.txt") },
  objectiveCommit: fixtureCommit,
  objectiveTree: git("rev-parse", "HEAD:legacy-v1"),
};
const portfolioPath = join(root, "legacy-portfolio.json");
await writeFile(
  portfolioPath,
  JSON.stringify({
    schemaVersion: 3,
    goals: [
      {
        id: "legacy",
        objective: pinned.objective,
        revision: pinned.revision,
        subject: pinned.subject,
        targetLevel: pinned.targetLevel,
        priority: 1,
        observationIntervalMs: 1000,
      },
    ],
    resources: [],
  }),
);
const portfolioHash = hash(await readFile(portfolioPath));
const portfolio = await cli(
  "legacy-portfolio",
  "@potential-guide/pguide-supervise",
  "pguide-supervise",
  ["--portfolio-file", portfolioPath],
  2,
);
assert.match(JSON.stringify(portfolio), /schemaVersion: 4/);
assert.equal(hash(await readFile(portfolioPath)), portfolioHash);
const recoveryId = "11111111-1111-4111-8111-111111111111";
const recoveryPath = join(state, "regulations", recoveryId, "regulation.json");
const savedInitial = JSON.parse(
  await readFile(join(state, "regulations", initial.regulationId, "regulation.json"), "utf8"),
);
const legacySource = {
  ...savedInitial.objectiveSource,
  directory: "legacy-v1",
  commit: fixtureCommit,
  tree: pinned.objectiveTree,
};
const legacyRecovery = {
  ...savedInitial,
  schemaVersion: 3,
  regulationId: recoveryId,
  objectiveUri: legacyUri,
  objectiveCommit: fixtureCommit,
  objectiveTree: pinned.objectiveTree,
  objectiveSource: legacySource,
  sourceBindings: { [legacyUri]: legacySource },
  targetLevel: "terminal",
  attempts: [],
};
await put(recoveryPath, JSON.stringify(legacyRecovery));
const recoveryHash = hash(await readFile(recoveryPath));
const recovery = await cli(
  "legacy-recovery",
  "@potential-guide/pguide-regulate",
  "pguide-continue",
  [recoveryId],
  2,
);
assert.match(JSON.stringify(recovery), /Legacy continue records are incompatible/);
assert.equal(hash(await readFile(recoveryPath)), recoveryHash);
const trace = await readFile(join(root, "module-resolutions.jsonl"), "utf8");
const resolutions = trace
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
assert.ok(resolutions.length > 0);
const result = {
  sourceCommit: metadata.sourceCommit,
  fixtureCommit,
  matrixTree: git("rev-parse", "HEAD:matrix"),
  matrix,
  api,
  initialCli: initial,
  migrations: {
    input: legacy,
    output: migrated,
    legacyHash,
    migratedHash,
    portfolioHash,
    recoveryHash,
    pinned,
    recovery: legacyRecovery,
    originalsUnchanged: true,
  },
  installedPackages: graph.size,
  resolvedModulePaths: new Set(resolutions.map(({ path }) => path)).size,
  isolationEscapes: 0,
  reports,
};
await writeFile(join(output, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(
  join(output, "module-resolutions.jsonl"),
  `${resolutions.map((value) => JSON.stringify(value)).join("\n")}\n`,
);
const indexed = new Map();
for (const { specifier, path } of resolutions) {
  const entry = indexed.get(path) ?? { path, resolutions: 0, specifiers: new Set() };
  entry.resolutions++;
  entry.specifiers.add(specifier);
  indexed.set(path, entry);
}
await writeFile(
  join(output, "module-paths.json"),
  `${JSON.stringify(
    {
      rawTraceSha256: hash(trace),
      resolutionCount: resolutions.length,
      paths: [...indexed.values()]
        .map(({ specifiers, ...entry }) => ({
          ...entry,
          specifiers: [...specifiers].sort(),
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify({
    status: "passed",
    sourceCommit: metadata.sourceCommit,
    probeMatrix: matrix.map(({ passed, current }) => ({ passed, current })),
    aliasComparisons: 8,
    initialBusinessChecks: 0,
    initialAgentRuns: 0,
    legacyFilesUnchanged: true,
    installedPackages: graph.size,
    resolvedModulePaths: result.resolvedModulePaths,
  }),
);
