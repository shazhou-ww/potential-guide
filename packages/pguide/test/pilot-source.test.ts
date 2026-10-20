import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as filesystem } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { CliError } from "@potential-guide/cli-core";
import { Effect } from "@potential-guide/effects";
import { observe, type PilotManifest } from "@potential-guide/objective-pilot";
import { manifest, fixture as wikiFixture } from "../../objective-pilot/test/fixtures.js";
import { withPilot } from "../src/pilot-source.js";

const execute = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  return (await execute("git", ["-C", cwd, ...args], { windowsHide: true })).stdout.trim();
}
const successfulProbe =
  '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({status: 200, message: "", payload:{ok:true,problems:[]}}));\n';

async function repository(config: PilotManifest, origin?: string) {
  const scratch = resolve(".cache", "pilot-source-tests");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "pguide-source-test-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "Pilot Test");
  await git(root, "config", "user.email", "pilot@example.invalid");
  const identity = origin ?? pathToFileURL(root).href;
  await git(root, "remote", "add", "origin", identity);
  const uri = `git+${identity}#objective/pilot.yaml`;
  const data = wikiFixture({ [uri]: config });
  for (const [resource, source] of [
    ...data.texts,
    ...[...data.pages.values()].flat().map(({ uri, source }) => [uri, source] as const),
  ]) {
    const path = join(root, ...decodeURIComponent(new URL(resource).hash.slice(1)).split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  }
  return {
    root,
    uri,
    path: join(root, "objective", "pilot.yaml"),
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
      levels: [{ id: "initial", advancement: { checks: [{ id: "ready", problems: ["broken"] }] } }],
    }),
    "https://not-a-reachable-origin.invalid/objectives.git",
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  const script = await repo.check("checks/ready/run.cjs");
  const commit = await repo.commit();
  const result = await withPilot(repo.path, repo.root, undefined, async (spec, runtime) => {
    assert.equal(spec.objectiveId, repo.uri);
    assert.equal(spec.version, commit);
    // Concurrent checkout edits must not mutate an already-bound immutable source.
    await writeFile(script, "process.exit(7);");
    return Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime));
  });
  assert.ok(result.payload !== null);
  assert.equal(result.payload.current.levelId, "terminal");
  assert.deepEqual(result.payload.versions, { [repo.uri]: commit });
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
  assert.equal(result.payload.current.levelId, "terminal");
});

test("batched materialization preserves binary resources outside the Pilot directory", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "initial", advancement: { checks: [{ id: "ready", problems: ["broken"] }] } }],
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
  assert.equal(result.payload?.current.levelId, "terminal");
});

test("nested Pilot sources stay in the owning probe directory and preserve unrelated files", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "initial", advancement: { checks: [{ id: "ready", problems: ["broken"] }] } }],
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
    assert.equal(result.payload?.current.levelId, "terminal");
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
      levels: [{ id: "initial", advancement: { checks: [{ id: "ready", problems: ["broken"] }] } }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  const script = await repo.check("checks/ready/run.cjs");
  const old = await repo.commit();
  await writeFile(script, "process.exit(9);");
  await repo.commit();
  const result = await withPilot(repo.uri, repo.root, old, (spec, runtime) => {
    assert.equal(spec.version, old);
    return Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime));
  });
  assert.ok(result.payload !== null);
  assert.equal(result.payload.current.levelId, "terminal");
  const local = await withPilot(repo.path, repo.root, old, (spec, runtime) => {
    assert.equal(spec.version, old);
    assert.equal(spec.objectiveId, repo.uri);
    return Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime));
  });
  assert.ok(local.payload !== null);
  assert.equal(local.payload.current.levelId, "terminal");
  await assert.rejects(
    withPilot(repo.path, repo.root, "HEAD", async () => undefined),
    {
      exitCode: 2,
      status: "pilot-error",
    },
  );
});

test("two repository prerequisites preserve distinct commits, check routing and source cleanup", async (t) => {
  const levels: PilotManifest["levels"] = [
    { id: "initial", advancement: { checks: [{ id: "ready", problems: ["broken"] }] } },
  ];
  const child = await repository(manifest({ levels }));
  t.after(() => rm(child.root, { recursive: true, force: true }));
  const childScript = await child.check(
    "checks/ready/run.cjs",
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({status:200,payload:{ok:false,problems:[{id:"broken",parameters:{directory:process.cwd()}}]},message:""}));
`,
  );
  const childCommit = await child.commit();
  const parent = await repository(
    manifest({ levels, prerequisite: { manifestUri: child.uri, subject: '{"name":name}' } }),
  );
  t.after(() => rm(parent.root, { recursive: true, force: true }));
  await parent.check("checks/ready/run.cjs");
  const parentCommit = await parent.commit();
  assert.notEqual(parentCommit, childCommit);
  let checkDirectory = "";
  await withPilot(parent.path, parent.root, undefined, async (spec, runtime) => {
    assert.equal(spec.version, parentCommit);
    assert.equal(spec.prerequisite?.version, childCommit);
    const first = await Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime));
    assert.ok(first.payload !== null);
    assert.equal(first.payload.current.objectiveId, child.uri);
    assert.deepEqual(first.payload.versions, {
      [parent.uri]: parentCommit,
      [child.uri]: childCommit,
    });
    const directory = first.payload.problems[0]?.parameters.directory;
    assert.equal(typeof directory, "string");
    if (typeof directory !== "string") throw new Error("Expected child check directory.");
    checkDirectory = directory;
    assert.match(checkDirectory, /checkout-1/);
    await writeFile(childScript, successfulProbe);
    await child.commit();
    const second = await Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime));
    assert.ok(second.payload !== null);
    assert.equal(second.payload.current.objectiveId, child.uri);
    assert.equal(second.payload.versions[child.uri], childCommit);
  });
  await assert.rejects(stat(checkDirectory), { code: "ENOENT" });
  const refreshed = await withPilot(parent.path, parent.root, undefined, (spec, runtime) =>
    Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime)),
  );
  assert.ok(refreshed.payload !== null);
  assert.equal(refreshed.payload.current.objectiveId, parent.uri);
  assert.equal(refreshed.payload.current.levelId, "terminal");
  const pinned = await withPilot(
    parent.uri,
    parent.root,
    parentCommit,
    (spec, runtime) => Effect.runPromise(observe({ spec, subject: { name: "repo" } }, runtime)),
    { versions: { [parent.uri]: parentCommit, [child.uri]: childCommit } },
  );
  assert.ok(pinned.payload !== null);
  assert.equal(pinned.payload.current.objectiveId, child.uri);
  assert.equal(pinned.payload.versions[child.uri], childCommit);
});

test("Git source failure is reported as explicit pilot-error exit 2", async () => {
  const missing = pathToFileURL(join(process.cwd(), ".cache", "nonexistent-pilot-repository")).href;
  await assert.rejects(
    withPilot(`git+${missing}#pilot.yaml`, process.cwd(), "a".repeat(40), async () => undefined),
    {
      exitCode: 2,
      status: "pilot-error",
    },
  );
});

test("source preparation has its own deadline and releases only its owned cache", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "initial", advancement: { checks: [{ id: "ready", problems: ["broken"] }] } }],
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

test("cleanup failure retains the primary CLI error and reports both causes", async (t) => {
  const repo = await repository(
    manifest({
      levels: [{ id: "initial", advancement: { checks: [{ id: "ready", problems: ["broken"] }] } }],
    }),
  );
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await repo.check(
    "checks/ready/run.cjs",
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({status:200,payload:{ok:false,problems:[{id:"broken",parameters:{directory:process.cwd()}}]},message:""}));
`,
  );
  await repo.commit();
  const guidance = {
    instructions: "Provide a subject matching subjectSchema.",
    subjectSchema: { type: "object", required: ["name"] },
  };
  const primary = new CliError("Primary consumer failure.", 37, "primary-test-failure", guidance);
  const cleanup = new Error("Injected cleanup failure.");
  const originalRm = filesystem.rm;
  let cache = "";
  try {
    await assert.rejects(
      withPilot(repo.path, repo.root, undefined, async (spec, runtime) => {
        const observation = await Effect.runPromise(
          observe({ spec, subject: { name: "repo" } }, runtime),
        );
        assert.ok(observation.payload !== null);
        const directory = observation.payload.problems.at(0)?.parameters.directory;
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
        throw primary;
      }),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, 37);
        assert.equal(error.status, "primary-test-failure");
        assert.deepEqual(error.guidance, guidance);
        assert.match(error.message, /Primary consumer failure/);
        assert.match(error.message, /Injected cleanup failure/);
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
