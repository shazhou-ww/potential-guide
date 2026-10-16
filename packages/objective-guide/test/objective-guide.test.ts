import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import type {
  CheckRequest,
  ObjectiveCheckSchedulingContext,
  ObjectiveGuideInstance,
  ObjectiveGuideManifest,
  ObjectiveLoaderOptions,
  ObjectivePageResource,
  ObjectiveResourceResolver,
} from "@potential-guide/objective-guide";
import {
  createObjectiveLoader,
  ObjectiveConfigurationError,
  ObjectiveOperationError,
  SUBJECT_PROJECTION_LIMITS,
} from "@potential-guide/objective-guide";
import { compileSubjectProjection } from "../src/projection.js";

const rootUri = "https://objectives.test/root/manifest.yaml";
const childUri = "https://objectives.test/child/manifest.yaml";
type Handler = (request: CheckRequest) => Promise<unknown>;

function checks(...ids: string[]) {
  return ids.map((id) => ({ id, problems: [`${id}-problem`] }));
}

function manifest(overrides: Partial<ObjectiveGuideManifest> = {}): ObjectiveGuideManifest {
  return {
    schemaVersion: 1,
    domainSchema: {
      type: "object",
      required: ["root"],
      properties: { root: { type: "string" } },
      additionalProperties: false,
    },
    levels: [{ id: "unready", advancement: { checks: checks("ready") } }],
    defaultLanguage: "en-US",
    languages: ["en-US", "zh-CN"],
    ...overrides,
  };
}
function markdown(properties: Record<string, unknown>, body = "") {
  return `---\n${Object.entries({ references: [], ...properties })
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n${body}\n`;
}
function fixture(
  configs: Record<string, ObjectiveGuideManifest> = { [rootUri]: manifest() },
  handlers: Record<string, Handler> = {},
  options: Pick<ObjectiveLoaderOptions, "checkSchedulingPolicy"> = {},
) {
  const texts = new Map<string, string>();
  const pages = new Map<string, ObjectivePageResource[]>();
  const reads: string[] = [];
  for (const [uri, config] of Object.entries(configs)) {
    texts.set(uri, JSON.stringify(config));
    const source = new URL("references/", uri).href;
    const resources: ObjectivePageResource[] = [];
    const add = (id: string, language: string, properties: Record<string, string>, body = "") => {
      resources.push({
        uri: new URL(`${id}/${language}.md`, source).href,
        source: markdown(properties, body),
      });
    };
    for (const language of config.languages) {
      add("system/overview", language, { title: language, description: `Objective ${language}` });
      add("system/404", language, {
        title: `Missing ${language}`,
        description: `Missing ${language}`,
      });
      add("levels/terminal", language, {
        title: `Ready ${language}`,
        description: `Ready ${language}`,
      });
      for (const level of config.levels) {
        add(
          `levels/${level.id}`,
          language,
          {
            title: `${level.id} ${language}`,
            description: `Waiting ${language}`,
          },
          `Cost and benefit ${language}`,
        );
        for (const check of level.advancement.checks) {
          add(`checks/${check.id}`, language, {
            title: check.id,
            description: `Check ${check.id} ${language}`,
          });
          for (const problemId of check.problems)
            add(
              `problems/${problemId}`,
              language,
              {
                title: `Problem ${language}`,
                description: `Fix it ${language}`,
              },
              "[[system/404]]",
            );
        }
      }
    }
    pages.set(source, resources);
  }
  const resources: ObjectiveResourceResolver = {
    async readText(uri) {
      reads.push(uri);
      const value = texts.get(uri);
      if (value === undefined) throw new Error(`Missing text ${uri}`);
      return value;
    },
    async readPages(uri) {
      const value = pages.get(uri);
      if (value === undefined) throw new Error(`Missing pages ${uri}`);
      return value;
    },
  };
  const loader = createObjectiveLoader({
    ...options,
    resources,
    checkRunner: {
      async run(_uri, id, request) {
        const result = await (handlers[id] ?? (async () => ({ pass: true }) as const))(request);
        if (
          result !== null &&
          typeof result === "object" &&
          "pass" in result &&
          result.pass === false &&
          "problems" in result &&
          Array.isArray(result.problems)
        ) {
          return {
            ...result,
            problems: result.problems.map((problem: unknown) =>
              problem !== null &&
              typeof problem === "object" &&
              "id" in problem &&
              problem.id === "problem"
                ? { ...problem, id: `${id}-problem` }
                : problem,
            ),
          };
        }
        return result;
      },
    },
  });

  return { texts, pages, reads, resources, loader };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("default scheduling runs all same-stage checks serially and aggregates every problem", async () => {
  const calls: string[] = [];
  let active = 0;
  let maximum = 0;
  const context = fixture(
    {
      [rootUri]: manifest({
        levels: [
          { id: "stage", advancement: { checks: checks("first", "second", "third") } },
          { id: "later", advancement: { checks: checks("later") } },
        ],
      }),
    },
    Object.fromEntries(
      ["first", "second", "third", "later"].map((id) => [
        id,
        async () => {
          calls.push(id);
          maximum = Math.max(maximum, ++active);
          await Promise.resolve();
          active -= 1;
          return id === "third"
            ? { pass: true }
            : {
                pass: false,
                problems: [
                  { id: "problem", parameters: { description: id } },
                  { id: "problem", parameters: { description: `${id} detail` } },
                ],
              };
        },
      ]),
    ),
  );
  const sample = await (await instance(context)).probe();
  assert.equal(maximum, 1);
  assert.deepEqual(calls, ["first", "second", "third"]);
  assert.equal(sample.current.id, "stage");
  assert.equal(sample.gapSummary, "first\nfirst detail\nsecond\nsecond detail");
  assert.equal(sample.problems.length, 4);
  assert.ok(Object.isFrozen(sample.problems));
  assert.ok(sample.problems.every((problem) => Object.isFrozen(problem.parameters)));
});

test("changing injected concurrency changes timing but not observations", async () => {
  let concurrency = 1;
  let active = 0;
  let maximum = 0;
  const context = fixture(
    {
      [rootUri]: manifest({
        levels: [{ id: "stage", advancement: { checks: checks("first", "second") } }],
      }),
    },
    Object.fromEntries(
      ["first", "second"].map((id) => [
        id,
        async () => {
          maximum = Math.max(maximum, ++active);
          await Promise.resolve();
          active -= 1;
          return { pass: false, problems: [{ id: "problem", parameters: { description: id } }] };
        },
      ]),
    ),
    { checkSchedulingPolicy: () => concurrency },
  );
  const current = await instance(context);
  const serial = await current.probe();
  assert.equal(maximum, 1);
  concurrency = 2;
  maximum = 0;
  const parallel = await current.probe();
  assert.equal(maximum, 2);
  assert.deepEqual(parallel, serial);
});

test("concurrent probes have independent limits and temporary directories", {
  timeout: 5_000,
}, async () => {
  const started = gate();
  const finish = gate();
  const directories: string[] = [];
  const context = fixture(
    {
      [rootUri]: manifest({
        levels: [{ id: "stage", advancement: { checks: checks("first", "second") } }],
      }),
    },
    Object.fromEntries(
      ["first", "second"].map((id) => [
        id,
        async (request: CheckRequest) => {
          assert.ok(Object.isFrozen(request));
          assert.ok(Object.isFrozen(request.probe));
          directories.push(request.probe.tempDirectory);
          if (directories.length === 4) started.release();
          await finish.promise;
          return { pass: false, problems: [{ id: "problem", parameters: { description: id } }] };
        },
      ]),
    ),
    { checkSchedulingPolicy: () => 2 },
  );
  const current = await instance(context);
  const probing = Promise.all([current.probe(), current.probe()]);
  try {
    await started.promise;
    assert.equal(new Set(directories).size, 2);
    for (const directory of directories) assert.ok((await stat(directory)).isDirectory());
  } finally {
    finish.release();
    await probing;
  }
  for (const directory of new Set(directories)) await assert.rejects(stat(directory));
});

test("injected scheduling overlaps checks up to its limit and preserves manifest result order", {
  timeout: 5_000,
}, async () => {
  const names = ["first", "second", "third", "fourth"];
  const gates = names.map(() => gate());
  const twoStarted = gate();
  const thirdStarted = gate();
  const fourthStarted = gate();
  const calls: string[] = [];
  const completed: string[] = [];
  let active = 0;
  let maximum = 0;
  const context = fixture(
    {
      [rootUri]: manifest({ levels: [{ id: "stage", advancement: { checks: checks(...names) } }] }),
    },
    Object.fromEntries(
      names.map((id, index) => [
        id,
        async () => {
          calls.push(id);
          maximum = Math.max(maximum, ++active);
          if (calls.length === 2) twoStarted.release();
          if (id === "third") thirdStarted.release();
          if (id === "fourth") fourthStarted.release();
          await gates[index]!.promise;
          active -= 1;
          completed.push(id);
          return { pass: false, problems: [{ id: "problem", parameters: { description: id } }] };
        },
      ]),
    ),
    { checkSchedulingPolicy: async () => 2 },
  );
  const current = await instance(context);
  const probing = current.probe();
  try {
    await twoStarted.promise;
    assert.deepEqual(calls, ["first", "second"]);
    gates[1]!.release();
    await thirdStarted.promise;
    assert.deepEqual(calls, ["first", "second", "third"]);
    gates[2]!.release();
    await fourthStarted.promise;
    gates[3]!.release();
    gates[0]!.release();
    const sample = await probing;
    assert.equal(maximum, 2);
    assert.equal(sample.current.id, "stage");
    assert.deepEqual(completed.slice(0, 2), ["second", "third"]);
    assert.equal(sample.gapSummary, names.join("\n"));
  } finally {
    for (const entry of gates) entry.release();
    await probing;
  }
});

test("later-stage scheduling waits for every current-stage check to pass", {
  timeout: 5_000,
}, async () => {
  const slow = gate();
  const fastDone = gate();
  const scheduled: string[] = [];
  const context = fixture(
    {
      [rootUri]: manifest({
        levels: [
          { id: "stage", advancement: { checks: checks("slow", "fast") } },
          { id: "later", advancement: { checks: checks("later") } },
        ],
      }),
    },
    {
      slow: async () => {
        await slow.promise;
        return { pass: true };
      },
      fast: async () => {
        fastDone.release();
        return { pass: true };
      },
    },
    {
      checkSchedulingPolicy: ({ levelId }) => {
        scheduled.push(levelId);
        return 10;
      },
    },
  );
  const probing = (await instance(context)).probe();
  try {
    await fastDone.promise;
    await setImmediate();
    assert.deepEqual(scheduled, ["stage"]);
    slow.release();
    assert.equal((await probing).current.id, "terminal");
    assert.deepEqual(scheduled, ["stage", "later"]);
  } finally {
    slow.release();
    await probing;
  }
});

test("policy receives frozen stage context throughout prerequisites and repeated probes", async () => {
  let passing = false;
  const scheduled: ObjectiveCheckSchedulingContext[] = [];
  const context = fixture(
    {
      [rootUri]: manifest({
        prerequisite: { manifestUri: childUri, subject: '{"root": root}' },
      }),
      [childUri]: manifest({
        levels: [{ id: "child-stage", advancement: { checks: checks("child-one", "child-two") } }],
      }),
    },
    {
      "child-one": async () =>
        passing ? { pass: true } : { pass: false, problems: [{ id: "problem", parameters: {} }] },
    },
    {
      checkSchedulingPolicy: (value) => {
        assert.ok(Object.isFrozen(value));
        assert.ok(Object.isFrozen(value.checkIds));
        scheduled.push(value);
        return 2;
      },
    },
  );
  const current = await instance(context);
  assert.equal((await current.probe()).current.instance, current.prerequisite);
  assert.deepEqual(
    scheduled.map(({ levelId }) => levelId),
    ["child-stage"],
  );
  assert.equal(scheduled[0]?.instance, current.prerequisite);
  assert.deepEqual(scheduled[0]?.checkIds, ["child-one", "child-two"]);
  passing = true;
  assert.equal((await current.probe()).current.id, "terminal");
  assert.equal((await current.probe()).current.id, "terminal");
  assert.deepEqual(
    scheduled.map(({ levelId }) => levelId),
    ["child-stage", "child-stage", "unready", "child-stage", "unready"],
  );
  assert.equal(scheduled[2]?.instance, current);
});

test("empty stages advance without calling the scheduling policy", async () => {
  let calls = 0;
  const context = fixture(
    { [rootUri]: manifest({ levels: [{ id: "empty", advancement: { checks: [] } }] }) },
    {},
    {
      checkSchedulingPolicy: () => {
        calls += 1;
        return 0;
      },
    },
  );
  assert.equal((await (await instance(context)).probe()).current.id, "terminal");
  assert.equal(calls, 0);
});

test("invalid scheduling limits and policy failures reject explicitly before running checks", async () => {
  for (const concurrency of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const current = await instance(
      fixture(
        undefined,
        { ready: async () => assert.fail("Invalid policy must not run checks.") },
        { checkSchedulingPolicy: () => concurrency },
      ),
    );
    await assert.rejects(current.probe(), /positive safe integer/);
  }
  const cause = new Error("budget unavailable");
  for (const policy of [
    () => {
      throw cause;
    },
    async () => {
      throw cause;
    },
  ]) {
    const current = await instance(
      fixture(
        undefined,
        { ready: async () => assert.fail("Failed policy must not run checks.") },
        { checkSchedulingPolicy: policy },
      ),
    );
    await assert.rejects(
      current.probe(),
      (error) => error instanceof ObjectiveOperationError && error.cause === cause,
    );
  }
  const options: ObjectiveLoaderOptions = {};
  Reflect.set(options, "checkSchedulingPolicy", null);
  assert.throws(() => createObjectiveLoader(options), ObjectiveConfigurationError);
});

test("operation errors stop queued checks but drain active checks before directory cleanup", {
  timeout: 5_000,
}, async () => {
  for (const invalidResult of [false, true]) {
    const fail = gate();
    const peer = gate();
    const started = gate();
    const error = new Error("runner failed");
    const calls: string[] = [];
    let directory = "";
    let settled = false;
    const context = fixture(
      {
        [rootUri]: manifest({
          levels: [{ id: "stage", advancement: { checks: checks("first", "second", "queued") } }],
        }),
      },
      {
        first: async () => {
          calls.push("first");
          await fail.promise;
          if (invalidResult) return { pass: false, problems: [] };
          throw error;
        },
        second: async (request) => {
          calls.push("second");
          directory = request.probe.tempDirectory;
          started.release();
          await peer.promise;
          assert.ok((await stat(directory)).isDirectory());
          if (!invalidResult) throw new Error("second runner failed");
          return { pass: true };
        },
        queued: async () => assert.fail("Queued checks must not start after an operation error."),
      },
      { checkSchedulingPolicy: () => 2 },
    );
    const probing = (await instance(context)).probe();
    const rejected = assert.rejects(probing, (caught) =>
      invalidResult ? caught instanceof ObjectiveOperationError : caught === error,
    );
    probing.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    try {
      await started.promise;
      fail.release();
      await setImmediate();
      assert.equal(settled, false);
      assert.deepEqual(calls, ["first", "second"]);
      assert.ok((await stat(directory)).isDirectory());
    } finally {
      fail.release();
      peer.release();
      await rejected;
    }
    await assert.rejects(stat(directory));
  }
});
async function instance(
  context: ReturnType<typeof fixture>,
  language = "en-US",
): Promise<ObjectiveGuideInstance> {
  const guide = await context.loader.load(rootUri);
  const created = guide.createInstance({ subject: { root: "project" }, language });
  if (!created.ok) assert.fail(JSON.stringify({ type: created.error.type }));
  return created.instance;
}

test("all Reference namespaces share metadata and resolve localized titles by identity", async () => {
  const context = fixture();
  const source = new URL("references/", rootUri).href;
  const references = ["pages/shared", "checks/ready"];
  for (const resource of context.pages.get(source)!) {
    resource.source = resource.source.replace(
      "references: []",
      `references: ${JSON.stringify(references)}`,
    );
  }
  for (const language of ["en-US", "zh-CN"]) {
    context.pages.get(source)!.push({
      uri: new URL(`pages/shared/${language}.md`, source).href,
      source: markdown({ title: `Shared ${language}`, description: "Shared guidance" }),
    });
  }
  const en = await instance(context);
  const zh = await instance(context, "zh-CN");
  for (const id of [
    "system/overview",
    "system/404",
    "levels/unready",
    "levels/terminal",
    "checks/ready",
    "problems/ready-problem",
  ]) {
    const page = await en.readPage(id);
    assert.deepEqual(page.references, references);
    assert.ok(Object.isFrozen(page.references));
    assert.equal(typeof page.description, "string");
  }
  assert.deepEqual((await en.readPage("pages/shared")).references, []);
  assert.equal((await en.readPage(references[0]!)).title, "Shared en-US");
  assert.equal((await zh.readPage(references[0]!)).title, "Shared zh-CN");
});

test("every Reference namespace rejects missing, legacy and invalid metadata", async () => {
  const namespaces = [
    "system/overview",
    "system/404",
    "levels/unready",
    "levels/terminal",
    "checks/ready",
    "problems/ready-problem",
    "pages/extra",
  ];
  const valid = { title: "Title", description: "Summary", references: [] };
  const invalid: Record<string, unknown>[] = [
    { description: "Summary", references: [] },
    { title: "Title", references: [] },
    { ...valid, title: " " },
    { ...valid, title: 1 },
    { ...valid, description: " \n\t" },
    { ...valid, description: 1 },
    { ...valid, description: null },
    { ...valid, description: "a".repeat(201) },
    { ...valid, description: "\u{1f680}".repeat(201) },
    { ...valid, outcome: "Legacy outcome" },
    { ...valid, instruction: "Legacy instruction" },
    { ...valid, tldr: "Unknown field" },
    { ...valid, references: null },
    { ...valid, references: "system/overview" },
    { ...valid, references: [{ id: "system/overview", title: "Duplicated title" }] },
    { ...valid, references: [1] },
    { ...valid, references: ["../overview"] },
    { ...valid, references: ["system/overview/en-US.md"] },
    { ...valid, references: ["system/overview", "system/overview"] },
    { ...valid, references: ["pages/missing"] },
  ];
  for (const id of namespaces) {
    for (const metadata of invalid) {
      const context = fixture();
      const source = new URL("references/", rootUri).href;
      const uri = new URL(`${id}/en-US.md`, source).href;
      const resources = context.pages.get(source)!;
      if (id === "pages/extra") {
        for (const language of ["en-US", "zh-CN"]) {
          resources.push({
            uri: new URL(`${id}/${language}.md`, source).href,
            source: markdown(valid),
          });
        }
      }
      resources.find((resource) => resource.uri === uri)!.source =
        `---\n${JSON.stringify(metadata)}\n---\n`;
      await assert.rejects(
        context.loader.load(rootUri),
        ObjectiveConfigurationError,
        `${id}: ${JSON.stringify(metadata)}`,
      );
    }
  }
});

test("omitted references default to immutable empty arrays for every namespace", async () => {
  const context = fixture();
  const source = new URL("references/", rootUri).href;
  for (const resource of context.pages.get(source)!) {
    resource.source = resource.source.replace("references: []\n", "");
  }
  for (const language of ["en-US", "zh-CN"]) {
    context.pages.get(source)!.push({
      uri: new URL(`pages/extra/${language}.md`, source).href,
      source: "---\ntitle: Extra\ndescription: Summary\n---\n",
    });
  }
  for (const language of ["en-US", "zh-CN"]) {
    const current = await instance(context, language);
    for (const id of [
      "system/overview",
      "system/404",
      "levels/unready",
      "levels/terminal",
      "checks/ready",
      "problems/ready-problem",
      "pages/extra",
    ]) {
      const page = await current.readPage(id);
      assert.deepEqual(page.references, []);
      assert.ok(Object.isFrozen(page.references));
    }
  }
});

test("description length counts Unicode code points and accepts the exact limit", async () => {
  for (const description of ["a", "a".repeat(200), "\u96ea".repeat(200), "\u{1f680}".repeat(200)]) {
    const context = fixture();
    const source = new URL("references/", rootUri).href;
    for (const resource of context.pages.get(source)!) {
      resource.source = markdown({ title: "Title", description });
    }
    const current = await instance(context);
    assert.equal(current.description, description);
    assert.equal((await current.readPage("levels/terminal")).description, description);
  }
});

test("Guide validation includes non-default language metadata and reference language coverage", async () => {
  for (const metadata of [
    { title: "Title", description: "a".repeat(201) },
    { title: "Title", description: "Summary", references: ["pages/missing"] },
  ]) {
    const context = fixture();
    const source = new URL("references/", rootUri).href;
    const overview = context.pages
      .get(source)!
      .find(({ uri }) => uri.endsWith("/system/overview/zh-CN.md"))!;
    overview.source = markdown(metadata);
    await assert.rejects(context.loader.load(rootUri), ObjectiveConfigurationError);
  }
  const context = fixture();
  const source = new URL("references/", rootUri).href;
  context.pages.get(source)!.push({
    uri: new URL("pages/shared/en-US.md", source).href,
    source: markdown({ title: "Shared", description: "Summary" }),
  });
  const overview = context.pages
    .get(source)!
    .find(({ uri }) => uri.endsWith("/system/overview/en-US.md"))!;
  overview.source = markdown({
    title: "Title",
    description: "Summary",
    references: ["pages/shared"],
  });
  await assert.rejects(context.loader.load(rootUri), /cover every language/);
});

test("canonical identity is language-neutral and References provide descriptions", async () => {
  const context = fixture();
  const [first, second] = await Promise.all([
    context.loader.load(rootUri),
    context.loader.load("https://objectives.test/root/./manifest.yaml"),
  ]);
  assert.equal(first, second);
  assert.equal(context.reads.filter((uri) => uri === rootUri).length, 1);
  const en = await instance(context);
  const zh = await instance(context, "zh-CN");
  assert.equal(en.guide, zh.guide);
  assert.equal(en.title, "en-US");
  assert.equal(zh.title, "zh-CN");
  assert.deepEqual(
    en.describeLevels().map(({ id }) => id),
    ["unready", "terminal"],
  );
  assert.equal((await en.readPage("levels/unready")).content, "Cost and benefit en-US");
  assert.ok(!Object.hasOwn(en.describeLevels()[0]!, "advancementOutcome"));
  assert.equal((await en.readPage("missing")).id, "system/404");
  assert.deepEqual(await en.searchPages("fix it"), [
    { id: "problems/ready-problem", title: "Problem en-US" },
  ]);
});

test("instance subjects are immutable and schema/language failures remain typed", async () => {
  const guide = await fixture().loader.load(rootUri);
  const subject = { root: "before" };
  const result = guide.createInstance({ subject });
  if (!result.ok) assert.fail("Expected instance.");
  subject.root = "after";
  assert.equal(result.instance.subject.root, "before");
  assert.ok(Object.isFrozen(result.instance.subject));
  const invalid = guide.createInstance({ subject: { root: 5 } });
  if (invalid.ok || invalid.error.type !== "invalid-subject")
    assert.fail("Expected subject failure.");
  const unsupported = guide.createInstance({ subject: { root: "x" }, language: "en" });
  if (unsupported.ok || unsupported.error.type !== "unsupported-language")
    assert.fail("Expected language failure.");
});

test("ordered checks share one probe directory, clean it and return stable Problem IDs", async () => {
  const calls: string[] = [];
  const directories: string[] = [];
  let passing = false;
  const config = manifest({
    levels: [
      { id: "one", advancement: { checks: checks("first") } },
      { id: "two", advancement: { checks: checks("second") } },
    ],
  });
  const context = fixture(
    { [rootUri]: config },
    {
      first: async (request) => {
        calls.push("first");
        directories.push(request.probe.tempDirectory);
        return passing
          ? { pass: true }
          : {
              pass: false,
              problems: [{ id: "problem", parameters: { description: "Dynamic detail" } }],
            };
      },
      second: async (request) => {
        calls.push("second");
        directories.push(request.probe.tempDirectory);
        return { pass: true };
      },
    },
  );
  const current = await instance(context);
  const failed = await current.probe();
  assert.equal(failed.current.id, "one");
  assert.equal(failed.gapSummary, "Dynamic detail");
  assert.equal(failed.problems[0]?.id, "first-problem");
  assert.equal(
    (await failed.current.instance.readPage(`problems/${failed.problems[0]!.id}`)).id,
    "problems/first-problem",
  );
  await assert.rejects(stat(directories[0]!));
  passing = true;
  assert.equal((await current.probe()).current.id, "terminal");
  assert.deepEqual(calls, ["first", "first", "second"]);
  assert.equal(directories[1], directories[2]);
  assert.notEqual(directories[0], directories[1]);
  await assert.rejects(stat(directories[1]!));
});

test("prerequisite defaults to terminal and can unlock at a declared minimum level", async () => {
  let passFirst = false;
  const calls: string[] = [];
  const child = manifest({
    levels: [
      { id: "configured", advancement: { checks: checks("first") } },
      { id: "synchronized", advancement: { checks: checks("second") } },
    ],
  });
  const root = manifest({
    prerequisite: {
      manifestUri: childUri,
      subject: '{"root": root}',
      minimumLevelId: "synchronized",
    },
  });
  const context = fixture(
    { [rootUri]: root, [childUri]: child },
    {
      first: async () => {
        calls.push("first");
        return passFirst
          ? { pass: true }
          : {
              pass: false,
              problems: [{ id: "problem", parameters: {} }],
            };
      },
      second: async () => {
        calls.push("second");
        return { pass: false, problems: [{ id: "problem", parameters: {} }] };
      },
      ready: async () => {
        calls.push("root");
        return { pass: true };
      },
    },
  );
  const current = await instance(context);
  assert.deepEqual(
    current.describeLevels().map(({ id }) => id),
    ["configured", "unready", "terminal"],
  );
  assert.equal((await current.probe()).current.id, "configured");
  passFirst = true;
  const sample = await current.probe();
  assert.equal(sample.current.instance, current);
  assert.equal(sample.current.id, "terminal");
  assert.deepEqual(calls, ["first", "first", "second", "root"]);

  const terminalContext = fixture(
    {
      [rootUri]: manifest({ prerequisite: { manifestUri: childUri, subject: '{"root": root}' } }),
      [childUri]: child,
    },
    {
      first: async () => ({ pass: true }),
      second: async () => ({ pass: false, problems: [{ id: "problem", parameters: {} }] }),
    },
  );
  assert.equal((await (await instance(terminalContext)).probe()).current.id, "synchronized");
});

test("invalid minimum levels, malformed References and unknown Problems fail explicitly", async () => {
  const invalidMinimum = fixture({
    [rootUri]: manifest({
      prerequisite: {
        manifestUri: childUri,
        subject: '{"root": root}',
        minimumLevelId: "missing",
      },
    }),
    [childUri]: manifest(),
  });
  await assert.rejects(invalidMinimum.loader.load(rootUri), /minimum level/);

  const missing = fixture();
  const source = new URL("references/", rootUri).href;
  missing.pages.set(
    source,
    missing.pages.get(source)!.filter(({ uri }) => !uri.includes("/system/404/")),
  );
  await assert.rejects(missing.loader.load(rootUri), /Missing Reference|cover every language/);

  const unknown = await instance(
    fixture(undefined, {
      ready: async () => ({ pass: false, problems: [{ id: "missing", parameters: {} }] }),
    }),
  );
  await assert.rejects(unknown.probe(), ObjectiveOperationError);
});

test("manifest tree and Reference identities are exact", async () => {
  const legacy = fixture();
  legacy.texts.set(
    rootUri,
    JSON.stringify({
      ...manifest(),
      levels: [{ id: "stage", advancement: { checks: ["legacy"] } }],
    }),
  );
  await assert.rejects(legacy.loader.load(rootUri), /Invalid check/);

  const duplicateCheck = fixture();
  duplicateCheck.texts.set(
    rootUri,
    JSON.stringify({
      ...manifest(),
      levels: [
        { id: "one", advancement: { checks: checks("shared") } },
        { id: "two", advancement: { checks: checks("shared") } },
      ],
    }),
  );
  await assert.rejects(duplicateCheck.loader.load(rootUri), /Duplicate check ID/);

  const duplicateProblem = fixture();
  duplicateProblem.texts.set(
    rootUri,
    JSON.stringify({
      ...manifest(),
      levels: [
        {
          id: "stage",
          advancement: {
            checks: [
              { id: "first", problems: ["shared"] },
              { id: "second", problems: ["shared"] },
            ],
          },
        },
      ],
    }),
  );
  await assert.rejects(duplicateProblem.loader.load(rootUri), /exactly one check/);

  const source = new URL("references/", rootUri).href;
  for (const namespace of ["levels", "checks", "problems"]) {
    const extra = fixture();
    extra.pages.get(source)!.push({
      uri: new URL(`${namespace}/extra/en-US.md`, source).href,
      source: markdown({ title: "Extra", description: "Extra" }),
    });
    await assert.rejects(
      extra.loader.load(rootUri),
      new RegExp(`Unknown ${namespace.slice(0, -1)}`),
    );
  }

  const missingProblem = fixture();
  missingProblem.pages.set(
    source,
    missingProblem.pages
      .get(source)!
      .filter(({ uri }) => !uri.includes("/problems/ready-problem/zh-CN.md")),
  );
  await assert.rejects(missingProblem.loader.load(rootUri), /cover every language/);
});

test("a check cannot return a Problem owned by another check", async () => {
  const current = await instance(
    fixture(
      {
        [rootUri]: manifest({
          levels: [{ id: "stage", advancement: { checks: checks("first", "second") } }],
        }),
      },
      {
        first: async () => ({
          pass: false,
          problems: [{ id: "second-problem", parameters: {} }],
        }),
      },
    ),
  );
  await assert.rejects(current.probe(), /undeclared Problem ID/);
});

test("projection profile rejects dynamic capabilities and bounds execution/output", () => {
  for (const expression of [
    "$now()",
    "$random()",
    "$eval(root)",
    "$map(root, function($x){$x})",
    "($x := root; $x)",
  ]) {
    assert.throws(() => compileSubjectProjection(expression), /JSONata|projection|AST/);
  }
  assert.throws(
    () => compileSubjectProjection(" ".repeat(SUBJECT_PROJECTION_LIMITS.expressionBytes + 1)),
    /expression limit/,
  );
  assert.deepEqual(
    compileSubjectProjection('{"root": root, "n": count + 1}')({ root: "project", count: 2 }),
    { root: "project", n: 3 },
  );
});

test("resource and runner errors propagate instead of becoming low levels or 404", async () => {
  const error = new Error("permission denied");
  const context = fixture();
  await assert.rejects(
    createObjectiveLoader({
      resources: {
        ...context.resources,
        readText: async () => {
          throw error;
        },
      },
    }).load(rootUri),
    (caught) => caught === error,
  );
  const failed = await instance(
    fixture(undefined, {
      ready: async () => {
        throw error;
      },
    }),
  );
  await assert.rejects(failed.probe(), (caught) => caught === error);
  const malformed = await instance(
    fixture(undefined, {
      ready: async () => ({ pass: false, problems: [] }),
    }),
  );
  await assert.rejects(malformed.probe(), ObjectiveOperationError);
});
