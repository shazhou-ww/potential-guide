import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Effect } from "@potential-guide/effects";
import {
  fileResources,
  loadPilotSpec,
  observe,
  type PilotSpec,
  parseCheckEnvelope,
} from "@potential-guide/objective-pilot";
import { root } from "./fixtures.js";

const objective = join(root, "objectives", "development-machine-health");
const helperPath = join(objective, "health-check.mjs");
const health = await import(pathToFileURL(helperPath).href);
const loaded = await loadPilotSpec(join(objective, "pilot.yaml"), fileResources);
const spec: PilotSpec = {
  ...loaded,
  objectiveId:
    "git+https://example.invalid/health.git#objectives/development-machine-health/pilot.yaml",
  version: "1".repeat(40),
};
const subject = {
  environment: "container",
  user: "agent",
  home: "/home/agent",
  workspace: "/home/agent/work",
  scratchDirectory: "/home/agent/tmp",
  cacheDirectory: "/home/agent/cache",
  logDirectory: "/home/agent/logs",
  tasksDirectory: "/home/agent/tasks",
  stacks: ["typescript", "python", "cpp", "rust"],
};
const normalized = health.validateSubject(subject);
const pass = { status: 200, payload: { ok: true, problems: [] }, message: "" } as const;
const ids = (problems: { id: string }[]) => problems.map((p) => p.id);
const now = 1700000000000;
const sample = (measuredAt: number, overrides = {}) => ({
  hostname: "health-fixture",
  user: subject.user,
  home: subject.home,
  measuredAt,
  freeBytes: 1_073_741_824,
  freeInodes: 1024,
  cacheBytes: 0,
  logBytes: 0,
  ...overrides,
});
const history = [sample(now - 1000), sample(now - 500), sample(now)];
const evaluate = (values: unknown[], policy = {}, time = now) =>
  health.evaluateHistory(
    values,
    { ...normalized, policy: { ...normalized.policy, ...policy } },
    { hostname: "health-fixture" },
    time,
  );
function direct(script: string, args: string[], input: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test("health manifest defines five ordered, nonredundant levels and complete zh-CN wiki", () => {
  assert.deepEqual(
    loaded.manifest.levels.map((level) => level.id),
    ["initial", "managed", "system-ready", "development-ready", "orderly"],
  );
  assert.deepEqual(
    loaded.manifest.levels.flatMap((level) => level.advancement.checks.map((check) => check.id)),
    ["identity", "system", "toolchains", "order", "sustainability"],
  );
  const pages = loaded.locales["zh-CN"];
  assert.ok(pages?.["levels/terminal"]);
  assert.match(pages["system/overview"]?.content ?? "", /historyMinSamples=3/);
  for (const level of loaded.manifest.levels) {
    assert.equal(level.advancement.checks.length, 1);
    for (const check of level.advancement.checks) {
      assert.deepEqual(check.problems, health.problemIds[check.id]);
      assert.ok(pages[`checks/${check.id}`]);
      for (const problem of check.problems) {
        const scoped = `levels/${level.id}/checks/${check.id}/problems/${problem}`;
        assert.ok(pages[scoped] ?? pages[`problems/${problem}`], scoped);
      }
    }
  }
});

test("Pilot freshly starts identity, runs each group once, and stops at first blocked level", async () => {
  const calls: string[] = [];
  const runtime = {
    resolveCheck:
      ({ checkId }: { checkId: string }) =>
      async () => {
        calls.push(checkId);
        return pass;
      },
  };
  for (let i = 0; i < 2; i++) {
    calls.length = 0;
    const result = await Effect.runPromise(observe({ spec, subject }, runtime));
    assert.equal(result.payload?.current.levelId, "terminal");
    assert.deepEqual(calls, health.stages);
  }
  calls.length = 0;
  const result = await Effect.runPromise(
    observe(
      { spec, subject },
      {
        resolveCheck:
          ({ checkId }) =>
          async () => {
            calls.push(checkId);
            return checkId === "toolchains"
              ? {
                  status: 200,
                  payload: {
                    ok: false,
                    problems: [{ id: "tool-missing", parameters: { tool: "tsc" } }],
                  },
                  message: "",
                }
              : pass;
          },
      },
    ),
  );
  assert.equal(result.payload?.current.levelId, "system-ready");
  assert.deepEqual(calls, ["identity", "system", "toolchains"]);
});

test("subject defaults are explicit, numeric, and do not mutate caller input", () => {
  assert.equal(normalized.minimumVersions.node, "22.13");
  assert.equal(normalized.minimumVersions.npm, "10");
  assert.equal(normalized.policy.historyMinSamples, 3);
  assert.equal(normalized.policy.historyMinSpanMs, 1000);
  assert.deepEqual(normalized.target, { type: "local" });
  assert.equal("policy" in subject, false);
  assert.deepEqual(
    health.validateSubject({
      ...subject,
      policy: { minFreeBytes: 0 },
      minimumVersions: { git: "2.9" },
    }).minimumVersions,
    { ...health.minimumVersions, git: "2.9" },
  );
});

test("direct and Pilot subject validation reject the same malformed contracts before any probe", async () => {
  const invalid = [
    {},
    { ...subject, extra: true },
    { ...subject, user: "root;echo" },
    { ...subject, user: "agent\n" },
    { ...subject, environment: "windows" },
    { ...subject, home: "/" },
    { ...subject, home: "//home/agent" },
    { ...subject, home: "/../home/agent" },
    { ...subject, home: "/home/./agent" },
    { ...subject, home: "/home/agent/" },
    { ...subject, workspace: "C:\\work" },
    { ...subject, stacks: ["typescript", "typescript"] },
    { ...subject, stacks: ["go"] },
    { ...subject, minimumVersions: { node: "v22" } },
    { ...subject, minimumVersions: { node: "22\n" } },
    { ...subject, minimumVersions: { pnpm: "11" } },
    { ...subject, policy: { historyMinSamples: 2 } },
    { ...subject, policy: { historyMinSamples: Number.MAX_SAFE_INTEGER + 1 } },
    { ...subject, policy: { historyMinSpanMs: 999 } },
    { ...subject, policy: { minFreeBytes: -1 } },
    { ...subject, network: { dns: [] } },
    { ...subject, network: { dns: ["x; echo"], urls: [] } },
    { ...subject, network: { dns: ["localhost\n"], urls: [] } },
    { ...subject, network: { dns: [], urls: ["file:///etc/passwd"] } },
    { ...subject, network: { dns: [], urls: ["http://user:password@localhost/"] } },
    { ...subject, network: { dns: [], urls: ["http://localhost:65536/"] } },
    { ...subject, network: { dns: [], urls: ["http://localhost\n"] } },
    { ...subject, history: [sample(now, { cacheBytes: -1 })] },
    { ...subject, history: [sample(now, { unknown: true })] },
    { ...subject, history: [sample(now, { hostname: "machine\n" })] },
    { ...subject, target: { type: "docker", container: "-bad" } },
    { ...subject, target: { type: "docker", container: "valid\n" } },
    { ...subject, target: { type: "docker", container: "valid", user: "root" } },
  ];
  for (const value of invalid) {
    assert.throws(() => health.validateSubject(value), /invalid-subject/, JSON.stringify(value));
    let invoked = false;
    await assert.rejects(
      Effect.runPromise(
        observe(
          { spec, subject: value },
          {
            resolveCheck: () => async () => {
              invoked = true;
              return pass;
            },
          },
        ),
      ),
      /Invalid subject/,
      JSON.stringify(value),
    );
    assert.equal(invoked, false);
  }
  const valid = {
    ...subject,
    target: { type: "docker", container: "health-test.1" },
    network: { dns: ["localhost"], urls: ["http://127.0.0.1:18080/health"] },
    history,
  };
  health.validateSubject(valid);
  const result = await Effect.runPromise(
    observe({ spec, subject: valid }, { resolveCheck: () => async () => pass }),
  );
  assert.equal(result.payload?.current.levelId, "terminal");
});

test("numeric version comparison and capacity equality do not use lexicographic order", () => {
  assert.equal(health.parseToolVersion("v22.23.3\n"), "22.23.3");
  assert.equal(health.parseToolVersion("Version 5.9.3\n"), "5.9.3");
  assert.equal(health.parseToolVersion("c++ (Debian 12.2.0-14) 12.2.0\n"), "12.2.0");
  assert.equal(health.parseToolVersion("git version 2.39.5\n"), "2.39.5");
  assert.equal(health.parseToolVersion("not a version"), undefined);
  assert.equal(health.compareVersions("2.10", "2.9"), 1);
  assert.equal(health.compareVersions("22.13.0", "22.13"), 0);
  assert.equal(health.compareVersions("1.74.9", "1.75"), -1);
  assert.equal(health.compareVersions("0002.010", "2.9"), 1);
  assert.equal(health.compareVersions(`1.${"9".repeat(400)}`, `1.1${"0".repeat(400)}`), -1);
  assert.deepEqual(health.capacityProblems(100, 10, { minFreeBytes: 100, minFreeInodes: 10 }), []);
  assert.deepEqual(ids(health.capacityProblems(99, 9, { minFreeBytes: 100, minFreeInodes: 10 })), [
    "capacity-low",
    "inodes-low",
  ]);
});

test("sudo requires unrestricted noninteractive command grants, not group membership or defaults", () => {
  assert.equal(health.sudoUnrestricted("    (ALL : ALL) NOPASSWD: ALL\n"), true);
  assert.equal(
    health.sudoUnrestricted(
      "Matching Defaults entries:\n    !requiretty\nUser agent may run the following commands:\n    (ALL) NOPASSWD: ALL\n",
    ),
    true,
  );
  for (const grants of [
    "agent belongs to sudo",
    "    (ALL : ALL) ALL\n",
    "    (root) NOPASSWD: ALL\n",
    "    (ALL) NOPASSWD: /usr/bin/apt-get\n",
    "    (ALL) NOPASSWD: ALL, !/bin/sh\n",
    "    (ALL) NOPASSWD: ALL\n    (ALL) !/bin/sh\n",
  ])
    assert.equal(health.sudoUnrestricted(grants), false, grants);
});

test("history requires real sufficient, fresh, matching and strictly increasing evidence", () => {
  assert.deepEqual(ids(evaluate([])), ["history-insufficient"]);
  assert.deepEqual(ids(evaluate(history.slice(1))), ["history-insufficient"]);
  assert.deepEqual(ids(evaluate([sample(now - 999), sample(now - 500), sample(now)])), [
    "history-insufficient",
  ]);
  assert.deepEqual(evaluate(history), []);
  assert.deepEqual(evaluate(history, {}, now + 300000), []);
  assert.deepEqual(ids(evaluate(history, {}, now + 300001)), ["history-insufficient"]);
  for (const replacement of [
    sample(now, { hostname: "other" }),
    sample(now, { user: "other" }),
    sample(now, { home: "/home/other" }),
    sample(now + 1),
    sample(now - 500),
    sample(now, { freeBytes: -1 }),
  ]) {
    assert.deepEqual(ids(evaluate([history[0], history[1], replacement])), ["history-invalid"]);
  }
  const exact = [
    sample(now - 1000),
    sample(now - 500),
    sample(now, { cacheBytes: 100, logBytes: 50 }),
  ];
  assert.deepEqual(
    evaluate(exact, { maxCacheGrowthBytesPerSecond: 100, maxLogGrowthBytesPerSecond: 50 }),
    [],
  );
  const exceeded = evaluate(exact, {
    maxCacheGrowthBytesPerSecond: 99,
    maxLogGrowthBytesPerSecond: 49,
  });
  assert.deepEqual(ids(exceeded), ["cache-growth", "log-growth"]);
  assert.equal(exceeded[0].parameters.actual, 100);
  assert.deepEqual(
    evaluate([sample(now - 1000, { cacheBytes: 100 }), sample(now - 500), sample(now)]),
    [],
  );
});

test("invalid history identifies the offending sample with bounded target and observed evidence", () => {
  for (const [replacement, reason, field, actual] of [
    [
      sample(now, { hostname: "another-machine" }),
      "identity-mismatch",
      "hostname",
      "another-machine",
    ],
    [sample(now + 1), "future-timestamp", "measuredAt", now + 1],
    [sample(now - 500), "timestamp-order", "measuredAt", now - 500],
    [sample(now, { cacheBytes: -1 }), "invalid-sample", "cacheBytes", -1],
  ] as const) {
    const problem = evaluate([history[0], history[1], replacement])[0];
    assert.equal(problem.id, "history-invalid");
    assert.equal(problem.parameters.index, 2);
    assert.equal(problem.parameters.reason, reason);
    assert.equal(problem.parameters.actual[field], actual);
    assert.deepEqual(problem.parameters.expected, {
      hostname: "health-fixture",
      user: subject.user,
      home: subject.home,
      measuredAt: { greaterThan: now - 500, maximum: now },
      metrics: "finite nonnegative numbers",
    });
  }
  const oversized = sample(now, {
    hostname: "x".repeat(10000),
    unknown: { nested: "must-not-leak".repeat(10000) },
  });
  const problem = evaluate([history[0], history[1], oversized])[0];
  assert.equal(problem.parameters.actual.hostname.length, 256);
  assert.equal("unknown" in problem.parameters.actual, false);
  assert.ok(JSON.stringify(problem.parameters).length < 2048);
});

test("apt dependency simulation distinguishes inconsistent packages from invocation faults", () => {
  const clean = { code: 0, missing: false, stdout: "Reading package lists...\n", stderr: "" };
  assert.equal(health.packageDependencyProblem(clean), null);
  const broken = {
    ...clean,
    code: 100,
    stdout:
      "The following packages have unmet dependencies:\n usr-is-merged : Depends: base-files (>= 12~)",
    stderr: "E: Unmet dependencies. Try 'apt --fix-broken install' with no packages.",
  };
  const problem = health.packageDependencyProblem(broken);
  assert.equal(problem.id, "package-database-unhealthy");
  assert.equal(problem.parameters.tool, "apt-get -s check");
  assert.equal(problem.parameters.expected, "consistent installed package dependencies");
  assert.deepEqual(problem.parameters.actual, {
    code: 100,
    stdout: broken.stdout,
    stderr: broken.stderr,
  });
  assert.match(problem.parameters.recovery, /does not change packages, caches or configuration/);
  const oversized = health.packageDependencyProblem({
    ...broken,
    stdout: `${broken.stdout}${"x".repeat(10000)}`,
    stderr: `${broken.stderr}${"x".repeat(10000)}`,
  });
  assert.equal(oversized.parameters.actual.stdout.length, 4096);
  assert.equal(oversized.parameters.actual.stderr.length, 4096);
  for (const result of [
    { ...clean, code: 127, missing: true },
    { ...clean, code: 100, stderr: "E: Unable to read an unrelated configuration file." },
    { ...broken, code: 2 },
  ])
    assert.throws(() => health.packageDependencyProblem(result), /package-dependency-check/);
});

test("apt freshness accepts genuine successful-refresh evidence without rewriting repository mtimes", () => {
  const policy = { maxPackageIndexAgeSeconds: 10 };
  assert.equal(health.packageIndexProblem([now - 10000], undefined, policy, now), null);
  assert.equal(
    health.packageIndexProblem([now - 10001], undefined, policy, now).id,
    "package-index-stale",
  );
  assert.equal(health.packageIndexProblem([now - 1000000], now, policy, now), null);
  assert.equal(health.packageIndexProblem([now], now - 10000, policy, now), null);
  for (const [indexes, stamp] of [
    [[], now],
    [[now], null],
    [[now], now + 1],
    [[now + 1], now],
    [[now], now - 10001],
  ]) {
    assert.equal(health.packageIndexProblem(indexes, stamp, policy, now).id, "package-index-stale");
  }
});

test("task record validation rejects escape paths, malformed fields and ambiguous lifecycle", () => {
  const active = { id: "build", state: "active", pid: 42, startedAt: now - 1000 };
  assert.equal(health.validateTask(active, subject.scratchDirectory), true);
  for (const task of [
    { ...active, unknown: true },
    { ...active, pid: 0 },
    { ...active, pid: 1.5 },
    { ...active, id: "" },
    { ...active, state: "stopped" },
    { ...active, finishedAt: now },
    { ...active, deadlineAt: now - 1001 },
    { ...active, state: "finished" },
    { ...active, state: "finished", finishedAt: now - 1001 },
    { ...active, temporaryDirectory: subject.scratchDirectory },
    { ...active, temporaryDirectory: `${subject.scratchDirectory}/a/b` },
    { ...active, temporaryDirectory: `${subject.scratchDirectory}/../escape` },
  ])
    assert.equal(health.validateTask(task, subject.scratchDirectory), false, JSON.stringify(task));
});

test("task boundaries preserve healthy long tasks and never conflate deadline with retention", () => {
  const active = { id: "build", state: "active", pid: 42, startedAt: now - 1000 };
  const residue = `${subject.scratchDirectory}/build`;
  const finished = {
    ...active,
    state: "finished",
    finishedAt: now - 1000,
    temporaryDirectory: residue,
  };
  const s = { ...normalized, policy: { ...normalized.policy, retentionSeconds: 1 } };
  const evaluateTasks = (tasks: unknown[], time = now, live = new Set([42])) =>
    health.evaluateTasks(tasks, s, time, live, new Set([residue]));
  assert.deepEqual(evaluateTasks([active]), []);
  assert.deepEqual(evaluateTasks([{ ...active, deadlineAt: now }]), []);
  assert.deepEqual(ids(evaluateTasks([{ ...active, deadlineAt: now - 1 }])), ["task-overdue"]);
  assert.deepEqual(ids(evaluateTasks([{ ...active, pid: undefined }])), ["task-orphaned"]);
  assert.deepEqual(ids(evaluateTasks([active], now, new Set())), ["task-orphaned"]);
  assert.deepEqual(ids(evaluateTasks([finished])), ["task-process-leftover"]);
  assert.deepEqual(evaluateTasks([finished], now, new Set()), []);
  const residueProblem = evaluateTasks([finished], now + 1, new Set())[0];
  assert.equal(residueProblem.id, "task-residue");
  assert.equal(residueProblem.parameters.path, residue);
  assert.equal(residueProblem.parameters.finishedAt, now - 1000);
  assert.deepEqual(residueProblem.parameters.expected, { retentionSeconds: 1 });
  assert.deepEqual(residueProblem.parameters.actual, { ageSeconds: 1.001 });
  assert.deepEqual(ids(evaluateTasks([active, active])), ["task-registry-invalid"]);
  assert.deepEqual(ids(evaluateTasks([{ ...active, startedAt: now + 1 }])), [
    "task-registry-invalid",
  ]);
  assert.deepEqual(health.layoutProblems(normalized), []);
  assert.deepEqual(
    ids(health.layoutProblems({ ...normalized, cacheDirectory: subject.workspace })),
    ["layout-invalid"],
  );
  assert.deepEqual(
    ids(health.layoutProblems({ ...normalized, cacheDirectory: `${subject.workspace}/cache` })),
    ["layout-invalid"],
  );
});

test("helper and all wrappers emit only strict envelopes for malformed input", async () => {
  for (const stage of health.stages) {
    const wrapper = join(objective, "checks", stage, "run.cjs");
    const result = await direct(wrapper, [], "{}");
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = parseCheckEnvelope(JSON.parse(result.stdout));
    assert.equal(parsed.status, 400);
    assert.equal(parsed.payload, null);
    assert.equal(result.stdout.trim().split("\n").length, 1);
  }
  const malformed = await direct(helperPath, ["identity"], "{broken");
  assert.equal(JSON.parse(malformed.stdout).status, 400);
  const invalidStage = await health.check("sample", subject);
  assert.equal(invalidStage.status, 400);
  const invalid = await health.sample({ ...subject, unsupported: true });
  assert.equal(invalid.status, 400);
});

test("native unsupported platforms are explicit faults, never mock success", async (t) => {
  if (process.platform === "linux") return t.skip("covered by native/container functional gate");
  for (const stage of [...health.stages, "sample"]) {
    const result =
      stage === "sample" ? await health.sample(subject) : await health.check(stage, subject);
    assert.equal(result.status, 501);
    assert.equal(result.payload, null);
    assert.match(result.message, /unsupported-platform/);
  }
});

test("subprocesses bound output, execution duration and missing-tool classification", async () => {
  const missing = await health.execute("pguide-health-definitely-not-installed", []);
  assert.equal(missing.missing, true);
  assert.equal(missing.code, 127);
  await assert.rejects(
    health.execute(process.execPath, ["-e", "process.stdout.write('x'.repeat(300000))"]),
    /command-output-limit/,
  );
  await assert.rejects(
    health.execute(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 100 }),
    /command-timeout/,
  );
  await assert.rejects(
    health.execute(process.execPath, ["--version"], { deadline: Date.now() - 1 }),
    /deadline-exceeded/,
  );
});
