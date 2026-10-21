import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Effect } from "@potential-guide/effects";
import { observationResource, observationScope } from "../src/dependency.js";
import {
  captureFilesystemObservation,
  checkObjectiveLevel,
  filesystemObservationRevision,
  type PilotRuntime,
} from "../src/index.js";
import { fixture, manifest, objectiveId } from "./fixtures.js";

const dependencyId = "git+https://example.test/objectives.git#dependency/";
const pass = { status: 200, message: "", payload: { ok: true, problems: [] } } as const;

async function setup() {
  const data = fixture({ [objectiveId]: manifest(), [dependencyId]: manifest() });
  return { parent: await data.load(), spec: await data.load(dependencyId) };
}

test("only opted-in complete observations reuse facts across expected levels, never initial or rounds", async () => {
  const { parent, spec } = await setup();
  for (const stable of [false, true]) {
    let checks = 0;
    const runtime: PilotRuntime = {
      ...(stable ? { observationRevision: async () => "content" } : {}),
      resolveCheck: () => async () => {
        checks++;
        return pass;
      },
    };
    const root = { spec: parent, subject: { name: "root" } };
    const request = (expectedLevelId: string, name = "target", language = "en-US") =>
      Effect.runPromise(
        checkObjectiveLevel({ spec, subject: { name }, expectedLevelId, language }, runtime),
      );
    for (let round = 0; round < 2; round++) {
      const before = checks;
      await observationScope(root, runtime, new AbortController().signal, async () => {
        const initial = await request("initial");
        assert.equal(initial.payload?.observation.current.levelId, "initial");
        assert.equal(checks, before);
        const first = await request("z-first");
        assert.equal(first.payload?.observation.current.levelId, "a-next");
        const second = await request("terminal");
        assert.equal(second.payload?.passed, true);
        if (stable) assert.equal(first.payload?.observation, second.payload?.observation);
        assert.equal(checks - before, stable ? 3 : 6);
        await request("terminal", "another");
        await request("terminal", "target", "zh-CN");
        assert.equal(checks - before, stable ? 9 : 12);
      });
    }
  }
});

test("byte revisions invalidate additions, deletions and equal-size edits even with restored mtime", async () => {
  const { parent, spec } = await setup();
  const scratch = resolve(".cache");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "revision-"));
  try {
    const file = join(directory, "input.ts");
    await writeFile(file, "old");
    const prior = await stat(file);
    let checks = 0;
    const runtime: PilotRuntime = {
      observationRevision: (_, signal) => filesystemObservationRevision(directory, signal),
      resolveCheck: () => async () => {
        checks++;
        return pass;
      },
    };
    const request = () =>
      Effect.runPromise(
        checkObjectiveLevel(
          { spec, subject: { name: "target" }, expectedLevelId: "terminal" },
          runtime,
        ),
      );
    await observationScope(
      { spec: parent, subject: { name: "root" } },
      runtime,
      new AbortController().signal,
      async () => {
        await request();
        await request();
        assert.equal(checks, 3);
        await writeFile(file, "new");
        await utimes(file, prior.atime, prior.mtime);
        await request();
        assert.equal(checks, 6);
        await writeFile(join(directory, "added"), "");
        await request();
        assert.equal(checks, 9);
        await rm(file);
        await request();
        assert.equal(checks, 12);
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed, interrupted and changing executions are not cached; cached requests still consume budget", async () => {
  const { parent, spec } = await setup();
  let checks = 0;
  let revision = 0;
  let mode = "failure";
  const runtime: PilotRuntime = {
    observationRevision: async () => String(revision),
    resolveCheck: () => async () => {
      checks++;
      if (mode === "failure") return { status: 503, message: "unavailable", payload: null };
      if (mode === "changing") revision++;
      return pass;
    },
  };
  const request = () =>
    Effect.runPromise(
      checkObjectiveLevel(
        { spec, subject: { name: "target" }, expectedLevelId: "terminal" },
        runtime,
      ),
    );
  await observationScope(
    { spec: parent, subject: { name: "root" } },
    runtime,
    new AbortController().signal,
    async () => {
      await request();
      await request();
      assert.equal(checks, 4);
      mode = "changing";
      await request();
      await request();
      assert.equal(checks, 10);
      mode = "stable";
      await request();
      await request();
      assert.equal(checks, 13);
    },
  );
  await assert.rejects(
    observationScope(
      { spec: parent, subject: { name: "root" } },
      {
        ...runtime,
        observationBudget: { timeoutMs: 5000, maxDepth: 8, maxObservations: 2 },
      },
      new AbortController().signal,
      async () => {
        await request();
        await request();
      },
    ),
    /maximum logical observations exceeded/,
  );
  const controller = new AbortController();
  await assert.rejects(
    observationScope(
      { spec: parent, subject: { name: "root" } },
      runtime,
      controller.signal,
      async () => {
        await request();
        controller.abort(new Error("user-cancelled"));
        await request();
      },
    ),
    /user-cancelled/,
  );
});

test("total observation deadline retains its cause instead of fiber interruption", async () => {
  const { parent } = await setup();
  await assert.rejects(
    observationScope(
      { spec: parent, subject: { name: "root" } },
      {
        resolveCheck: () => async () => pass,
        observationBudget: { timeoutMs: 20, maxDepth: 8, maxObservations: 16 },
      },
      new AbortController().signal,
      async (_, signal) => {
        await new Promise<void>((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("interrupted")), { once: true }),
        );
      },
    ),
    /observation-timeout:.*total observation deadline/,
  );
});

test("reuse distinguishes source/runtime identity and never bypasses recursive observation checks", async () => {
  const { parent, spec } = await setup();
  let checks = 0;
  const runtime: PilotRuntime = {
    observationRevision: async () => "fixed-view",
    resolveCheck: () => async () => {
      checks++;
      return pass;
    },
  };
  const source = {
    kind: "git-tree" as const,
    repository: "https://example.test/objectives.git",
    directory: "dependency",
    tree: spec.version,
    repositoryTree: "c".repeat(40),
  };
  const first = { ...spec, source: { ...source, commit: "b".repeat(40) } };
  const second = { ...spec, source: { ...source, commit: "d".repeat(40) } };
  const input = { subject: { name: "target" }, expectedLevelId: "terminal" };
  await observationScope(
    { spec: parent, subject: { name: "root" } },
    runtime,
    new AbortController().signal,
    async () => {
      await Effect.runPromise(checkObjectiveLevel({ ...input, spec: first }, runtime));
      await Effect.runPromise(checkObjectiveLevel({ ...input, spec: second }, runtime));
      assert.equal(checks, 6);
      await Effect.runPromise(checkObjectiveLevel({ ...input, spec: second }, { ...runtime }));
      assert.equal(checks, 9);
      await assert.rejects(
        observationScope(
          { spec: second, subject: input.subject },
          runtime,
          new AbortController().signal,
          async () => {
            await Effect.runPromise(checkObjectiveLevel({ ...input, spec: second }, runtime));
          },
        ),
        /Recursive dependency observation/,
      );
    },
  );
});

test("host resources are shared only within a round and released on failure, cancellation and timeout", async () => {
  const { parent } = await setup();
  let acquired = 0;
  let released = 0;
  for (const mode of ["success", "failure", "cancelled", "timeout"]) {
    const controller = new AbortController();
    const run = observationScope(
      { spec: parent, subject: { name: "root" } },
      {
        resolveCheck: () => async () => pass,
        observationBudget: { timeoutMs: 20, maxDepth: 8, maxObservations: 16 },
      },
      controller.signal,
      async (_, signal) => {
        const acquire = async () => {
          acquired++;
          return {};
        };
        const release = async () => {
          released++;
        };
        const first = await observationResource("facts", acquire, release);
        assert.equal(await observationResource("facts", acquire, release), first);
        if (mode === "failure") throw new Error("primary-failure");
        if (mode === "cancelled") controller.abort(new Error("cancelled-by-owner"));
        if (mode === "timeout")
          await new Promise<void>((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
          );
      },
    );
    if (mode === "success") await run;
    else
      await assert.rejects(
        run,
        mode === "failure"
          ? /primary-failure/
          : mode === "cancelled"
            ? /cancelled-by-owner/
            : /observation-timeout/,
      );
    assert.equal(acquired, released);
  }
  assert.equal(acquired, 4);
});

test("bounded input capture retains output existence without secret values or oversized file contents", async () => {
  const scratch = resolve(".cache");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "bounded-view-"));
  const outside = await mkdtemp(join(scratch, "outside-view-"));
  try {
    await mkdir(join(directory, "credentials"));
    await mkdir(join(directory, ".cache"));
    await mkdir(join(directory, "dist"));
    await writeFile(join(directory, ".env"), "SECRET-VALUE-MUST-NOT-BE-CAPTURED");
    await writeFile(join(directory, "credentials", "value"), "NESTED-SECRET-MUST-NOT-BE-CAPTURED");
    await writeFile(join(directory, ".cache", "ignored"), "ignored");
    await writeFile(join(directory, "dist", "entry.js"), "output");
    await writeFile(join(directory, "oversized"), Buffer.alloc(1024 * 1024 + 1, 120));
    await writeFile(join(outside, "private"), "OUTSIDE-CONTENT-MUST-NOT-BE-CAPTURED");
    await symlink(
      outside,
      join(directory, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const view = await captureFilesystemObservation(directory, new AbortController().signal);
    assert.ok(view);
    assert.equal(view.entries["dist/entry.js"]?.text, "output");
    assert.equal(view.entries.oversized?.size, 1024 * 1024 + 1);
    assert.equal(view.entries.oversized?.text, undefined);
    assert.equal(view.entries[".env"]?.text, undefined);
    assert.equal(view.entries["credentials/value"], undefined);
    assert.equal(view.entries[".cache/ignored"], undefined);
    assert.equal(view.entries.linked?.kind, "link");
    assert.equal(view.entries["linked/private"], undefined);
    assert.equal(JSON.stringify(view).includes("MUST-NOT-BE-CAPTURED"), false);
    const controller = new AbortController();
    controller.abort(new Error("cancelled-capture"));
    await assert.rejects(
      captureFilesystemObservation(directory, controller.signal),
      /cancelled-capture/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
