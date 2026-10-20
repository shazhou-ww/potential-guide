import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "@potential-guide/effects";
import {
  compileSubjectProjection,
  observe,
  parseManifest,
  readPage,
  SUBJECT_PROJECTION_LIMITS,
} from "../src/index.js";
import { fixture, manifest, objectiveId } from "./fixtures.js";

test("same-level concurrency is opt-in, bounded and deterministic; later levels remain serial", async () => {
  for (const concurrency of [1, 2]) {
    const spec = await fixture().load();
    let active = 0;
    let maximum = 0;
    const completed: string[] = [];
    const result = await Effect.runPromise(
      observe(
        { spec, subject: { name: "repo" } },
        {
          checkConcurrency: concurrency,
          resolveCheck: (ref) => async () => {
            if (ref.levelId === "a-next") assert.equal(completed.length, 2);
            active++;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, ref.checkId === "one" ? 10 : 1));
            active--;
            completed.push(ref.checkId);
            return { status: 200, message: "", payload: { ok: true, problems: [] } };
          },
        },
      ),
    );
    assert.ok(result.payload !== null);
    assert.equal(result.payload.current.levelId, "terminal");
    assert.equal(maximum, concurrency);
  }
  let calls = 0;
  const spec = await fixture().load();
  await assert.rejects(
    Effect.runPromise(
      observe(
        { spec, subject: { name: "repo" } },
        {
          checkConcurrency: 0,
          resolveCheck: () => async () => {
            calls++;
            return { status: 200, message: "", payload: { ok: true, problems: [] } };
          },
        },
      ),
    ),
    /concurrency/,
  );
  assert.equal(calls, 0);
});

test("subject snapshots and wiki pages are immutable; invalid subject fails before probes", async () => {
  const data = fixture();
  const spec = await data.load();
  const subject = { name: "repo" };
  await Effect.runPromise(
    observe(
      { spec, subject },
      {
        resolveCheck: () => async (input) => {
          assert.equal(Object.isFrozen(input), true);
          return { status: 200, message: "", payload: { ok: true, problems: [] } };
        },
      },
    ),
  );
  assert.equal(Object.isFrozen(subject), false);
  assert.equal(Object.isFrozen(readPage(spec, "system/404")), true);
  let calls = 0;
  await assert.rejects(
    Effect.runPromise(
      observe(
        { spec, subject: { wrong: "repo" } },
        {
          resolveCheck: () => async () => {
            calls++;
            return { status: 200, message: "", payload: { ok: true, problems: [] } };
          },
        },
      ),
    ),
    /Invalid subject/,
  );
  assert.equal(calls, 0);
});

test("Wiki descriptions enforce exact Unicode codepoint limit across all declared languages", async () => {
  for (const size of [200, 201]) {
    const data = fixture();
    const pages = [...data.pages.values()][0];
    assert.ok(pages);
    const page = pages.find(({ uri }) => uri.endsWith("system/overview/zh-CN.md"));
    assert.ok(page);
    page.source = `---\ntitle: Title\ndescription: ${JSON.stringify("😀".repeat(size))}\nreferences: []\n---\n`;
    if (size === 200) {
      assert.equal(
        [...readPage(await data.load(), "system/overview", "zh-CN").description].length,
        200,
      );
    } else await assert.rejects(data.load(), /200 Unicode code points/);
  }
});

test("Wiki missing or dangling metadata, aliases and invalid frontmatter fail explicitly", async () => {
  for (const source of [
    "---\ntitle: Title\n---\nBody",
    "---\ntitle: Title\ndescription: Description\nlegacy: true\n---\nBody",
    "---\ntitle: Title\ndescription: Description\nreferences: [pages/missing]\n---\nBody",
    "---\ntitle: Title\ndescription: Description\n---\n[[pages/missing]]",
    "---\ntitle: &title Title\ndescription: *title\n---\nBody",
  ]) {
    const data = fixture();
    const page = [...data.pages.values()][0]?.[0];
    assert.ok(page);
    page.source = source;
    await assert.rejects(data.load());
  }
});

test("strict manifest schema rejects external references, reserved levels and duplicate problems in one check", async () => {
  for (const overrides of [
    { levels: [{ id: "terminal", checks: [] }] },
    {
      subjectSchema: {
        type: "object",
        properties: { value: { $ref: "https://external.test/schema" } },
      },
    },
    {
      levels: [
        {
          id: "first",
          checks: [{ id: "check", problems: ["problem", "problem"] }],
        },
      ],
    },
  ]) {
    const data = fixture();
    data.texts.set(`${objectiveId}objective.yaml`, JSON.stringify({ ...manifest(), ...overrides }));
    await assert.rejects(data.load());
  }
  assert.throws(
    () => parseManifest(JSON.stringify({ ...manifest(), unsupported: true })),
    /Expected fields/,
  );
});

test("deterministic projection rejects dynamic capabilities and bounds expression and output", () => {
  assert.deepEqual(
    compileSubjectProjection('{"name": name, "count": count + 1}')({ name: "repo", count: 1 }),
    { name: "repo", count: 2 },
  );
  for (const source of [
    "$eval('name')",
    "$now()",
    "$map(items,function($x){$x})",
    "$lookup($, 'name')",
  ]) {
    assert.throws(() => compileSubjectProjection(source));
  }
  assert.throws(
    () => compileSubjectProjection(" ".repeat(SUBJECT_PROJECTION_LIMITS.expressionBytes + 1)),
    /expression limit/,
  );
  assert.throws(
    () =>
      compileSubjectProjection("$")({ name: "x".repeat(SUBJECT_PROJECTION_LIMITS.outputBytes) }),
    /bounded/,
  );
});

test("source I/O failure stays explicit instead of returning an empty spec or fallback Wiki", async () => {
  const data = fixture();
  data.resources.readPages = async () => {
    throw new Error("source permission denied");
  };
  await assert.rejects(data.load(), /source permission denied/);
});
