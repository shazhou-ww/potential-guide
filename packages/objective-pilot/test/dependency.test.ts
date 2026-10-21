import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { test } from "node:test";
import { Effect, startEffect } from "@potential-guide/effects";
import {
  checkObjectiveLevel,
  createObjectiveDependencyProbe,
  createProcessCheckProbe,
  observe,
  type PilotRuntime,
  type PilotSpec,
  parseCheckEnvelope,
  recordDependencyObservation,
} from "../src/index.js";
import { commit, fixture, manifest, objectiveId } from "./fixtures.js";

const pass = { status: 200, message: "", payload: { ok: true, problems: [] } } as const;
const fail = {
  status: 200,
  message: "",
  payload: { ok: false, problems: [{ kind: "internal", id: "broken", parameters: {} }] },
} as const;
const subject = { name: "consumer" };
const externalId = "git+https://external.test/objectives.git#environment/";
async function specs() {
  const data = fixture({ [objectiveId]: manifest(), [externalId]: manifest() });
  return { consumer: await data.load(), external: await data.load(externalId) };
}
const context = { recordObservation: recordDependencyObservation };

test("level check is lazy, uses array order, and returns the exact single observation", async () => {
  const { external } = await specs();
  for (const actual of ["initial", "z-first", "a-next"]) {
    for (const expected of ["initial", "z-first", "a-next", "terminal"]) {
      let published: unknown;
      let probes = 0;
      const effect = checkObjectiveLevel(
        { spec: external, subject, expectedLevelId: expected },
        {
          onObservation: (envelope) => {
            published = envelope.payload;
          },
          resolveCheck: (ref) => async () => {
            probes++;
            return ref.levelId ===
              (actual === "initial" ? "z-first" : actual === "z-first" ? "a-next" : "")
              ? fail
              : pass;
          },
        },
      );
      assert.equal(probes, 0);
      const envelope = await Effect.runPromise(effect);
      assert.ok(envelope.payload);
      assert.equal(envelope.payload.observation, published);
      assert.equal(
        envelope.payload.passed,
        expected === "initial" ||
          ["initial", "z-first", "a-next"].indexOf(actual) >=
            ["initial", "z-first", "a-next"].indexOf(expected === "terminal" ? "a-next" : expected),
      );
      assert.equal(probes, expected === "initial" ? 0 : actual === "initial" ? 2 : 3);
    }
  }
});

test("level check rejects invalid inputs and preserves invocation failures, never false", async () => {
  const { external } = await specs();
  for (const input of [
    { spec: external, subject: {}, expectedLevelId: "terminal" },
    { spec: external, subject, expectedLevelId: "missing" },
  ])
    await assert.rejects(
      Effect.runPromise(checkObjectiveLevel(input, { resolveCheck: () => async () => pass })),
    );
  const result = await Effect.runPromise(
    checkObjectiveLevel(
      { spec: external, subject, expectedLevelId: "terminal" },
      {
        resolveCheck: () => async () => ({ status: 503, payload: null, message: "Unavailable" }),
      },
    ),
  );
  assert.equal(result.status, 503);
  assert.equal(result.payload, null);
  assert.equal("passed" in result, false);
});

test("true and false probes both contribute versions, and middle-level dependencies keep ownership", async () => {
  const { consumer, external } = await specs();
  for (const satisfied of [false, true]) {
    let observations = 0;
    const dependency = createObjectiveDependencyProbe(
      { spec: external, expectedLevelId: "terminal" },
      {
        onObservation: () => observations++,
        resolveCheck: () => async () => (satisfied ? pass : fail),
      },
      context,
    );
    const result = await Effect.runPromise(
      observe(
        { spec: consumer, subject },
        {
          resolveCheck: (ref) => (ref.levelId === "a-next" ? dependency : async () => pass),
        },
      ),
    );
    assert.ok(result.payload);
    assert.equal(observations, 1);
    assert.equal(result.payload.current.objectiveId, objectiveId);
    assert.equal(result.payload.current.levelId, satisfied ? "a-next" : "z-first");
    assert.deepEqual(result.payload.versions, { [objectiveId]: commit, [externalId]: commit });
    if (!satisfied)
      assert.deepEqual(result.payload.problems, [
        {
          kind: "dependency",
          objectiveId: externalId,
          subject,
          expectedLevelId: "terminal",
          currentLevelId: "initial",
        },
      ]);
  }
});

test("strict check union rejects removed output and dependency fields without trusted evidence", async () => {
  const dependency = {
    kind: "dependency",
    objectiveId: externalId,
    subject,
    expectedLevelId: "terminal",
    currentLevelId: "z-first",
  } as const;
  for (const problem of [
    { id: "broken", parameters: {} },
    { ...dependency, ref: {} },
    { ...dependency, id: "missing" },
    { ...dependency, subject: [] },
    { ...dependency, objectiveId: "alias" },
    { kind: "internal", id: "broken", parameters: {}, objectiveId: externalId },
  ])
    assert.throws(() =>
      parseCheckEnvelope({ status: 200, message: "", payload: { ok: false, problems: [problem] } }),
    );
  const { consumer } = await specs();
  const result = await Effect.runPromise(
    observe(
      { spec: consumer, subject },
      {
        resolveCheck: () => async () => ({
          status: 200,
          message: "",
          payload: { ok: false, problems: [dependency] },
        }),
      },
    ),
  );
  assert.equal(result.payload, null);
  assert.match(result.message, /same-observation/);
  await assert.rejects(
    Effect.runPromise(
      observe(
        {
          spec: { ...consumer, prerequisite: consumer } as PilotSpec,
          subject,
        },
        { resolveCheck: () => async () => pass },
      ),
    ),
    /Expected fields/,
  );
});

test("conflicting versions and recursively reentered instances fail explicitly", async () => {
  const { consumer, external } = await specs();
  const conflicts = [
    createObjectiveDependencyProbe(
      { spec: external, expectedLevelId: "terminal" },
      { resolveCheck: () => async () => pass },
      context,
    ),
    createObjectiveDependencyProbe(
      { spec: { ...external, version: "b".repeat(40) }, expectedLevelId: "terminal" },
      { resolveCheck: () => async () => pass },
      context,
    ),
  ];
  const result = await Effect.runPromise(
    observe(
      { spec: consumer, subject },
      {
        resolveCheck: (ref) => conflicts[ref.checkId === "one" ? 0 : 1] ?? assert.fail(),
      },
    ),
  );
  assert.equal(result.payload, null);
  assert.match(result.message, /Conflicting/);
  const runtime: PilotRuntime = {
    resolveCheck: () =>
      createObjectiveDependencyProbe(
        { spec: consumer, expectedLevelId: "terminal" },
        runtime,
        context,
      ),
  };
  const recursive = await Effect.runPromise(observe({ spec: consumer, subject }, runtime));
  assert.equal(recursive.payload, null);
  assert.match(recursive.message, /Recursive dependency observation/);
});

test("nested observations share a total budget and cancellation waits for child cleanup", async () => {
  const { consumer, external } = await specs();
  const dependency = createObjectiveDependencyProbe(
    { spec: external, expectedLevelId: "terminal" },
    { resolveCheck: () => async () => pass },
    context,
  );
  const budget = await Effect.runPromise(
    observe(
      { spec: consumer, subject },
      {
        observationBudget: { timeoutMs: 1_000, maxDepth: 2, maxObservations: 1 },
        resolveCheck: () => dependency,
      },
    ),
  );
  assert.equal(budget.payload, null);
  assert.match(budget.message, /budget exhausted/);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cleaned = false;
  const controller = new AbortController();
  const handle = startEffect(
    observe(
      { spec: consumer, subject },
      {
        resolveCheck: () =>
          createObjectiveDependencyProbe(
            { spec: external, expectedLevelId: "terminal" },
            {
              resolveCheck: () => async (_, signal) => {
                started();
                await new Promise<void>((resolve) =>
                  signal.addEventListener("abort", () => resolve(), { once: true }),
                );
                await new Promise((resolve) => setTimeout(resolve, 10));
                cleaned = true;
                signal.throwIfAborted();
                return pass;
              },
            },
            context,
          ),
      },
    ),
    controller.signal,
  );
  await ready;
  controller.abort(new Error("test cancellation"));
  await assert.rejects(handle.await());
  assert.equal(cleaned, true);
});

function processDependency(
  objectiveId: string,
  options: { timeoutMs?: number; log?: (text: string) => void } = {},
) {
  return createProcessCheckProbe({
    command: process.execPath,
    evidence: false,
    timeoutMs: options.timeoutMs ?? 5_000,
    ...(options.log === undefined ? {} : { log: options.log }),
    args: [
      "-e",
      `
      (async () => {
        const {createSourceObjectiveDependencyProbe} = await import("@potential-guide/objective-pilot");
        process.stderr.write(JSON.stringify({directory:process.env.PGUIDE_PROBE_TEMP_DIR,pid:process.pid})+"\\n");
        let source = ""; for await (const chunk of process.stdin) source += chunk;
        const result = await createSourceObjectiveDependencyProbe({
          objectiveId:${JSON.stringify(objectiveId)},expectedLevelId:"terminal"
        })(JSON.parse(source), new AbortController().signal);
        process.stdout.write(JSON.stringify(result));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
    ],
  });
}

test("real process dependency requests share recursion, depth and total observation budgets", async () => {
  const definition = manifest({
    levels: [{ id: "ready", checks: [{ id: "dependency", problems: [] }] }],
  });
  const data = fixture({ [objectiveId]: definition, [externalId]: definition });
  const consumer = await data.load();
  const external = await data.load(externalId);
  // Two cold Node module graphs are setup, not the recursion/count/depth behavior under test.
  const startupAllowanceMs = 15_000;
  for (const mode of ["recursive", "depth", "count"] as const) {
    const requested: string[] = [];
    let rootLog = "";
    let childLog = "";
    const rootProbe = processDependency(externalId, {
      timeoutMs: startupAllowanceMs,
      log: (text) => {
        rootLog += text;
      },
    });
    const childProbe = processDependency(objectiveId, {
      timeoutMs: startupAllowanceMs,
      log: (text) => {
        childLog += text;
      },
    });
    const runtime: PilotRuntime = {
      observationBudget: {
        timeoutMs: startupAllowanceMs,
        maxDepth: mode === "depth" ? 1 : 8,
        maxObservations: mode === "count" ? 1 : 16,
      },
      resolveCheck: () => rootProbe,
      resolveObjective: async (id) => {
        requested.push(id);
        return {
          spec: id === objectiveId ? consumer : external,
          runtime: id === objectiveId ? runtime : { ...runtime, resolveCheck: () => childProbe },
        };
      },
    };
    const result = await Effect.runPromise(observe({ spec: consumer, subject }, runtime));
    assert.equal(result.payload, null);
    assert.match(
      result.message,
      mode === "recursive" ? /Recursive dependency observation/ : /budget exhausted/,
    );
    assert.deepEqual(requested, mode === "recursive" ? [externalId, objectiveId] : [externalId]);
    assert.ok(rootLog.trim(), `${mode}: root process must reach its dependency request`);
    assert.equal(childLog.trim() !== "", mode === "recursive");
    const children: { directory: string; pid: number }[] = `${rootLog}${childLog}`
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(children.length, mode === "recursive" ? 2 : 1);
    for (const child of children) {
      await assert.rejects(stat(child.directory), { code: "ENOENT" });
      assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
    }
  }
});

test("cancelling a source-bound process waits for its external process cleanup", async () => {
  const { consumer, external } = await specs();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });

  let directory = "";
  const externalProbe = createProcessCheckProbe({
    command: process.execPath,
    evidence: false,
    timeoutMs: 5_000,
    args: [
      "-e",
      "process.stderr.write(process.env.PGUIDE_PROBE_TEMP_DIR);setInterval(()=>{},1000);",
    ],
    log: (text) => {
      directory += text;
      started();
    },
  });
  const controller = new AbortController();
  const handle = startEffect(
    observe(
      { spec: consumer, subject },
      {
        resolveCheck: () => processDependency(externalId),
        resolveObjective: async () => ({
          spec: external,
          runtime: { resolveCheck: () => externalProbe },
        }),
      },
    ),
    controller.signal,
  );
  await ready;
  controller.abort(new Error("source process cancellation"));
  await assert.rejects(handle.await());
  assert.ok(directory);
  await assert.rejects(stat(directory), { code: "ENOENT" });
});

test("ordinary process probes can retain the three-pipe protocol without Node IPC metadata", async () => {
  const probe = createProcessCheckProbe({
    command: process.execPath,
    dependencyBinding: false,
    evidence: false,
    args: [
      "-e",
      'if(process.connected)process.exit(7);console.log(JSON.stringify({status:200,message:"",payload:{ok:true,problems:[]}}));',
    ],
  });
  assert.deepEqual(await probe(subject, new AbortController().signal), pass);
});
