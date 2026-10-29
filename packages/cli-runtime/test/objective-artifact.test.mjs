import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Effect } from "@potential-guide/effects";
import { inspectCheckArtifact } from "@potential-guide/check-artifacts";
import { observe, readPage } from "@potential-guide/objective-pilot";
import { createWorkerHost } from "../../../scripts/worker-test-helpers.mjs";
import { buildExample } from "../examples/objective-artifact/build.mjs";
import { inspectObjectiveArtifact, withPilot } from "../dist/index.js";

async function fixture(t) {
  const scratch = resolve(
    import.meta.dirname,
    "..",
    "..",
    "..",
    ".cache",
    "objective-artifact-tests",
  );
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "case-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifact = await buildExample(join(directory, "delivery"));
  return {
    ...artifact,
    root: directory,
    options: { cacheDirectory: join(directory, "cache"), reports: { enabled: false } },
  };
}
test("public Pilot executes exact multiple Checks, scoped References, cumulative levels and fixed dependency observations", async (t) => {
  const f = await fixture(t);
  const host = await createWorkerHost(join(f.root, "host"));
  const reports = join(f.root, "reports");
  let exactSource;
  try {
    await withPilot(
      f.location,
      f.root,
      undefined,
      async (spec, runtime) => {
        assert.equal(runtime.boundObjectives().length, 2);
        assert.equal(spec.objectiveId, "objective:composition");
        exactSource = spec.source;
        assert.equal(spec.source.checks.first.digest, spec.source.checks.second.digest);
        assert.match(spec.source.checks.prerequisite.revision, /^[a-f0-9]{64}$/);
        assert.match(
          readPage(spec, "checks/first/problems/not-ready", "zh-CN").content,
          /Uncovered references/,
        );
        const overridden = readPage(
          spec,
          "levels/complete/checks/second/problems/not-ready",
          "zh-CN",
        );
        assert.equal(overridden.title, "第二输入场景");
        assert.equal(
          readPage(spec, "levels/complete/checks/second/problems/not-ready", "en").title,
          "Second scenario",
        );
        assert.match(overridden.content, /Only the second reference/);
        assert.deepEqual(overridden.references, ["pages/base-second-not-ready"]);
        assert.equal(overridden.origin.artifactDigest, f.digest);
        const base = readPage(spec, "pages/base-second-not-ready");
        assert.equal(base.origin.artifactDigest, spec.source.checks.second.digest);
        assert.match(base.resourceBase, /artifact\/references\/$/);
        for (const [subject, level, kind] of [
          [{ first: false, second: true, dependencyReady: true }, "initial", "internal"],
          [{ first: true, second: false, dependencyReady: true }, "ready", "internal"],
          [{ first: true, second: true, dependencyReady: false }, "ready", "dependency"],
          [{ first: true, second: true, dependencyReady: true }, "complete", undefined],
        ]) {
          const result = await Effect.runPromise(
            observe({ spec, subject, language: "zh-CN" }, runtime),
          );
          assert.equal(result.status, 200, result.message);
          assert.equal(result.payload.current.levelId, level);
          assert.equal(result.payload.problems[0]?.kind, kind);
          assert.equal(result.payload.sources[spec.objectiveId].artifactDigest, f.digest);
          if (kind === "dependency" || kind === undefined)
            assert.ok(result.payload.versions["objective:composition-prerequisite"]);
        }
        const before = host.diagnostics().executions;
        const initial = await Effect.runPromise(
          observe(
            {
              spec,
              subject: { first: false, second: false, dependencyReady: false },
              targetLevel: "initial",
            },
            runtime,
          ),
        );
        assert.equal(initial.payload.current.levelId, "initial");
        assert.equal(host.diagnostics().executions, before);
        await assert.rejects(
          runtime.resolveObjective("objective:undeclared", undefined, AbortSignal.timeout(1000)),
          /fixed source boundary/,
        );
      },
      { ...f.options, reports: { enabled: true, directory: reports } },
    );
    const runs = await readdir(reports);
    assert.equal(runs.length, 1);
    const events = (await readFile(join(reports, runs[0], "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const prepared = events.find(
      (event) =>
        event.event === "source.prepared" && event.data.objectiveId === "objective:composition",
    );
    assert.deepEqual(prepared.data.source, exactSource);
    assert.ok(prepared.data.source.bindings["objective:composition-prerequisite"]);
    for (const id of ["first", "second", "prerequisite"]) {
      const execution = events.find(
        (event) =>
          event.event === "check.started" &&
          event.data.identity.objectiveId === "objective:composition" &&
          event.data.identity.checkId === id,
      );
      assert.equal(execution.data.identity.artifactDigest, exactSource.checks[id].digest);
      assert.equal(execution.data.identity.revision, exactSource.checks[id].revision);
    }
  } finally {
    await host.close();
  }
});

test("recovery verifies frozen Objective/Check/Host closure without reading mutable author content", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    withPilot(f.directory, f.root, undefined, async () => {}, f.options),
    /require --revision/,
  );
  let frozen;
  await withPilot(
    f.location,
    f.root,
    undefined,
    async (spec, runtime) => {
      frozen = Object.fromEntries(
        runtime.boundObjectives().map((bound) => [bound.objectiveId, bound.source]),
      );
      assert.equal(spec.version, f.digest);
    },
    f.options,
  );
  await rm(join(f.root, "delivery"), { recursive: true, force: true });
  const options = { ...f.options, sources: frozen };
  await assert.rejects(
    withPilot(
      "objective:composition",
      f.root,
      `sha256-pguide-objective-v1:${"0".repeat(64)}`,
      async () => {},
      options,
    ),
    /Conflicting Objective artifact recovery digest/,
  );
  await withPilot(
    "objective:composition",
    f.root,
    undefined,
    async (spec) => {
      assert.equal(spec.version, f.digest);
      assert.deepEqual(spec.source, frozen[spec.objectiveId]);
    },
    options,
  );
  const mismatched = structuredClone(frozen);
  mismatched["objective:composition"].checks.first.revision = "0".repeat(64);
  await assert.rejects(
    withPilot("objective:composition", f.root, undefined, async () => {}, {
      ...f.options,
      sources: mismatched,
    }),
    /differs from recovery evidence/,
  );
  const cached = join(
    f.options.cacheDirectory,
    "objective-artifacts",
    "objectives",
    f.digest.split(":")[1],
    "references",
    "overview.md",
  );
  await chmod(cached, 0o600);
  await writeFile(cached, "# tampered\n");
  await assert.rejects(
    withPilot("objective:composition", f.root, undefined, async () => {}, options),
    /digest mismatch/,
  );
  await rm(join(f.options.cacheDirectory, "objective-artifacts"), { recursive: true, force: true });
  await assert.rejects(
    withPilot("objective:composition", f.root, undefined, async () => {}, options),
    /ENOENT/,
  );
});

test("manifest and References reject floating sources, unknown problems, dangling links and cycles", async (t) => {
  const f = await fixture(t);
  const file = join(f.directory, "objective.json");
  const original = JSON.parse(await readFile(file, "utf8"));
  let invalidCase = 0;
  async function reject(change, expression) {
    const manifest = structuredClone(original);
    change(manifest);
    await writeFile(file, JSON.stringify(manifest));
    const inspected = await inspectObjectiveArtifact(f.directory);
    await assert.rejects(
      withPilot(f.directory, f.root, inspected.digest, async () => {}, {
        ...f.options,
        cacheDirectory: join(f.root, `invalid-${invalidCase++}`),
      }),
      expression,
    );
  }
  await reject((manifest) => {
    manifest.levels[0].checks[0].problems.push("invented");
  }, /not reported/);
  await reject((manifest) => {
    manifest.references["checks/first/problems/invented"] = {
      en: { path: "references/overview.md", title: "Bad", description: "Bad" },
    };
  }, /Unknown.*override/);
  await reject((manifest) => {
    manifest.references["system/overview"].en.references = ["pages/missing"];
  }, /Dangling/);
  await reject((manifest) => {
    manifest.references["system/overview"].en.references = ["system/404"];
    manifest.references["system/404"].en.references = ["system/overview"];
  }, /Cyclic/);
  await writeFile(
    file,
    JSON.stringify({
      ...original,
      checks: {
        ...original.checks,
        first: {
          ...original.checks.first,
          source: { ...original.checks.first.source, digest: "latest" },
        },
      },
    }),
  );
  await assert.rejects(
    inspectObjectiveArtifact(f.directory),
    /Invalid Objective artifact manifest/,
  );
  await writeFile(file, JSON.stringify(original));
  const before = (await inspectObjectiveArtifact(f.directory)).digest;
  const repinned = structuredClone(original);
  repinned.checks.first.source.digest = `sha256-pguide-check-v1:${"0".repeat(64)}`;
  await writeFile(file, JSON.stringify(repinned));
  assert.notEqual((await inspectObjectiveArtifact(f.directory)).digest, before);
  await writeFile(file, JSON.stringify(original));
  await writeFile(join(f.directory, "references", "overview.md"), "# changed\n");
  assert.notEqual((await inspectObjectiveArtifact(f.directory)).digest, before);
});

test("mapped subjects and tampered Check content fail explicitly rather than executing a fallback", async (t) => {
  const f = await fixture(t);
  const path = join(f.directory, "objective.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.checks.first.subject = '{"value":missing}';
  await writeFile(path, JSON.stringify(manifest));
  const artifact = await inspectObjectiveArtifact(f.directory);
  const host = await createWorkerHost(join(f.root, "host"));
  try {
    await withPilot(
      f.directory,
      f.root,
      artifact.digest,
      async (spec, runtime) => {
        const result = await Effect.runPromise(
          observe(
            {
              spec,
              subject: { first: true, second: true, dependencyReady: true },
            },
            runtime,
          ),
        );
        assert.equal(result.status, 502);
        assert.match(result.message, /Missing projection input/);
        assert.equal(host.diagnostics().executions, 0);
      },
      f.options,
    );
  } finally {
    await host.close();
  }
  const worker = join(f.root, "delivery", "value", "worker.cjs");
  await chmod(worker, 0o600);
  await writeFile(worker, "exports.execute=()=>null;");
  await assert.rejects(
    withPilot(f.directory, f.root, artifact.digest, async () => {}, {
      ...f.options,
      cacheDirectory: join(f.root, "new-cache"),
    }),
    /Check artifact content digest mismatch/,
  );
});

test("empty Check combinations retain the existing vacuous cumulative level semantics", async (t) => {
  const f = await fixture(t);
  const path = join(f.directory, "objective.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.levels = [{ id: "ready", checks: [] }];
  manifest.checks = {};
  manifest.dependencies = {};
  manifest.references = Object.fromEntries(
    Object.entries(manifest.references).filter(([id]) =>
      ["system/overview", "system/404", "levels/ready"].includes(id),
    ),
  );
  manifest.resources = ["references/scenario.md"];
  await writeFile(path, JSON.stringify(manifest));
  const artifact = await inspectObjectiveArtifact(f.directory);
  await withPilot(
    f.directory,
    f.root,
    artifact.digest,
    async (spec, runtime) => {
      const result = await Effect.runPromise(
        observe(
          {
            spec,
            subject: { first: false, second: false, dependencyReady: false },
          },
          runtime,
        ),
      );
      assert.equal(result.status, 200, result.message);
      assert.equal(result.payload.current.levelId, "ready");
      assert.deepEqual(spec.source.checks, {});
      assert.equal(spec.source.bindings, undefined);
    },
    f.options,
  );
});

test("an occurrence override in another language does not suppress inherited reference-wide overrides", async (t) => {
  const f = await fixture(t);
  const path = join(f.directory, "objective.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const page = (title) => ({ path: "references/overview.md", title, description: title });
  manifest.references["checks/first"] = { en: page("General Check") };
  manifest.references["levels/ready/checks/first"] = { "zh-CN": page("Localized Check") };
  manifest.references["checks/first/problems/not-ready"] = { en: page("General problem") };
  manifest.references["levels/ready/checks/first/problems/not-ready"] = {
    "zh-CN": page("Localized problem"),
  };
  await writeFile(path, JSON.stringify(manifest));
  const artifact = await inspectObjectiveArtifact(f.directory);
  await withPilot(
    f.directory,
    f.root,
    artifact.digest,
    async (spec) => {
      assert.equal(readPage(spec, "levels/ready/checks/first", "en").title, "General Check");
      assert.equal(readPage(spec, "levels/ready/checks/first", "zh-CN").title, "Localized Check");
      assert.equal(
        readPage(spec, "levels/ready/checks/first/problems/not-ready", "en").title,
        "General problem",
      );
      assert.equal(
        readPage(spec, "levels/ready/checks/first/problems/not-ready", "zh-CN").title,
        "Localized problem",
      );
    },
    f.options,
  );
});

test("Host invocation failures retain their real cause instead of becoming result-schema errors", async (t) => {
  const f = await fixture(t);
  const failing = join(f.root, "failure");
  await cp(join(f.root, "delivery", "value"), failing, { recursive: true });
  const worker = join(failing, "worker.cjs");
  await chmod(worker, 0o600);
  await writeFile(worker, "exports.execute=()=>{throw Error('specific worker failure')};");
  const check = await inspectCheckArtifact(failing);
  const path = join(f.directory, "objective.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.checks.first.source = { kind: "directory", directory: failing, digest: check.digest };
  await writeFile(path, JSON.stringify(manifest));
  const artifact = await inspectObjectiveArtifact(f.directory);
  const host = await createWorkerHost(join(f.root, "host"));
  try {
    await withPilot(
      f.directory,
      f.root,
      artifact.digest,
      async (spec, runtime) => {
        const result = await Effect.runPromise(
          observe(
            {
              spec,
              subject: { first: true, second: true, dependencyReady: true },
            },
            runtime,
          ),
        );
        assert.equal(result.status, 502);
        assert.equal(result.payload, null);
        assert.match(result.message, /specific worker failure/);
        assert.doesNotMatch(result.message, /resultSchema/);
      },
      f.options,
    );
  } finally {
    await host.close();
  }
});
