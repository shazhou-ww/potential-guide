import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execute } from "./verify-deployment-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const reportPath = process.argv[2];
assert.ok(reportPath, "Usage: node scripts/verify-monorepo-pilot.mjs <report.json>");
const scratch = await mkdtemp(join(tmpdir(), "pguide-monorepo-consumer-"));
const target = join(scratch, "target");
const report = { schemaVersion: 1, scenarios: [], cleaned: false };
try {
  const revision = await execute("git", ["rev-parse", "HEAD"], { cwd: root });
  assert.equal(revision.code, 0, revision.stderr);
  report.commit = revision.stdout.trim();
  report.pilot = `git+${pathToFileURL(root).href}#packages/objective-monorepo-standard/pilot.yaml`;
  const write = async (path, content) => {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await writeFile(
      join(target, path),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  };
  await write("package.json", { name: "independent-target", private: true });
  await write("README.md", "# Independent target");
  await write("pnpm-workspace.yaml", "packages: [packages/*]");
  await write("turbo.json", { tasks: { build: { outputs: ["dist/**"] } } });
  await write("packages/shared/README.md", "# Shared");
  await write("packages/shared/package.json", {
    name: "shared",
    private: true,
    scripts: { build: "MUST_NOT_EXECUTE" },
  });
  await write("packages/shared/src/index.ts", "export const value = 1;");
  const contract = {
    schemaVersion: 1,
    policy: {
      source: "pnpm-default-v1",
      directories: { apps: "apps", packages: "packages", docs: "docs", scripts: "scripts" },
      requiredFiles: [],
      exceptions: [],
      assignments: [],
      allowedDirectories: [],
      dependencyExceptions: [],
    },
    workspaces: [
      {
        name: "shared",
        path: "packages/shared",
        roles: ["internal"],
        runtime: "universal",
        allows: [],
        entries: ["src/index.ts"],
        sources: ["src/index.ts"],
        tasks: ["build"],
      },
    ],
    deliveries: [],
  };
  await write("requirements.json", contract);
  await writeFile(
    join(scratch, "subject.json"),
    JSON.stringify({ root: target, contract: "requirements.json" }),
  );
  const config = join(scratch, "config.json");
  await writeFile(config, JSON.stringify({ schemaVersion: 2 }));
  async function probe(id, level, problemId) {
    const result = await execute(
      process.execPath,
      [
        join(root, "packages", "pguide", "dist", "bin", "probe.js"),
        "--pilot",
        report.pilot,
        "--revision",
        report.commit,
        "--subject-file",
        join(scratch, "subject.json"),
        "--config",
        config,
        "--cwd",
        scratch,
        "--format",
        "json",
      ],
      {
        cwd: scratch,
        env: {
          ...process.env,
          NODE_PATH: "",
          HOME: scratch,
          USERPROFILE: scratch,
          APPDATA: scratch,
          XDG_CONFIG_HOME: scratch,
          PGUIDE_STATE_DIRECTORY: join(scratch, "state"),
        },
      },
    );
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const observation = JSON.parse(result.stdout);
    assert.equal(observation.status, 200, result.stdout);
    assert.equal(observation.payload.current.levelId, level, result.stdout);
    assert.equal(observation.payload.versions[report.pilot], report.commit);
    if (problemId)
      assert.ok(observation.payload.problems.some(({ ref }) => ref.problemId === problemId));
    else assert.deepEqual(observation.payload.problems, []);
    report.scenarios.push({ id, passed: true, observation });
  }
  await probe("valid-independent-target-no-checkerModule", "terminal");
  await write("packages/shared/src/index.ts", "import './missing.js';");
  await probe("delivery-import-gap", "structured", "delivery-incomplete");
  await write("packages/shared/src/index.ts", "export const value = 1;");
  await probe("delivery-repaired", "terminal");
  await write("requirements.json", { schemaVersion: 99 });
  await probe("structure-invalid-contract", "initial", "structure-incomplete");
  await write("requirements.json", contract);
  await probe("structure-repaired", "terminal");
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  report.cleaned = true;
  await mkdir(dirname(resolve(reportPath)), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(
  "Committed monorepo Pilot: isolated target, positive/negative and repaired terminal verified.",
);
