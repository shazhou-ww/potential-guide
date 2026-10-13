import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type {
  ObjectiveCheck,
  ObjectiveGuideManifest,
  ObjectiveLoaderOptions,
  ObjectivePageResource,
  ObjectiveResourceResolver,
} from "@potential-guide/objective-guide";
import {
  createObjectiveLoader,
  fileObjectiveResources,
  ObjectiveConfigurationError,
  ObjectiveOperationError,
} from "@potential-guide/objective-guide";

const rootUri = "https://objectives.test/root/objective-guide.yaml";
const childUri = "https://objectives.test/child/objective-guide.yaml";

function manifest(overrides: Partial<ObjectiveGuideManifest> = {}): ObjectiveGuideManifest {
  return {
    schemaVersion: 1,
    domainSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { root: { type: "string" } },
      required: ["root"],
      additionalProperties: false,
    },
    levels: [{ id: "unready", advancement: { checks: ["ready"] } }],
    defaultLanguage: "en-US",
    localizations: {
      "en-US": {
        content: "locales/en-US.yaml",
        references: { source: "references/en-US/" },
      },
      "zh-CN": {
        content: "locales/zh-CN.yaml",
        references: { source: "references/zh-CN/" },
      },
    },
    ...overrides,
  };
}

function content(config: ObjectiveGuideManifest, language: string): unknown {
  return {
    title: `Objective ${language}`,
    description: `Description ${language}`,
    terminal: {
      title: `Ready ${language}`,
      description: `Ready description ${language}`,
    },
    levels: Object.fromEntries(
      config.levels.map(({ id }) => [
        id,
        {
          title: `${id} ${language}`,
          description: `Waiting ${language}`,
          outcome: `Cost and benefit ${language}`,
        },
      ]),
    ),
  };
}

function page(id: string, body = "Reference text [[404]]"): string {
  return `---\nid: ${JSON.stringify(id)}\n---\n# ${id}\n\n${body}\n`;
}

function fixture(
  configs: Readonly<Record<string, ObjectiveGuideManifest>> = {
    [rootUri]: manifest(),
  },
  checks: Readonly<Record<string, Readonly<Record<string, ObjectiveCheck>>>> = {},
): {
  loader: ReturnType<typeof createObjectiveLoader>;
  texts: Map<string, string>;
  pages: Map<string, ObjectivePageResource[]>;
  reads: string[];
} {
  const texts = new Map<string, string>();
  const pages = new Map<string, ObjectivePageResource[]>();
  const reads: string[] = [];

  for (const [uri, config] of Object.entries(configs)) {
    texts.set(uri, JSON.stringify(config));
    for (const [language, locale] of Object.entries(config.localizations)) {
      texts.set(new URL(locale.content, uri).href, JSON.stringify(content(config, language)));
      const sourceUri = new URL(locale.references.source, uri).href;
      pages.set(
        sourceUri,
        ["404", "repair"].map((id) => ({
          uri: new URL(`${id}.md`, sourceUri).href,
          source: page(id),
        })),
      );
    }
  }

  const resources: ObjectiveResourceResolver = {
    async readText(uri) {
      reads.push(uri);
      const source = texts.get(uri);
      if (source === undefined) {
        throw new Error(`Missing text resource: ${uri}`);
      }
      return source;
    },
    async readPages(uri) {
      const resourcesForLocale = pages.get(uri);
      if (resourcesForLocale === undefined) {
        throw new Error(`Missing page resources: ${uri}`);
      }
      return resourcesForLocale;
    },
  };

  const options: ObjectiveLoaderOptions = {
    resources,
    resolveChecks: (uri) =>
      checks[uri] ?? {
        ready: async () => ({ pass: true }),
      },
  };
  return {
    loader: createObjectiveLoader(options),
    texts,
    pages,
    reads,
  };
}

test("loads one language-neutral Guide and creates immutable localized instances", async () => {
  let passing = false;
  const context = fixture(undefined, {
    [rootUri]: {
      ready: async (subject, language) =>
        passing
          ? { pass: true }
          : {
              pass: false,
              problems: [
                {
                  pageId: "repair",
                  description: `${String(subject.root)}/${language} is not ready`,
                },
              ],
            },
    },
  });

  const [first, second] = await Promise.all([
    context.loader.load(rootUri),
    context.loader.load("https://objectives.test/root/./objective-guide.yaml"),
  ]);
  assert.equal(first, second);
  assert.equal(context.reads.filter((uri) => uri === rootUri).length, 1);

  const subject = { root: "project" };
  const created = first.createInstance({ subject, language: "en-US" });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  subject.root = "changed";
  assert.equal(created.instance.subject.root, "project");
  assert.ok(Object.isFrozen(created.instance.subject));
  assert.deepEqual(
    created.instance.describeLevels().map(({ id }) => id),
    ["unready", "terminal"],
  );
  assert.equal(created.instance.describeLevels()[0]?.advancementOutcome, "Cost and benefit en-US");

  const firstObservation = await created.instance.probe();
  assert.equal(firstObservation.current.instance, created.instance);
  assert.equal(firstObservation.current.id, "unready");
  assert.equal(firstObservation.gapSummary, "project/en-US is not ready");
  assert.equal(
    (await created.instance.readPage(firstObservation.problems[0]?.pageId ?? "")).id,
    "repair",
  );
  assert.equal((await created.instance.readPage("missing")).id, "404");
  assert.deepEqual(await created.instance.searchPages("REFERENCE"), [
    { id: "404", title: "404" },
    { id: "repair", title: "repair" },
  ]);

  passing = true;
  assert.equal((await created.instance.probe()).current.id, "terminal");

  const invalid = first.createInstance({ subject: { root: 5 } });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.error.type, "invalid-subject");
  }
  const unsupported = first.createInstance({
    subject: { root: "project" },
    language: "en",
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok && unsupported.error.type === "unsupported-language") {
    assert.deepEqual(unsupported.error.supportedLanguages, ["en-US", "zh-CN"]);
  } else {
    assert.fail("Expected an unsupported-language result.");
  }
});

test("prerequisites project subjects and block local checks until terminal", async () => {
  let childReady = false;
  const calls: string[] = [];
  const root = manifest({
    prerequisite: {
      manifestUri: "../child/objective-guide.yaml",
      subject: '{"root": root}',
    },
    levels: [{ id: "root-unready", advancement: { checks: ["root-ready"] } }],
  });
  const child = manifest({
    levels: [{ id: "child-unready", advancement: { checks: ["child-ready"] } }],
  });
  const context = fixture(
    { [rootUri]: root, [childUri]: child },
    {
      [rootUri]: {
        "root-ready": async () => {
          calls.push("root");
          return { pass: true };
        },
      },
      [childUri]: {
        "child-ready": async (subject) => {
          calls.push(`child:${String(subject.root)}`);
          return childReady
            ? { pass: true }
            : {
                pass: false,
                problems: [{ pageId: "repair", description: "Repair prerequisite" }],
              };
        },
      },
    },
  );

  const guide = await context.loader.load(rootUri);
  const created = guide.createInstance({ subject: { root: "project" } });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  assert.deepEqual(
    created.instance.describeLevels().map(({ id }) => id),
    ["child-unready", "root-unready", "terminal"],
  );
  const blocked = await created.instance.probe();
  assert.equal(blocked.current.instance, created.instance.prerequisite);
  assert.deepEqual(calls, ["child:project"]);

  childReady = true;
  assert.equal((await created.instance.probe()).current.id, "terminal");
  assert.deepEqual(calls, ["child:project", "child:project", "root"]);
});

test("configuration and operation failures remain explicit", async () => {
  const unsafe = manifest({
    prerequisite: {
      manifestUri: childUri,
      subject: "$now()",
    },
  });
  await assert.rejects(
    fixture({ [rootUri]: unsafe, [childUri]: manifest() }).loader.load(rootUri),
    ObjectiveConfigurationError,
  );

  const dangling = fixture();
  for (const [sourceUri, resources] of dangling.pages) {
    dangling.pages.set(
      sourceUri,
      resources.map((resource) => ({
        ...resource,
        source: page(resource.uri.endsWith("404.md") ? "404" : "repair", "[[missing]]"),
      })),
    );
  }
  await assert.rejects(dangling.loader.load(rootUri), /Dangling References link/);

  const malformed = fixture(undefined, {
    [rootUri]: {
      ready: async () => ({
        pass: false,
        problems: [{ pageId: "missing", description: "Unknown page" }],
      }),
    },
  });
  const guide = await malformed.loader.load(rootUri);
  const created = guide.createInstance({ subject: { root: "project" } });
  assert.equal(created.ok, true);
  if (created.ok) {
    await assert.rejects(created.instance.probe(), ObjectiveOperationError);
  }
});

test("default file resources load YAML and nested Markdown pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "potential-guide-"));
  try {
    await mkdir(join(root, "references", "nested"), { recursive: true });
    const manifestPath = join(root, "objective-guide.yaml");
    await writeFile(
      manifestPath,
      `schemaVersion: 1
domainSchema:
  type: object
levels:
  - id: configuration-invalid
    advancement:
      checks: [ready]
defaultLanguage: en-US
localizations:
  en-US:
    content: content.yaml
    references:
      source: references/
`,
    );
    await writeFile(
      join(root, "content.yaml"),
      `title: Repository
description: Repository readiness
terminal:
  title: Ready
  description: The repository is ready.
levels:
  configuration-invalid:
    title: Invalid
    description: Configuration needs repair.
    outcome: Repairing configuration enables repository work.
`,
    );
    await writeFile(
      join(root, "references", "404.md"),
      '---\nid: "404"\n---\n# Not found\n\nNo such page.\n',
    );
    await writeFile(
      join(root, "references", "nested", "repair.md"),
      "---\nid: repair\n---\n# Repair\n\nSee [[404]].\n",
    );

    const loader = createObjectiveLoader({
      checks: {
        ready: async () => ({
          pass: false,
          problems: [{ pageId: "repair", description: "Repair configuration" }],
        }),
      },
    });
    const guide = await loader.load(manifestPath);
    assert.equal(await loader.load(pathToFileURL(manifestPath).href), guide);
    const created = guide.createInstance({ subject: {} });
    assert.equal(created.ok, true);
    if (created.ok) {
      const observation = await created.instance.probe();
      assert.equal(
        (await observation.current.instance.readPage(observation.problems[0]?.pageId ?? "")).title,
        "Repair",
      );
    }

    const pagePath = join(root, "references", "404.md");
    await assert.rejects(fileObjectiveResources.readPages(pathToFileURL(pagePath).href));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
