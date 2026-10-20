import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  checkPackage,
  checkRepository,
  defaultPolicy,
} from "../packages/objective-monorepo-standard/dist/index.js";
import { parseObjectives, projectObjective } from "../packages/objective-pilot/dist/index.js";
import { execute } from "./verify-deployment-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const reportPath = process.argv[2];
assert.ok(reportPath, "Usage: node scripts/verify-monorepo-pilot.mjs <report.json>");
await mkdir(join(root, ".cache"), { recursive: true });
const scratch = await mkdtemp(join(root, ".cache", "monorepo-consumer-"));
const source = join(scratch, "source");
const target = join(scratch, "target");
const report = {
  schemaVersion: 2,
  provenance:
    "Current generated resources committed only in an owned local Git fixture; not upstream publication.",
  scenarios: [],
  command: "installed pguide-probe (direct extension, no dispatcher PATH ambiguity)",
  realPackages: [],
  cleaned: false,
};
const write = async (base, path, content) => {
  await mkdir(dirname(join(base, path)), { recursive: true });
  await writeFile(
    join(base, path),
    typeof content === "string" ? content : JSON.stringify(content),
  );
};
const git = async (cwd, ...args) => {
  const result = await execute("git", ["--no-pager", ...args], { cwd });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return result.stdout.trim();
};
try {
  await mkdir(source);
  await cp(
    join(root, "packages", "objective-monorepo-standard"),
    join(source, "packages", "objective-monorepo-standard"),
    {
      recursive: true,
      filter: (path) =>
        !relative(join(root, "packages", "objective-monorepo-standard"), path)
          .split(/[\\/]/)
          .some((part) => ["node_modules", "dist", ".turbo", ".cache"].includes(part)),
    },
  );
  await git(source, "init", "--quiet");
  await git(source, "add", ".");
  await git(
    source,
    "-c",
    "user.name=Monorepo fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "Snapshot current standardization Pilots",
  );
  report.commit = await git(source, "rev-parse", "HEAD");
  report.pilot = `git+${pathToFileURL(source).href}#packages/objective-monorepo-standard/`;
  report.packagePilot = `${report.pilot}package-standard/`;
  await write(target, "package.json", { name: "independent-target", private: true });
  await write(target, "README.md", "# Independent target");
  await write(target, "pnpm-workspace.yaml", "packages: [packages/*]");
  await write(target, "turbo.json", {
    tasks: { build: { outputs: ["dist/**"] }, check: { outputs: [] } },
  });
  await write(target, "packages/shared/README.md", "# Shared");
  await write(target, "packages/shared/package.json", {
    name: "shared",
    private: true,
    scripts: { build: "MUST_NOT_EXECUTE", check: "MUST_NOT_EXECUTE" },
  });
  await write(target, "packages/shared/src/index.ts", "export const value = 1;");
  const own = {
    roles: ["internal"],
    runtime: "universal",
    allows: [],
    entries: ["src/index.ts"],
    generated: [],
    joins: [],
    deliveries: [],
  };
  const unit = { type: "object", additionalProperties: false, maxProperties: 0 };
  const packageDeclaration = {
    schemaVersion: 1,
    objectives: {
      standardize: {
        description: "Prepare the fixture package",
        pilot: report.packagePilot,
        inputSchema: unit,
        subject: `{"root":context.checkout.rootPath,"directory":context.directory.relativePath,${JSON.stringify(own).slice(1)}`,
      },
    },
  };
  await write(target, "packages/shared/objectives.yaml", packageDeclaration);
  await write(target, "objectives.yaml", {
    schemaVersion: 1,
    objectives: {
      standardize: {
        description: "Coordinate fixture standardization",
        pilot: report.pilot,
        inputSchema: unit,
        subject: `{"context":context,"policy":${JSON.stringify(defaultPolicy)},"deliveries":[]}`,
      },
    },
  });
  await git(target, "init", "--quiet");
  const config = join(scratch, "config.json");
  await writeFile(config, JSON.stringify({ schemaVersion: 2 }));
  async function probe(id, expectedLevel, cwd = target, expectedKind) {
    const result = await execute(
      "pguide-probe",
      [
        "--objective",
        "standardize",
        "--scope",
        "directory",
        "--revision",
        report.commit,
        "--config",
        config,
        "--cwd",
        cwd,
        "--format",
        "json",
      ],
      {
        cwd,
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
    assert.equal(observation.payload.current.levelId, expectedLevel, result.stdout);
    const identities = cwd === target ? [report.pilot, report.packagePilot] : [report.packagePilot];
    for (const identity of identities) {
      if (expectedKind === "internal" && identity === report.packagePilot) continue;
      const path = new URL(identity).hash.slice(1).replace(/\/$/, "");
      const tree = await git(source, "rev-parse", `${report.commit}:${path}`);
      assert.equal(observation.payload.versions[identity], tree);
      assert.equal(observation.payload.sources[identity].commit, report.commit);
    }
    if (expectedKind)
      assert.ok(observation.payload.problems.some(({ kind }) => kind === expectedKind));
    else assert.deepEqual(observation.payload.problems, []);
    report.scenarios.push({ id, passed: true, observation });
  }
  await probe("independent-package", "terminal", join(target, "packages", "shared"));
  await probe("root-with-dependency-tree-evidence", "terminal");
  await write(target, "packages/shared/src/index.ts", "import './missing.js';");
  await probe("real-package-dependency-handoff", "structured", target, "dependency");
  await write(target, "packages/shared/src/missing.ts", "export {};");
  await probe("repaired-root", "terminal");
  await rm(join(target, "packages", "shared", "objectives.yaml"));
  await probe("missing-declaration-root-internal", "initial", target, "internal");
  await write(target, "packages/shared/objectives.yaml", "schemaVersion: [");
  await probe("damaged-declaration-root-internal", "initial", target, "internal");
  await write(target, "packages/shared/objectives.yaml", packageDeclaration);
  await probe("declaration-repaired", "terminal");

  const context = {
    repository: { id: "https://github.com/shazhou-ww/potential-guide.git" },
    checkout: { id: "urn:verification:current-checkout", rootPath: resolve(root) },
    directory: { absolutePath: resolve(root), relativePath: "." },
  };
  const entry = parseObjectives(await readFile(join(root, "objectives.yaml"), "utf8")).standardize;
  const subject = projectObjective(entry, context, undefined);
  const actual = await checkRepository(subject, 2, (target) => async (subject) => {
    const result = await checkPackage(subject, 2);
    assert.equal(result.state, "pass", JSON.stringify(result));
    report.realPackages.push({
      directory: subject.directory,
      objectiveId: target.objectiveId,
      expectedLevelId: target.expectedLevelId,
      report: result,
    });
    return {
      status: 200,
      payload: { ok: true, problems: [] },
      message: "Direct package checker validation, not Git source observation evidence.",
    };
  });
  assert.equal(report.realPackages.length, 12);
  assert.equal(actual.report.state, "pass", JSON.stringify(actual));
  assert.deepEqual(actual.problems, []);
  report.realRepository = actual;
  report.publication =
    "Parent review/commit and publication of the new Pilot directories are required before the default upstream declaration can be probed normally. No current-worktree commit or push was performed.";
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  report.cleaned = true;
  await mkdir(dirname(resolve(reportPath)), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(
  `Verified ${report.scenarios.length} installed-pguide snapshot scenarios and ${report.realPackages.length} real packages; fixture cleaned.`,
);
