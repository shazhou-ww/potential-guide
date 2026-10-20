import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect, SubscriptionRef } from "@potential-guide/effects";
import {
  createProcessCheckProbe,
  fileResources,
  loadPilotSpec,
  observe,
  parseCheckEnvelope,
  parseObjectives,
  projectObjective,
} from "@potential-guide/objective-pilot";
import { createPortfolioPlanner } from "@potential-guide/objective-portfolio-supervisor";
import { makeRegulatorSpec, regulate } from "@potential-guide/objective-regulator";
import { main } from "../check.mjs";
import { checkPackage, checkRepository, defaultPolicy } from "../src/index.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const pilotRoot = join(root, "packages", "objective-monorepo-standard");
const rootId =
  "git+https://example.test/monorepo-fixture.git#packages/objective-monorepo-standard/";
const packageId = `${rootId}package-standard/`;
const scratch = join(root, ".cache");
await mkdir(scratch, { recursive: true });

export function context(root, directory = ".") {
  return {
    repository: { id: "https://example.test/target.git" },
    checkout: { id: "urn:fixture:checkout", rootPath: root },
    directory: { absolutePath: join(root, directory), relativePath: directory },
  };
}
function declaration(own, pilot = packageId) {
  return JSON.stringify({
    schemaVersion: 1,
    objectives: {
      standardize: {
        description: "Fixture package preparation",
        pilot,
        inputSchema: { type: "object", additionalProperties: false, maxProperties: 0 },
        subject: JSON.stringify(own),
      },
    },
  });
}
async function fixtureSpec(objectiveId) {
  const local = (uri) =>
    pathToFileURL(join(root, decodeURIComponent(new URL(uri).hash.slice(1)))).href;
  return loadPilotSpec(objectiveId, {
    version: (objectiveId === rootId ? "a" : "b").repeat(40),
    readText: (uri) => fileResources.readText(local(uri)),
    async readPages(uri) {
      return (await fileResources.readPages(local(uri))).map((page) => {
        const remote = new URL(objectiveId);
        remote.hash = relative(root, fileURLToPath(page.uri)).split("\\").join("/");
        return { ...page, uri: remote.href };
      });
    },
  });
}
async function runtimeFor(id, calls = [], failBinding = false) {
  return {
    resolveCheck(ref) {
      calls.push({ id, check: ref.checkId });
      return createProcessCheckProbe({
        command: process.execPath,
        args: [
          join(
            pilotRoot,
            ...(id === rootId ? [] : ["package-standard"]),
            "checks",
            ref.checkId,
            "run.cjs",
          ),
        ],
        cwd: root,
      });
    },
    async resolveObjective(objectiveId) {
      if (failBinding) throw new Error("Controlled source binding failure");
      assert.equal(objectiveId, packageId);
      return {
        spec: await fixtureSpec(objectiveId),
        runtime: await runtimeFor(objectiveId, calls),
      };
    },
  };
}
async function observation(subject, id = rootId, calls = [], failBinding = false) {
  return Effect.runPromise(
    observe({ spec: await fixtureSpec(id), subject }, await runtimeFor(id, calls, failBinding)),
  );
}
async function fixture(run) {
  const target = await mkdtemp(join(scratch, "monorepo-directory-"));
  const write = async (path, value) => {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await writeFile(join(target, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  const own = {
    root: target,
    directory: "packages/shared",
    roles: ["internal"],
    runtime: "universal",
    allows: [],
    entries: ["src/index.ts"],
    generated: [],
    joins: [],
    deliveries: [],
  };
  const subject = {
    context: context(target),
    policy: structuredClone(defaultPolicy),
    deliveries: [],
  };
  const scripts = { build: "MUST_NOT_EXECUTE", check: "MUST_NOT_EXECUTE" };
  try {
    await write("package.json", { name: "independent-target", private: true });
    await write("README.md", "# Independent");
    await write("pnpm-workspace.yaml", "packages: [packages/*, apps/*]");
    await write("turbo.json", {
      tasks: { build: { outputs: ["dist/**"], dependsOn: ["^build"] }, check: { outputs: [] } },
    });
    await write("packages/shared/package.json", { name: "shared", private: true, scripts });
    await write("packages/shared/README.md", "# Shared");
    await write("packages/shared/src/index.ts", "export const value = 1;");
    await write("packages/shared/objectives.yaml", declaration(own));
    await run({ target, write, own, subject, scripts });
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
  }
}

test("ordinary independent package and root use distinct source Objectives and recorded dependency versions", async () => {
  await fixture(async ({ own, subject }) => {
    const isolated = await observation(own, packageId);
    assert.equal(isolated.status, 200, isolated.message);
    assert.equal(isolated.payload.current.levelId, "terminal");
    assert.deepEqual(Object.keys(isolated.payload.versions), [packageId]);
    const calls = [];
    const result = await observation(subject, rootId, calls);
    assert.equal(result.status, 200, result.message);
    assert.equal(result.payload.current.levelId, "terminal", JSON.stringify(result));
    assert.deepEqual(result.payload.versions, {
      [rootId]: "a".repeat(40),
      [packageId]: "b".repeat(40),
    });
    assert.deepEqual(
      calls.map(({ id, check }) => [id === rootId ? "root" : "package", check]),
      [
        ["root", "structure"],
        ["package", "structure"],
        ["package", "deliveries"],
        ["root", "deliveries"],
        ["package", "structure"],
        ["package", "deliveries"],
      ],
    );
  });
});

test("package source failure becomes a real dependency problem, then repaired consumer re-observes terminal", async () => {
  await fixture(async ({ write, own, subject }) => {
    await write("packages/shared/src/index.ts", "import './missing.js';");
    const result = await observation(subject);
    assert.equal(result.status, 200, result.message);
    assert.equal(result.payload.current.levelId, "structured");
    assert.deepEqual(result.payload.problems[0], {
      kind: "dependency",
      objectiveId: packageId,
      subject: own,
      expectedLevelId: "terminal",
      currentLevelId: "structured",
    });
    await write("packages/shared/src/missing.ts", "export {};");
    assert.equal((await observation(subject)).payload.current.levelId, "terminal");
  });
});

test("missing or malformed declarations are root internal structure problems; no dependency is fabricated", async () => {
  await fixture(async ({ target, write, subject }) => {
    await rm(join(target, "packages/shared/objectives.yaml"));
    for (const content of [
      undefined,
      "schemaVersion: [",
      '{"schemaVersion":1,"objectives":{}}',
      declaration({ invalid: true }),
      declaration({}, "../pilot.yaml"),
    ]) {
      if (content !== undefined) await write("packages/shared/objectives.yaml", content);
      const calls = [];
      const result = await observation(subject, rootId, calls);
      assert.equal(result.status, 200, result.message);
      assert.equal(result.payload.current.levelId, "initial");
      assert.ok(result.payload.problems.every((problem) => problem.kind === "internal"));
      assert.ok(
        result.payload.problems[0].parameters.report.findings.some(
          ({ rule }) => rule === "package-objective",
        ),
      );
      assert.deepEqual(calls, [{ id: rootId, check: "structure" }]);
    }
  });
});

test("dependency invocation failure remains an explicit error rather than a fabricated low level", async () => {
  await fixture(async ({ subject }) => {
    const result = await observation(subject, rootId, [], true);
    assert.notEqual(result.status, 200);
    assert.equal(result.payload, null);
    assert.match(result.message, /binding failure|invocation failed/);
    await assert.rejects(
      checkRepository(subject, 2, () => async () => ({
        status: 503,
        payload: null,
        message: "controlled offline source",
      })),
      /invocation failed.*offline source/,
    );
  });
});

test("pnpm exclusion determines package membership rather than directory names or a root list", async () => {
  await fixture(async ({ write, subject }) => {
    await write("packages/excluded/package.json", "{invalid but excluded}");
    await write("pnpm-workspace.yaml", "packages: [packages/*, '!packages/excluded']");
    subject.policy.allowedDirectories.push({
      path: "packages/excluded",
      reason: "Explicit non-workspace fixture.",
    });
    const result = await observation(subject);
    assert.equal(result.status, 200, result.message);
    assert.equal(result.payload.current.levelId, "terminal");
  });
});

test("package-owned delivery mappings and generated-file ownership are independently enforced", async () => {
  await fixture(async ({ own }) => {
    own.deliveries = [
      {
        id: "local",
        purpose: "Package-owned delivery",
        kind: "npm",
        packages: ["shared"],
        entry: { package: "shared", path: "src/absent.ts" },
        runtime: "universal",
        resources: [],
        services: [],
        capabilities: [],
        independent: false,
      },
    ];
    let report = await checkPackage(own);
    assert.ok(report.findings.some(({ rule }) => rule === "entry-coverage"));
    own.deliveries = [];
    own.generated = [
      { path: "src/index.ts", reason: "Fixture" },
      { path: "src/index.ts", reason: "Conflicting duplicate" },
    ];
    report = await checkPackage(own);
    assert.ok(report.findings.some(({ rule }) => rule === "file-assignment"));
  });
});

test("build/check obligations come from scripts and applicable Turbo rather than declaration task lists", async () => {
  await fixture(async ({ write, own }) => {
    for (const scripts of [{ build: "MUST_NOT_EXECUTE" }, { check: "MUST_NOT_EXECUTE" }]) {
      await write("packages/shared/package.json", { name: "shared", private: true, scripts });
      const result = await observation(own, packageId);
      assert.equal(result.payload.current.levelId, "structured");
      assert.ok(
        result.payload.problems[0].parameters.report.findings.some(
          ({ rule }) => rule === "task-graph",
        ),
      );
    }
    await write("packages/shared/package.json", {
      name: "shared",
      private: true,
      scripts: { build: "MUST_NOT_EXECUTE", check: "MUST_NOT_EXECUTE" },
    });
    await write("packages/shared/turbo.json", {
      extends: ["//"],
      tasks: { build: { outputs: [] } },
    });
    assert.ok(
      (await checkPackage(own)).findings.some(
        ({ rule, state }) => rule === "build-outputs" && state === "fail",
      ),
    );
    await write("packages/shared/turbo.json", {
      extends: ["//"],
      tasks: { build: { outputs: ["out/**"] } },
    });
    assert.equal((await checkPackage(own)).state, "pass");
  });
});

test("dependency intent is not inferred from actual manifests and sibling defects are not package-local checks", async () => {
  await fixture(async ({ write, own, subject, scripts }) => {
    await write("packages/other/package.json", { name: "other", private: true });
    await write("packages/shared/package.json", {
      name: "shared",
      private: true,
      scripts,
      dependencies: { other: "workspace:^" },
    });
    const result = await observation(own, packageId);
    assert.equal(result.payload.current.levelId, "structured");
    assert.ok(
      result.payload.problems[0].parameters.report.findings.some(
        ({ rule }) => rule === "dependency-direction",
      ),
    );
    own.allows = ["other"];
    await write("packages/shared/turbo.json", {
      extends: ["//"],
      tasks: { build: { outputs: ["out/**"] } },
    });
    assert.equal((await observation(own, packageId)).payload.current.levelId, "terminal");
    await write("packages/unrelated/package.json", "{malformed");
    assert.equal((await observation(own, packageId)).payload.current.levelId, "terminal");
    assert.equal((await observation(subject)).payload.current.levelId, "initial");
  });
});

test("root retains joint delivery coverage, dependency closure, layout and runtime constraints", async () => {
  await fixture(async ({ write, own, subject, scripts }) => {
    const other = {
      ...own,
      directory: "apps/app",
      roles: ["browser"],
      runtime: "browser",
      allows: ["shared"],
      joins: [{ id: "site", kind: "browser" }],
    };
    own.joins = [{ id: "site", kind: "browser" }];
    own.runtime = "node";
    await write("packages/shared/objectives.yaml", declaration(own));
    await write("apps/app/objectives.yaml", declaration(other));
    await write("apps/app/package.json", {
      name: "app",
      private: true,
      scripts,
      dependencies: { shared: "workspace:^" },
    });
    await write("apps/app/README.md", "# App");
    await write("apps/app/src/index.ts", "export {};");
    subject.deliveries = [
      {
        id: "site",
        purpose: "Shared browser delivery",
        kind: "browser",
        packages: ["app"],
        entry: { package: "app", path: "src/index.ts" },
        runtime: "browser",
        resources: [],
        services: [],
        capabilities: [],
        independent: false,
      },
    ];
    let result = await observation(subject);
    assert.equal(result.payload.current.levelId, "initial");
    assert.ok(
      result.payload.problems[0].parameters.report.findings.some(
        ({ rule }) => rule === "requirement-closure",
      ),
    );
    subject.deliveries[0].packages.push("shared");
    result = await observation(subject);
    assert.equal(result.payload.current.levelId, "structured");
    assert.ok(
      result.payload.problems[0].parameters.report.findings.some(
        ({ rule }) => rule === "runtime-boundary",
      ),
    );
    subject.policy.directories.packages = "modules";
    result = await observation(subject);
    assert.equal(result.payload.current.levelId, "initial");
    assert.ok(
      result.payload.problems[0].parameters.report.findings.some(
        ({ rule }) => rule === "layout-package-role",
      ),
    );
  });
});

test("real repository has twenty package-owned subjects and no old contract input", async () => {
  const entry = parseObjectives(await readFile(join(root, "objectives.yaml"), "utf8")).standardize;
  const subject = projectObjective(entry, context(root), undefined);
  const observed = [];
  const result = await checkRepository(subject, 2, (source) => async (wire) => {
    const report = await checkPackage(wire, 2);
    observed.push({ source, report });
    assert.equal(
      report.state,
      "pass",
      JSON.stringify(
        report.findings.filter(({ state }) => state === "fail" || state === "unverified"),
      ),
    );
    return { status: 200, payload: { ok: true, problems: [] }, message: "" };
  });

  test("Supervisor receives a real regulation handoff, repairs the package and re-observes the consumer", async () => {
    await fixture(async ({ write, subject }) => {
      await write("packages/shared/src/index.ts", "import './missing.js';");
      const spec = await fixtureSpec(rootId);
      const observed = [];
      const planner = await createPortfolioPlanner({
        goals: [
          {
            id: "standardize",
            pilot: spec,
            subject,
            targetLevel: "terminal",
            priority: 3,
            observationIntervalMs: 60000,
          },
        ],
        periodic: false,
        resolveObjective: fixtureSpec,
        observe: async (goal) => {
          observed.push(goal.pilot.objectiveId);
          return observation(goal.subject, goal.pilot.objectiveId);
        },
      });
      const queue = () => Effect.runPromise(SubscriptionRef.get(planner.queue));
      const strategy = {
        targetLevel: "terminal",
        agentExecutionLimits: { timeoutMs: 10000 },
        quota: { timeoutMs: 30000, maxAgentRuns: 1, maxStallRuns: 1 },
      };
      try {
        const rootDemand = (await queue()).demands[0];
        assert.equal(rootDemand.pilot.objectiveId, rootId);
        const handoff = await Effect.runPromise(
          regulate(
            {
              spec: makeRegulatorSpec(spec, strategy, { id: "controlled-local-fixture" }),
              subject,
            },
            {
              pilot: await runtimeFor(rootId),
              executeAgent: async () =>
                assert.fail("The root must hand off, never start a nested Agent."),
            },
          ),
        );
        assert.equal(handoff.stopReason, "dependency-required");
        await planner.feedback({ type: "result", demand: rootDemand, outcome: handoff });
        const child = (await queue()).demands[0];
        assert.equal(child.pilot.objectiveId, packageId);
        let runs = 0;
        const repaired = await Effect.runPromise(
          regulate(
            {
              spec: makeRegulatorSpec(child.pilot, strategy, { id: "controlled-local-fixture" }),
              subject: child.subject,
            },
            {
              pilot: await runtimeFor(packageId),
              async executeAgent(request) {
                runs++;
                assert.deepEqual(request.subject, child.subject);
                await write("packages/shared/src/missing.ts", "export {};");
                return { status: "completed", summary: "Controlled fixture source restored." };
              },
            },
          ),
        );
        assert.equal(repaired.stopReason, "target-reached");
        assert.equal(runs, 1);
        await planner.feedback({ type: "result", demand: child, outcome: repaired });
        await planner.refresh();
        assert.ok(observed.filter((id) => id === rootId).length >= 2);
        assert.equal((await queue()).demands.length, 0);
        const state = await Effect.runPromise(SubscriptionRef.get(planner.state));
        assert.ok(
          Object.values(state.observations).some(
            (entry) =>
              entry.payload?.current.objectiveId === rootId &&
              entry.payload.current.levelId === "terminal",
          ),
        );
      } finally {
        await planner.close();
      }
    });
  });
  assert.equal(observed.length, 20);
  assert.equal(result.report.state, "pass", JSON.stringify(result.report.findings));
  assert.deepEqual(result.problems, []);
  assert.ok(observed.every(({ source }) => source.expectedLevelId === "terminal"));
  assert.throws(() =>
    parseCheckEnvelope({ status: 200, payload: { ok: false, problems: [] }, message: "" }),
  );
  await assert.rejects(
    main("structure", { root, contract: "requirements.json" }),
    /Invalid repository subject/,
  );
});
