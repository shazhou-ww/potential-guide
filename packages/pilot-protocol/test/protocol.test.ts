import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compileDomain,
  compileInputSchema,
  compileSubjectProjection,
  bindObjective,
  ObjectiveConfigurationError,
  parseCheckEnvelope,
  parseManifest,
  parseObjectives,
  parseStrictYaml,
  projectObjective,
  validateSubject,
} from "../src/index.js";

test("definition schemas and subject validation are usable without an execution runtime", async () => {
  const manifest = parseManifest(
    JSON.stringify({
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
      subjectSchema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
      levels: [{ id: "ready", checks: [] }],
      defaultLanguage: "en-US",
      languages: ["en-US"],
    }),
  );
  const domain = compileDomain(manifest.subjectSchema);
  assert.equal(domain({ name: "independent" }), true);
  assert.equal(domain({ name: 1 }), false);
  assert.ok(validateSubject({ name: 1 }, domain));
  assert.equal(compileInputSchema({ type: "object" })({}), true);
  const project = compileSubjectProjection('{ "name": input.name }');
  assert.deepEqual(await project({ input: { name: "independent" } }), { name: "independent" });
});

test("package-owned declaration parsing and binding remain independently consumable protocol", () => {
  const declarations = parseObjectives(
    JSON.stringify({
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json",
      objectives: {
        standardize: {
          description: "Package-owned standardization",
          objective: "git+https://example.test/rules.git#package-standard/",
          inputSchema: { type: "object", additionalProperties: false, maxProperties: 0 },
          subject: '{"directory": context.path}',
        },
      },
    }),
  );
  const entry = declarations.standardize;
  assert.ok(entry);
  const context = { repo: null, path: "D:\\fixture" };
  assert.deepEqual(projectObjective(entry, context, undefined), { directory: "D:\\fixture" });
  const manifest = parseManifest(
    JSON.stringify({
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
      subjectSchema: {
        type: "object",
        required: ["directory"],
        properties: { directory: { type: "string" } },
      },
      levels: [{ id: "ready", checks: [] }],
      defaultLanguage: "en-US",
      languages: ["en-US"],
    }),
  );
  assert.deepEqual(
    bindObjective(entry, context, undefined, {
      objectiveId: "git+https://example.test/rules.git#package-standard/",
      version: "fixture",
      manifest,
      locales: {},
    }),
    { directory: "D:\\fixture" },
  );
  assert.throws(
    () => projectObjective(entry, context, { unexpected: true }),
    /Invalid Objective input/,
  );
});

test("strict parsing rejects malformed definitions and check envelopes", () => {
  assert.throws(() => parseStrictYaml("key: 1\nkey: 2\n"), /YAML/);
  assert.throws(() => parseManifest("{}"), ObjectiveConfigurationError);
  const value = { status: 200, payload: { ok: true, problems: [] }, message: "" };
  assert.deepEqual(parseCheckEnvelope(value), value);
  assert.throws(() => parseCheckEnvelope({ ...value, payload: { ok: true, problems: [{}] } }));
});
