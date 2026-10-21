import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "@potential-guide/effects";
import {
  attainedLevelRank,
  checkObjectiveLevel,
  createObjectiveDependencyProbe,
  describeLevels,
  levelRank,
  observe,
  parseManifest,
  recordDependencyObservation,
  resolveLevelId,
} from "../src/index.js";
import { fixture, manifest } from "./fixtures.js";

const pass = { status: 200, message: "", payload: { ok: true, problems: [] } } as const;
const fail = {
  status: 200,
  message: "",
  payload: { ok: false, problems: [{ kind: "internal", id: "broken", parameters: {} }] },
} as const;

test("cumulative attainment reports prior level and preserves the unattained problem scope", async () => {
  const spec = await fixture().load();
  for (const [blocked, current, calls] of [
    ["z-first", "initial", 2],
    ["a-next", "z-first", 3],
    ["", "a-next", 3],
  ] as const) {
    let invoked = 0;
    const result = await Effect.runPromise(
      observe(
        { spec, subject: { name: "matrix" } },
        {
          resolveCheck: (ref) => async () => {
            invoked++;
            return ref.levelId === blocked ? fail : pass;
          },
        },
      ),
    );
    assert.ok(result.payload);
    assert.equal(result.payload.current.levelId, current);
    assert.equal(invoked, calls);
    assert.ok(
      result.payload.problems.every(
        (problem) => problem.kind === "internal" && problem.ref.levelId === blocked,
      ),
    );
  }
  assert.deepEqual(
    describeLevels(spec).map(({ levelId }) => levelId),
    ["initial", "z-first", "a-next"],
  );
  assert.equal(resolveLevelId(spec, "terminal"), "a-next");
  assert.equal(levelRank(spec, "terminal"), levelRank(spec, "a-next"));
  assert.throws(() => attainedLevelRank(spec, "terminal"), /real level/);
});

test("initial target invokes no business checks but still rejects invalid contracts, subjects and targets", async () => {
  const spec = await fixture().load();
  const runtime = { resolveCheck: () => assert.fail("initial must not resolve a business check") };
  const valid = { spec, subject: { name: "initial" }, expectedLevelId: "initial" };
  const result = await Effect.runPromise(checkObjectiveLevel(valid, runtime));
  assert.equal(result.payload?.passed, true);
  assert.equal(result.payload?.observation.current.levelId, "initial");
  for (const input of [
    { ...valid, subject: {} },
    { ...valid, expectedLevelId: "unknown" },
    { ...valid, spec: { ...spec, manifest: { ...manifest(), levels: [] } } },
    {
      ...valid,
      spec: {
        ...spec,
        manifest: {
          ...manifest(),
          $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json",
        },
      },
    },
  ])
    await assert.rejects(Effect.runPromise(checkObjectiveLevel(input as typeof valid, runtime)));
});

test("one empty business level is attained unconditionally; invocation faults never become initial", async () => {
  const config = manifest({ levels: [{ id: "ready", checks: [] }] });
  const spec = await fixture({ "git+https://example.test/rules.git#/": config }).load(
    "git+https://example.test/rules.git#/",
  );
  const result = await Effect.runPromise(
    observe(
      { spec, subject: { name: "empty" } },
      {
        resolveCheck: () => assert.fail("empty checks"),
      },
    ),
  );
  assert.equal(result.payload?.current.levelId, "ready");
  for (const id of ["initial", "terminal"])
    assert.throws(() => parseManifest(JSON.stringify(manifest({ levels: [{ id, checks: [] }] }))));
  const failed = await Effect.runPromise(
    observe(
      {
        spec: await fixture().load(),
        subject: { name: "fault" },
      },
      { resolveCheck: () => async () => ({ status: 503, payload: null, message: "offline" }) },
    ),
  );
  assert.equal(failed.payload, null);
  assert.equal(failed.status, 503);
});

test("an intrinsic initial dependency on the same subject needs no recursive business observation", async () => {
  const spec = await fixture().load();
  const probe = createObjectiveDependencyProbe(
    { spec, expectedLevelId: "initial" },
    { resolveCheck: () => assert.fail("initial dependency must not run checks") },
    { recordObservation: recordDependencyObservation },
  );
  const result = await Effect.runPromise(
    observe({ spec, subject: { name: "same" } }, { resolveCheck: () => probe }),
  );
  assert.equal(result.payload?.current.levelId, "a-next");
  assert.deepEqual(result.payload?.problems, []);
});
