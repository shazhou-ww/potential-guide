import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const source = "/work/monorepo-source";
const root = await mkdtemp("/work/runs/monorepo-installed-");
const target = join(root, "target");
const report = { sourceRevision: "6c75d927aaefe361cb85746c055cb1a01114ad1c", consumer: "/opt/consumer/node_modules/.bin/pguide", scenarios: [] };
const git = async (...args) => (await execute("git", ["-C", source, ...args])).stdout.trim();
try {
  await git("init", "-q");
  await git("config", "user.name", "Isolated Pilot fixture");
  await git("config", "user.email", "fixture@example.invalid");
  await git("add", ".");
  await git("-c", "commit.gpgsign=false", "commit", "-qm", "Exact archived monorepo Pilot");
  report.objectiveRevision = await git("rev-parse", "HEAD");
  report.pilot = "git+file:///work/monorepo-source#packages/monorepo-objective/pilot.yaml";
  const write = async (path, value) => {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await writeFile(join(target, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  await write("package.json", { name: "isolated", private: true });
  await write("README.md", "# Target");
  await write("pnpm-workspace.yaml", "packages: [packages/*]");
  await write("turbo.json", { tasks: { build: { outputs: ["dist/**"] } } });
  await write("packages/shared/package.json", { name: "shared", private: true, scripts: { build: "MUST_NOT_EXECUTE" } });
  await write("packages/shared/README.md", "# Shared");
  await write("packages/shared/src/index.ts", "export const value = 1;");
  const contract = {
    schemaVersion: 1,
    policy: {
      source: "pnpm-default-v1", directories: { apps: "apps", packages: "packages", docs: "docs", scripts: "scripts" },
      requiredFiles: [], exceptions: [], assignments: [], allowedDirectories: [], dependencyExceptions: [],
    },
    workspaces: [{ name: "shared", path: "packages/shared", roles: ["internal"], runtime: "universal", allows: [], entries: ["src/index.ts"], sources: ["src/index.ts"], tasks: ["build"] }],
    deliveries: [],
  };
  await write("requirements.json", contract);
  const subject = join(root, "subject.json");
  const config = join(root, "config.json");
  await writeFile(subject, JSON.stringify({ root: target, contract: "requirements.json" }));
  await writeFile(config, '{"schemaVersion":2}');
  async function probe(id, level, problem) {
    const result = await execute(report.consumer, [
      "probe", "--pilot", report.pilot, "--revision", report.objectiveRevision,
      "--subject-file", subject, "--config", config, "--cwd", root, "--format", "json",
    ], {
      cwd: root,
      env: { HOME: "/work/home", PATH: "/opt/consumer/node_modules/.bin:/usr/local/bin:/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      maxBuffer: 1048576,
    });
    const observation = JSON.parse(result.stdout);
    assert.equal(observation.status, 200);
    assert.equal(observation.payload.current.levelId, level, result.stdout);
    assert.equal(observation.payload.versions[report.pilot], report.objectiveRevision);
    if (problem) assert.ok(observation.payload.problems.some(({ ref }) => ref.problemId === problem));
    else assert.deepEqual(observation.payload.problems, []);
    report.scenarios.push({ id, observation, passed: true });
  }
  await probe("positive-no-checkerModule", "terminal");
  await write("packages/shared/src/index.ts", 'import "./missing.js";');
  await probe("delivery-failure", "structured", "delivery-incomplete");
  await write("packages/shared/src/index.ts", "export const value = 1;");
  await probe("delivery-repaired", "terminal");
  await write("requirements.json", { schemaVersion: 99 });
  await probe("structure-failure", "initial", "structure-incomplete");
  await write("requirements.json", contract);
  await probe("structure-repaired", "terminal");
} finally {
  await rm(root, { recursive: true, force: true });
  report.cleaned = true;
  await writeFile("/work/monorepo-installed.json", `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ scenarios: report.scenarios.length, cleaned: report.cleaned, verified: true }));
