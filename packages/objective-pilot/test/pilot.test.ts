import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, startEffect } from "@potential-guide/effects";
import {
  canonicalManifestUri,
  describeLevels,
  observe,
  type PilotRuntime,
  type PilotSpec,
  parseCheckEnvelope,
  readPage,
  searchPages,
} from "../src/index.js";
import { commit, fixture, manifest, objectiveId } from "./fixtures.js";

const pass = { status: 200, message: "", payload: { ok: true, problems: [] } } as const;
const fail = {
  status: 200,
  message: "",
  payload: {
    ok: false,
    problems: [{ id: "broken", parameters: { description: "broken instance" } }],
  },
} as const;
const subject = { name: "same-spec-different-subject" };

test("serializable recipe preserves stable IDs, source version and multilingual scoped Wiki", async () => {
  const spec = await fixture().load();
  assert.deepEqual(JSON.parse(JSON.stringify(spec)), spec);
  assert.equal(spec.objectiveId, objectiveId);
  assert.equal(spec.version, commit);
  assert.equal(readPage(spec, "levels/z-first", "zh-CN").title, "levels/z-first zh-CN");
  assert.equal(
    searchPages(spec, "Wiki", "en-US").length,
    Object.keys(spec.locales["en-US"]!).length,
  );
  assert.equal(readPage(spec, "not-found").id, "system/404");
  assert.deepEqual(
    describeLevels(spec).map(({ levelId }) => levelId),
    ["z-first", "a-next", "terminal"],
  );
  assert.equal(
    canonicalManifestUri("../child/pilot.yaml", objectiveId),
    "git+https://example.test/objectives.git#child/pilot.yaml",
  );
});

test("all checks at first blocked level aggregate, level traversal is serial not lexicographic", async () => {
  const spec = await fixture().load();
  const calls: string[] = [];
  let completed = 0;
  const runtime: PilotRuntime = {
    resolveCheck: (ref) => async () => {
      calls.push(`${ref.levelId}/${ref.checkId}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed++;
      return fail;
    },
  };
  const envelope = await Effect.runPromise(observe({ spec, subject }, runtime));
  assert.equal(envelope.status, 200);
  assert.ok(envelope.payload !== null);
  assert.equal(completed, 2);
  assert.deepEqual(calls, ["z-first/one", "z-first/two"]);
  assert.equal(envelope.payload.current.levelId, "z-first");
  assert.deepEqual(
    envelope.payload.problems.map(({ ref }) => ref),
    [
      { objectiveId, levelId: "z-first", checkId: "one", problemId: "broken" },
      { objectiveId, levelId: "z-first", checkId: "two", problemId: "broken" },
    ],
  );
  assert.equal("ok" in envelope.payload, false);
  assert.equal("subject" in spec, false);
  assert.deepEqual(envelope.payload.versions, { [objectiveId]: commit });
  const inputs: unknown[] = [];
  await Effect.runPromise(
    observe(
      { spec, subject: { name: "another" } },
      {
        resolveCheck: () => async (input) => {
          inputs.push(input);
          return pass;
        },
      },
    ),
  );
  assert.equal(inputs.length, 3);
  assert.deepEqual(inputs[0], { name: "another" });
});

test("prerequisites run first with projected subject and retain their Objective ownership", async () => {
  const child = "git+https://example.test/objectives.git#child/pilot.yaml";
  const spec = await fixture({
    [objectiveId]: manifest({
      prerequisite: {
        manifestUri: "../child/pilot.yaml",
        subject: '{"name": name}',
        minimumLevelId: "a-next",
      },
    }),
    [child]: manifest(),
  }).load();
  const calls: string[] = [];
  const first = await Effect.runPromise(
    observe(
      { spec, subject },
      {
        resolveCheck: (ref) => async (input) => {
          calls.push(ref.objectiveId);
          assert.deepEqual(input, subject);
          return fail;
        },
      },
    ),
  );
  assert.ok(first.payload !== null);
  assert.equal(first.payload.current.objectiveId, child);
  assert.deepEqual(calls, [child, child]);
  assert.deepEqual(first.payload.versions, { [objectiveId]: commit, [child]: commit });
  calls.length = 0;
  const second = await Effect.runPromise(
    observe(
      { spec, subject },
      {
        resolveCheck: (ref) => async () => {
          calls.push(`${ref.objectiveId}/${ref.levelId}`);
          return ref.levelId === "z-first" && ref.objectiveId === child ? pass : fail;
        },
      },
    ),
  );
  assert.ok(second.payload !== null);
  assert.equal(second.payload.current.objectiveId, objectiveId);
  assert.ok(calls.indexOf(`${child}/a-next`) < calls.indexOf(`${objectiveId}/z-first`));
});

test("invocation failure never manufactures a trusted level and cannot mask sibling checks", async () => {
  const spec = await fixture().load();
  let calls = 0;
  const result = await Effect.runPromise(
    observe(
      { spec, subject },
      {
        resolveCheck: (ref) => async () => {
          calls++;
          if (ref.checkId === "one") throw new Error("transport failed");
          return fail;
        },
      },
    ),
  );
  assert.equal(calls, 2);
  assert.ok(result.payload === null);
  assert.match(result.message, /^check-invocation:/);
  assert.equal("current" in result, false);
});

test("rejects invalid domain, unsupported language, undeclared problems and noncommitted inputs", async () => {
  const spec = await fixture().load();
  let calls = 0;
  const runtime: PilotRuntime = {
    resolveCheck: () => async () => {
      calls++;
      return pass;
    },
  };
  await assert.rejects(
    Effect.runPromise(observe({ spec, subject: {} }, runtime)),
    /Invalid subject/,
  );
  await assert.rejects(
    Effect.runPromise(observe({ spec, subject, language: "fr-FR" }, runtime)),
    /Unsupported language/,
  );
  await assert.rejects(
    Effect.runPromise(observe({ spec: { ...spec, version: "working-tree" }, subject }, runtime)),
    /exact commit/,
  );
  await assert.rejects(
    Effect.runPromise(
      observe({ spec: { ...spec, objectiveId: "file:///tmp/pilot.yaml" }, subject }, runtime),
    ),
    /stable Git/,
  );
  assert.equal(calls, 0);
  const invalid = await Effect.runPromise(
    observe(
      { spec, subject },
      {
        resolveCheck: () => async () => ({
          status: 200,
          message: "",
          payload: { ok: false, problems: [{ id: "undeclared", parameters: {} }] },
        }),
      },
    ),
  );
  assert.ok(invalid.payload === null);
  assert.match(invalid.message, /Undeclared/);
});

test("strict YAML, duplicate scope IDs, locales and cyclic prerequisites fail before observation", async () => {
  const data = fixture();
  data.texts.set(objectiveId, "schemaVersion: 1\nschemaVersion: 1\n");
  await assert.rejects(data.load(), /Invalid YAML/);
  const cyclic = fixture({
    [objectiveId]: manifest({ prerequisite: { manifestUri: objectiveId, subject: "$" } }),
  });
  await assert.rejects(cyclic.load(), /Cyclic/);
  const missingLocale = fixture();
  for (const resources of missingLocale.pages.values()) resources.pop();
  await assert.rejects(missingLocale.load(), /every language/);
  const bad = fixture();
  const config = manifest();
  const duplicated = structuredClone(config);
  const first = duplicated.levels[0]!;
  bad.texts.set(
    objectiveId,
    JSON.stringify({
      ...duplicated,
      levels: [
        {
          ...first,
          advancement: { checks: [first.advancement.checks[0], first.advancement.checks[0]] },
        },
      ],
    }),
  );
  await assert.rejects(bad.load(), /Duplicate check/);
});

test("pre-aborted native effect never starts a probe", async () => {
  const spec: PilotSpec = await fixture().load();
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const handle = startEffect(
    observe(
      { spec, subject },
      {
        resolveCheck: () => async () => {
          calls++;
          return pass;
        },
      },
    ),
    controller.signal,
  );
  await assert.rejects(handle.await());
  assert.equal(calls, 0);
});

test("business failure is a successful envelope; malformed protocol is not accepted", () => {
  assert.deepEqual(parseCheckEnvelope(fail), fail);
  for (const value of [
    { pass: false },
    { status: 200, message: "", payload: { ok: true, problems: [{ id: "bad", parameters: {} }] } },
    { status: 200, error: { kind: "oops", message: "not a success" } },
    { status: 500, value: { ok: true, problems: [] } },
  ])
    assert.throws(() => parseCheckEnvelope(value));
});
