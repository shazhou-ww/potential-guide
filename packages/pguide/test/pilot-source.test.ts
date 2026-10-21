import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as filesystem } from "node:fs";
import { cp, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { CliError } from "@potential-guide/cli-core";
import { Effect } from "@potential-guide/effects";
import { type ObjectiveManifest, observe } from "@potential-guide/objective-pilot";
import { withPilot } from "../../cli-runtime/src/pilot-source.js";
import { manifest, fixture as wikiFixture } from "../../objective-pilot/test/fixtures.js";

const execute = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  return (await execute("git", ["-C", cwd, ...args], { windowsHide: true })).stdout.trim();
}
const successfulProbe =
  '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({status: 200, message: "", payload:{ok:true,problems:[]}}));\n';

async function repository(config: ObjectiveManifest, origin?: string) {
  const scratch = resolve(".cache", "pilot-source-tests");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "pguide-source-test-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "Pilot Test");
  await git(root, "config", "user.email", "pilot@example.invalid");
  const identity = origin ?? pathToFileURL(root).href;
  await git(root, "remote", "add", "origin", identity);
  const uri = `git+${identity}#objective/`;
  const data = wikiFixture({ [uri]: config });
  for (const [resource, source] of [
    ...data.texts,
    ...[...data.pages.values()].flat().map(({ uri, source }) => [uri, source] as const),
  ] as const) {
    const path = join(root, ...decodeURIComponent(new URL(resource).hash.slice(1)).split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  }
  return {
    root,
    uri,
    path: join(root, "objective"),
    async check(path: string, source = successfulProbe) {
      const entry = join(root, "objective", ...path.split("/"));
      await mkdir(dirname(entry), { recursive: true });
      await writeFile(entry, source);
      return entry;
    },
    async commit() {
      await git(root, "add", ".");
      await git(root, "commit", "-qm", "Committed Pilot fixture");
      return git(root, "rev-parse", "HEAD");
    },
  };
}

test("local Pilot maps origin identity but reads its exact local commit without fetching origin", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
    "https://not-a-reachable-origin.invalid/objectives.git",
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  const script = await repo.check("checks/ready/run.cjs");
  const commit = await repo.commit();
  const tree = await git(repo.root, "rev-parse", `${commit}:objective`);
  const result = await withPilot(repo.path, repo.root, undefined, async (spec, runtime) => {
    assert.equal(spec.objectiveId, repo.uri);
    assert.equal(spec.version, tree);
    assert.equal(spec.source?.commit, commit);
    // Concurrent checkout edits must not mutate an already-bound immutable source.
    await writeFile(script, "process.exit(7);");
    return Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime));
  });
  assert.ok(result.payload !== null);
  assert.equal(result.payload.current.levelId, "ready");
  assert.deepEqual(result.payload.versions, { [repo.uri]: tree });
  await assert.rejects(
    withPilot(repo.path, repo.root, undefined, async () => undefined),
    /dirty|uncommitted/,
  );
});

test("level-scoped repeated check IDs execute their own committed probes", async (t) => {
  const repo = await repository(manifest());
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await repo.check("levels/z-first/checks/one/run.cjs");
  await repo.check("levels/z-first/checks/two/run.cjs");
  await repo.check("levels/a-next/checks/one/run.cjs");
  await repo.commit();
  const result = await withPilot(repo.path, repo.root, undefined, (spec, runtime) =>
    Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime)),
  );
  assert.ok(result.payload !== null);
  assert.equal(result.payload.current.levelId, "a-next");
});

test("folder tree versions cover manifest, scripts, References and resources, not unrelated commits; moves change identity", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await repo.check("checks/ready/run.cjs");
  await repo.commit();
  const bind = (location = repo.path) =>
    withPilot(location, repo.root, undefined, async (spec) => spec);
  let previous = await bind();
  for (const [path, source] of [
    [
      "objective.yaml",
      `${JSON.stringify(manifest({ levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }] }))}\n`,
    ],
    ["checks/ready/run.cjs", `${successfulProbe}\n`],
    [
      "references/system/overview/en-US.md",
      "---\ntitle: Updated\ndescription: Updated reference\nreferences: []\n---\nContent.\n",
    ],
    ["asset.bin", "content"],
  ] as const) {
    await writeFile(join(repo.path, ...path.split("/")), source);
    await repo.commit();
    const next = await bind();
    assert.notEqual(next.version, previous.version, path);
    assert.equal(
      next.version,
      await git(repo.root, "rev-parse", `${next.source?.commit}:objective`),
    );
    previous = next;
  }
  await writeFile(join(repo.root, "unrelated"), "not inside Pilot");
  await repo.commit();
  const unchanged = await bind();
  assert.equal(unchanged.version, previous.version);
  assert.notEqual(unchanged.source?.commit, previous.source?.commit);
  assert.notEqual(unchanged.source?.repositoryTree, previous.source?.repositoryTree);
  await cp(repo.path, join(repo.root, "same-tree"), { recursive: true });
  await repo.commit();
  const duplicate = await bind(join(repo.root, "same-tree"));
  assert.equal(duplicate.version, unchanged.version);
  assert.notEqual(duplicate.objectiveId, unchanged.objectiveId);
  await rename(join(repo.root, "same-tree"), join(repo.root, "moved"));
  await repo.commit();
  const moved = await bind(join(repo.root, "moved"));
  assert.equal(moved.version, duplicate.version);
  assert.notEqual(moved.objectiveId, duplicate.objectiveId);
  await assert.rejects(
    withPilot(moved.objectiveId, repo.root, moved.version, async () => undefined),
    /commit|Git|fetch/i,
  );
});

test("repository-root Pilot has canonical #/ identity and a verified root tree", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await repo.check("checks/ready/run.cjs");
  for (const name of await filesystem.readdir(repo.path))
    await rename(join(repo.path, name), join(repo.root, name));
  await rm(repo.path, { recursive: true });
  const commit = await repo.commit();
  const result = await withPilot(repo.root, repo.root, undefined, async (spec, runtime) => {
    assert.match(spec.objectiveId, /#\/$/);
    assert.equal(spec.version, await git(repo.root, "rev-parse", `${commit}^{tree}`));
    assert.equal(spec.source?.directory, "");
    return Effect.runPromise(observe({ spec, subject: { name: "root" } }, runtime));
  });
  assert.equal(result.payload?.current.levelId, "ready");
});

test("same repository folders can bind different retrieval commits and reject forged tree evidence", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await repo.check("checks/ready/run.cjs");
  await cp(repo.path, join(repo.root, "other"), { recursive: true });
  const old = await repo.commit();
  const otherUri = repo.uri.replace("#objective/", "#other/");
  const other = await withPilot(otherUri, repo.root, old, async (spec) => spec);
  assert.ok(other.source);
  await writeFile(join(repo.root, "other", "asset"), "updated");
  await repo.commit();
  await withPilot(repo.path, repo.root, undefined, async (spec, runtime) => {
    assert.ok(runtime.resolveObjective);
    const oldBinding = await runtime.resolveObjective(
      otherUri,
      other.version,
      new AbortController().signal,
      other.source,
    );
    assert.equal(oldBinding.spec.source?.commit, old);
    assert.equal(oldBinding.spec.version, other.version);
    assert.notEqual(spec.source?.commit, old);
    await assert.rejects(
      runtime.resolveObjective(
        otherUri,
        "0".repeat(40),
        new AbortController().signal,
        other.source,
      ),
      /mismatch|evidence|version/,
    );
  });
});

test("batched materialization preserves binary resources outside the Pilot directory", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeFile(join(repo.root, "binary resource.dat"), Buffer.from([0, 10, 13, 255]));
  await repo.check(
    "checks/ready/run.cjs",
    `#!/usr/bin/env node
const {readFileSync} = require("node:fs");
const {resolve} = require("node:path");
const data = readFileSync(resolve(__dirname, "../../..", "binary resource.dat"));
process.stdout.write(JSON.stringify({status:200,message:"",payload:{ok:data.equals(Buffer.from([0,10,13,255])),problems:[]}}));
`,
  );
  await repo.commit();
  const result = await withPilot(repo.path, repo.root, undefined, (spec, runtime) =>
    Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime)),
  );
  assert.equal(result.payload?.current.levelId, "ready");
});

test("nested Pilot sources stay in the owning probe directory and preserve unrelated files", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await repo.check("checks/ready/run.cjs");
  const revision = await repo.commit();
  const parent = await mkdtemp(join(resolve(".cache"), "p-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  await writeFile(join(parent, "sentinel"), "keep");
  const previous = process.env.PGUIDE_PROBE_TEMP_DIR;
  try {
    process.env.PGUIDE_PROBE_TEMP_DIR = parent;
    const result = await withPilot(repo.uri, repo.root, revision, async (spec, runtime) => {
      const entries = await filesystem.readdir(join(parent, "sources"));
      assert.equal(entries.length, 1);
      assert.match(entries[0] as string, /^pguide-runtime-/);
      return Effect.runPromise(observe({ spec, subject: { name: "nested" } }, runtime));
    });
    assert.equal(result.payload?.current.levelId, "ready");
    assert.deepEqual(await filesystem.readdir(join(parent, "sources")), []);
    assert.equal(await filesystem.readFile(join(parent, "sentinel"), "utf8"), "keep");
    process.env.PGUIDE_PROBE_TEMP_DIR = "relative-probe-directory";
    await assert.rejects(
      withPilot(repo.uri, repo.root, revision, async () => undefined),
      /Invalid PGUIDE_PROBE_TEMP_DIR/,
    );
  } finally {
    if (previous === undefined) delete process.env.PGUIDE_PROBE_TEMP_DIR;
    else process.env.PGUIDE_PROBE_TEMP_DIR = previous;
  }
});

test("ambiguous flat executables and multiple run entries fail explicitly", async (t) => {
  const repo = await repository(manifest());
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await repo.check("checks/one/run.cjs");
  await repo.check("checks/two/run.cjs");
  await repo.commit();
  await assert.rejects(
    withPilot(repo.path, repo.root, undefined, async () => undefined),
    /level-scoped/,
  );
  await repo.check("levels/z-first/checks/one/run.cjs");
  await repo.check("levels/z-first/checks/one/run.js");
  await repo.commit();
  await assert.rejects(
    withPilot(repo.path, repo.root, undefined, async () => undefined),
    /exactly one/,
  );
});

test("explicit Git URI can select an older exact commit independently of current checkout", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  const script = await repo.check("checks/ready/run.cjs");
  const old = await repo.commit();
  const oldTree = await git(repo.root, "rev-parse", `${old}:objective`);
  await writeFile(script, "process.exit(9);");
  await repo.commit();
  const result = await withPilot(repo.uri, repo.root, old, (spec, runtime) => {
    assert.equal(spec.version, oldTree);
    assert.equal(spec.source?.commit, old);
    return Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime));
  });
  assert.ok(result.payload !== null);
  assert.equal(result.payload.current.levelId, "ready");
  const local = await withPilot(repo.path, repo.root, old, (spec, runtime) => {
    assert.equal(spec.version, oldTree);
    assert.equal(spec.objectiveId, repo.uri);
    return Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime));
  });
  assert.ok(local.payload !== null);
  assert.equal(local.payload.current.levelId, "ready");
  await assert.rejects(
    withPilot(repo.path, repo.root, "HEAD", async () => undefined),
    {
      exitCode: 2,
      status: "pilot-error",
    },
  );
});

test("cross-process dependency source binding preserves exact commits, routing and cleanup", async (t) => {
  const levels: ObjectiveManifest["levels"] = [
    { id: "ready", checks: [{ id: "ready", problems: ["broken"] }] },
  ];
  const child = await repository(manifest({ levels }));
  t.after(() => rm(child.root, { recursive: true, force: true }));
  const childScript = await child.check(
    "checks/ready/run.cjs",
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({status:200,payload:{ok:false,problems:[{kind:"internal",id:"broken",parameters:{directory:process.cwd()}}]},message:""}));
`,
  );
  const childCommit = await child.commit();
  const childTree = await git(child.root, "rev-parse", `${childCommit}:objective`);
  const parent = await repository(manifest({ levels }));
  t.after(() => rm(parent.root, { recursive: true, force: true }));
  await parent.check(
    "checks/ready/run.cjs",
    `#!/usr/bin/env node
(async () => {
  const {createSourceObjectiveDependencyProbe} = await import("@potential-guide/objective-pilot");
  let source = ""; for await (const chunk of process.stdin) source += chunk;
  const probe = createSourceObjectiveDependencyProbe({objectiveId:${JSON.stringify(child.uri)},expectedLevelId:"terminal"});
  const envelope = await probe(JSON.parse(source), new AbortController().signal);
  process.stdout.write(JSON.stringify(envelope));
})().catch(error => { console.error(error); process.exitCode = 1; });
`,
  );
  const parentCommit = await parent.commit();
  const parentTree = await git(parent.root, "rev-parse", `${parentCommit}:objective`);
  let pinnedSources: NonNullable<
    import("@potential-guide/objective-pilot").PilotObservation["sources"]
  > = {};
  assert.notEqual(parentCommit, childCommit);
  let checkDirectory = "";
  await withPilot(parent.path, parent.root, undefined, async (spec, runtime) => {
    assert.equal(spec.version, parentTree);
    const first = await Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime));
    assert.ok(first.payload !== null);
    assert.equal(first.payload.current.objectiveId, parent.uri);
    assert.equal(first.payload.problems[0]?.kind, "dependency");
    assert.deepEqual(first.payload.versions, {
      [parent.uri]: parentTree,
      [child.uri]: childTree,
    });
    assert.ok(first.payload.sources);
    pinnedSources = first.payload.sources;
    assert.equal(pinnedSources[child.uri]?.commit, childCommit);
    assert.ok(runtime.resolveObjective);
    const binding = await runtime.resolveObjective(
      child.uri,
      childTree,
      new AbortController().signal,
      pinnedSources[child.uri],
    );
    const detail = await binding.runtime.resolveCheck({
      objectiveId: child.uri,
      levelId: "ready",
      checkId: "ready",
    })({ name: "repo" }, new AbortController().signal);
    const problem = detail.payload?.problems[0];
    const directory = problem?.kind === "internal" ? problem.parameters.directory : undefined;
    assert.equal(typeof directory, "string");
    if (typeof directory !== "string") throw new Error("Expected child check directory.");
    checkDirectory = directory;
    assert.match(checkDirectory, /checkout-1/);
    await writeFile(childScript, successfulProbe);
    await child.commit();
    const second = await Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime));
    assert.ok(second.payload !== null);
    assert.equal(second.payload.current.objectiveId, parent.uri);
    assert.equal(second.payload.current.levelId, "initial");
    assert.equal(second.payload.versions[child.uri], childTree);
  });
  await assert.rejects(stat(checkDirectory), { code: "ENOENT" });
  const refreshed = await withPilot(parent.path, parent.root, undefined, (spec, runtime) =>
    Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime)),
  );
  assert.ok(refreshed.payload !== null);
  assert.equal(refreshed.payload.current.objectiveId, parent.uri);
  assert.equal(refreshed.payload.current.levelId, "ready");
  const pinned = await withPilot(
    parent.uri,
    parent.root,
    parentCommit,
    (spec, runtime) => Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime)),
    { versions: { [parent.uri]: parentTree, [child.uri]: childTree }, sources: pinnedSources },
  );
  assert.ok(pinned.payload !== null);
  assert.equal(pinned.payload.current.objectiveId, parent.uri);
  assert.equal(pinned.payload.current.levelId, "initial");
  assert.equal(pinned.payload.versions[child.uri], childTree);
  const originalRead = filesystem.readFile;
  let delayed = 0;
  try {
    t.mock.method(
      filesystem,
      "readFile",
      async (...args: Parameters<typeof filesystem.readFile>) => {
        if (String(args[0]).includes("checkout-1")) {
          delayed++;
          const options = args[1];
          const signal =
            typeof options === "object" && options !== null ? options.signal : undefined;
          await delay(8000, undefined, { signal });
        }
        return originalRead(...args);
      },
    );
    syncBuiltinESMExports();
    const sourceDeadline = await withPilot(
      parent.path,
      parent.root,
      undefined,
      (spec, runtime) => Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime)),
      {
        preparationTimeoutMs: 3000,
        probeTimeoutMs: 15000,
        observationBudget: { timeoutMs: 10000, maxDepth: 8, maxObservations: 16 },
        reports: { enabled: false },
      },
    );
    assert.equal(sourceDeadline.payload, null);
    assert.match(
      sourceDeadline.message,
      /source-preparation-timeout:.*dependency source preparation/,
    );
    const before = delayed;
    await assert.rejects(
      withPilot(
        parent.path,
        parent.root,
        undefined,
        (spec, runtime) => Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime)),
        {
          preparationTimeoutMs: 10000,
          probeTimeoutMs: 15000,
          observationBudget: { timeoutMs: 1500, maxDepth: 8, maxObservations: 16 },
          reports: { enabled: false },
        },
      ),
      /observation-timeout:.*total observation deadline/,
    );
    assert.ok(
      delayed > before,
      "The total deadline must expire during lazy preparation, not before its request.",
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("Git source failure is reported as explicit pilot-error exit 2", async () => {
  const missing = pathToFileURL(join(process.cwd(), ".cache", "nonexistent-pilot-repository")).href;
  await assert.rejects(
    withPilot(
      `git+${missing}#objective.yaml`,
      process.cwd(),
      "a".repeat(40),
      async () => undefined,
    ),
    {
      exitCode: 2,
      status: "pilot-error",
    },
  );
});

test("source preparation has its own deadline and releases only its owned cache", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await repo.check("checks/ready/run.cjs");
  const revision = await repo.commit();
  const cache = await mkdtemp(join(resolve(".cache"), "preparation-deadline-"));
  t.after(() => rm(cache, { recursive: true, force: true }));
  await writeFile(join(cache, "sentinel"), "keep");
  let called = false;
  await assert.rejects(
    withPilot(
      repo.uri,
      repo.root,
      revision,
      async () => {
        called = true;
      },
      { cacheDirectory: cache, preparationTimeoutMs: 1 },
    ),
    /Pilot source preparation timed out after 1ms/,
  );
  assert.equal(called, false);
  assert.deepEqual(await filesystem.readdir(cache), ["sentinel"]);
  for (const preparationTimeoutMs of [0, -1, Number.NaN, 2 ** 31]) {
    await assert.rejects(
      withPilot(repo.uri, repo.root, revision, async () => undefined, {
        cacheDirectory: cache,
        preparationTimeoutMs,
      }),
      /preparationTimeoutMs must be a positive safe timer duration/,
    );
  }
});

test("host-owned input views are immutable within a round, refreshed between rounds and cleaned before return", async (t) => {
  const repo = await repository(
    manifest({
      subjectSchema: {
        type: "object",
        required: ["root"],
        properties: { root: { type: "string" } },
        additionalProperties: false,
      },
      levels: [
        { id: "first", checks: [{ id: "first", problems: ["broken"] }] },
        { id: "last", checks: [{ id: "last", problems: ["broken"] }] },
      ],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeFile(
    join(repo.path, "observation-inputs.json"),
    JSON.stringify({
      contract: "bounded-readonly-filesystem-v1",
      subjectRoot: ["root"],
    }),
  );
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
(async () => {
let input = ""; for await (const chunk of process.stdin) input += chunk;
const view = process.env.PGUIDE_INPUT_VIEW ? JSON.parse(fs.readFileSync(process.env.PGUIDE_INPUT_VIEW, "utf8")) : undefined;
const text = view ? view.entries["input.txt"].text : fs.readFileSync(require("node:path").join(JSON.parse(input).root, "input.txt"), "utf8");
const ok = text === "before";
process.stdout.write(JSON.stringify({status:200,message:"",payload:ok?{ok:true,problems:[]}:{ok:false,problems:[{kind:"internal",id:"broken",parameters:{viewPath:process.env.PGUIDE_INPUT_VIEW}}]}}));
})().catch(error => {console.error(error); process.exitCode = 1;});
`;
  await repo.check("checks/first/run.cjs", source);
  await repo.check("checks/last/run.cjs", source);
  await repo.commit();
  const target = await mkdtemp(join(resolve(".cache", "pilot-source-tests"), "input-view-target-"));
  t.after(() => rm(target, { recursive: true, force: true }));
  await writeFile(join(target, "input.txt"), "before");
  await withPilot(
    repo.path,
    repo.root,
    undefined,
    async (spec, runtime) => {
      let changed = false;
      const wrapped = {
        ...runtime,
        resolveCheck: (ref: Parameters<typeof runtime.resolveCheck>[0]) => {
          const invoke = runtime.resolveCheck(ref);
          return async (subject: Parameters<typeof invoke>[0], signal: AbortSignal) => {
            const result = await invoke(subject, signal);
            if (!changed) {
              changed = true;
              await writeFile(join(target, "input.txt"), "after");
            }
            return result;
          };
        },
      };
      const first = await Effect.runPromise(observe({ spec, subject: { root: target } }, wrapped));
      assert.equal(first.payload?.current.levelId, "last");
      const second = await Effect.runPromise(observe({ spec, subject: { root: target } }, wrapped));
      assert.equal(second.payload?.current.levelId, "initial");
      const problem = second.payload?.problems[0];
      assert.equal(problem?.kind, "internal");
      if (problem?.kind !== "internal") throw new Error("Expected fresh target failure.");
      const path = problem.parameters.viewPath;
      assert.equal(typeof path, "string");
      await assert.rejects(stat(String(path)), { code: "ENOENT" });
      const originalOpen = filesystem.open;
      let partial = "";
      try {
        t.mock.method(filesystem, "open", async (...args: Parameters<typeof filesystem.open>) => {
          const handle = await originalOpen(...args);
          if (String(args[0]).includes("input-view-") && args[1] === "wx") {
            partial = String(args[0]);
            const write = handle.writeFile.bind(handle);
            t.mock.method(handle, "writeFile", async () => {
              await write("{");
              throw new Error("Injected input view write failure.");
            });
          }
          return handle;
        });
        syncBuiltinESMExports();
        const failed = await Effect.runPromise(
          observe({ spec, subject: { root: target } }, wrapped),
        );
        assert.equal(failed.payload, null);
        assert.match(failed.message, /Injected input view write failure/);
        assert.ok(partial);
        await assert.rejects(stat(partial), { code: "ENOENT" });
      } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      }
      const originalReadDirectory = filesystem.readdir;
      const timings: string[] = [];
      const priorTimings = process.env.PGUIDE_TIMINGS;
      try {
        process.env.PGUIDE_TIMINGS = "1";
        t.mock.method(process.stderr, "write", (chunk: string | Uint8Array) => {
          timings.push(String(chunk));
          return true;
        });
        t.mock.method(
          filesystem,
          "readdir",
          async (...args: Parameters<typeof filesystem.readdir>) => {
            if (resolve(String(args[0])).toLowerCase() === resolve(target).toLowerCase())
              throw Object.assign(new Error("Capture unavailable."), {
                code: "EACCES",
                syscall: "scandir",
              });
            return originalReadDirectory(...args);
          },
        );
        syncBuiltinESMExports();
        const fallback = await Effect.runPromise(
          observe({ spec, subject: { root: target } }, wrapped),
        );
        assert.equal(fallback.payload?.current.levelId, "initial", fallback.message);
        const event = timings
          .flatMap((line) =>
            line
              .trim()
              .split("\n")
              .map((item) => JSON.parse(item)),
          )
          .find((value) => value.phase === "input-view.capture" && value.status === "unavailable");
        assert.ok(event);
        assert.equal(event.objectiveId, repo.uri);
        assert.equal(event.reason, "unreadable");
        assert.equal(event.code, "EACCES");
      } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
        if (priorTimings === undefined) delete process.env.PGUIDE_TIMINGS;
        else process.env.PGUIDE_TIMINGS = priorTimings;
      }
    },
    { reports: { enabled: false } },
  );
});

test("runtime budgets retain distinct observation and check timeout causes", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await repo.check("checks/ready/run.cjs", "#!/usr/bin/env node\nsetTimeout(() => {}, 60000);");
  await repo.commit();
  for (const observationTimeout of [true, false]) {
    const run = () =>
      withPilot(
        repo.path,
        repo.root,
        undefined,
        (spec, runtime) =>
          Effect.runPromise(observe({ spec, subject: { name: "target" } }, runtime)),
        {
          reports: { enabled: false },
          probeTimeoutMs: observationTimeout ? 10000 : 100,
          observationBudget: {
            timeoutMs: observationTimeout ? 100 : 10000,
            maxDepth: 8,
            maxObservations: 16,
          },
        },
      );
    if (observationTimeout)
      await assert.rejects(run(), /observation-timeout:.*total observation deadline/);
    else {
      const result = await run();
      assert.equal(result.payload, null);
      assert.match(result.message, /check-timeout:.*ready.*100ms/);
    }
  }
});

test("source lifetime cancellation waits for active process teardown before removing its source", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  const pidFile = join(
    resolve(".cache", "pilot-source-tests"),
    `cancelled-${crypto.randomUUID()}.pid`,
  );
  t.after(() => rm(pidFile, { force: true }));
  await repo.check(
    "checks/ready/run.cjs",
    `#!/usr/bin/env node
require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`,
  );
  await repo.commit();
  const controller = new AbortController();
  let pid = 0;
  await assert.rejects(
    withPilot(
      repo.path,
      repo.root,
      undefined,
      async (spec, runtime) => {
        const pending = Effect.runPromise(observe({ spec, subject: { name: "target" } }, runtime));
        const deadline = Date.now() + 10000;
        while (!(await filesystem.stat(pidFile).catch(() => undefined))) {
          if (Date.now() > deadline) throw new Error("Probe did not start.");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        pid = Number(await filesystem.readFile(pidFile, "utf8"));
        controller.abort(new Error("cancelled-source-use"));
        await pending;
      },
      { signal: controller.signal, reports: { enabled: false } },
    ),
    /cancelled-source-use/,
  );
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("cleanup failure retains the primary CLI error and reports both causes", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "ready", checks: [{ id: "ready", problems: ["broken"] }] }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await repo.check(
    "checks/ready/run.cjs",
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({status:200,payload:{ok:false,problems:[{kind:"internal",id:"broken",parameters:{directory:process.cwd()}}]},message:""}));
`,
  );
  await repo.commit();
  const guidance = {
    instructions: "Provide a subject matching subjectSchema.",
    subjectSchema: { type: "object", required: ["name"] },
  };
  const primary = new CliError(
    "Primary consumer failure.",
    37,
    "primary-test-failure",
    guidance,
    "Readable primary consumer failure.",
  );
  const cleanup = new Error("Injected cleanup failure.");
  const originalRm = filesystem.rm;
  const controller = new AbortController();
  let cache = "";
  try {
    await assert.rejects(
      withPilot(
        repo.path,
        repo.root,
        undefined,
        async (spec, runtime) => {
          const observation = await Effect.runPromise(
            observe({ spec, subject: { name: "repo" } }, runtime),
          );
          assert.ok(observation.payload !== null);
          const problem = observation.payload.problems.at(0);
          const directory = problem?.kind === "internal" ? problem.parameters.directory : undefined;
          assert.equal(typeof directory, "string");
          if (typeof directory !== "string") throw new Error("Expected a process check directory.");
          cache = dirname(dirname(dirname(dirname(directory))));
          assert.equal(dirname(cache), resolve(".cache", "pguide-sources"));
          t.mock.method(filesystem, "rm", async (...args: Parameters<typeof filesystem.rm>) => {
            const [path, options] = args;
            if (String(path) === cache) throw cleanup;
            return originalRm(path, options);
          });
          syncBuiltinESMExports();
          controller.abort(primary);
          throw primary;
        },
        { signal: controller.signal },
      ),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, 37);
        assert.equal(error.status, "primary-test-failure");
        assert.deepEqual(error.guidance, guidance);
        assert.match(error.message, /Primary consumer failure/);
        assert.match(error.message, /Injected cleanup failure/);
        assert.match(error.humanMessage ?? "", /Readable primary consumer failure/);
        assert.match(error.humanMessage ?? "", /Cleanup failed: Injected cleanup failure/);
        assert.ok(error.cause instanceof AggregateError);
        assert.equal(error.cause.cause, primary);
        assert.deepEqual(error.cause.errors, [primary, cleanup]);
        return true;
      },
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (cache) await originalRm(cache, { recursive: true, force: true });
  }
});
