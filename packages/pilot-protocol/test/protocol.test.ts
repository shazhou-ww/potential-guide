import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compileDomain,
  compileInputSchema,
  compileSubjectProjection,
  ObjectiveConfigurationError,
  parseCheckEnvelope,
  parseManifest,
  parseStrictYaml,
  validateSubject,
} from "../src/index.js";

test("definition schemas and subject validation are usable without an execution runtime", async () => {
  const manifest = parseManifest(
    JSON.stringify({
      schemaVersion: 1,
      domainSchema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
      levels: [{ id: "initial", advancement: { checks: [] } }],
      defaultLanguage: "en-US",
      languages: ["en-US"],
    }),
  );
  const domain = compileDomain(manifest.domainSchema);
  assert.equal(domain({ name: "independent" }), true);
  assert.equal(domain({ name: 1 }), false);
  assert.ok(validateSubject({ name: 1 }, domain));
  assert.equal(compileInputSchema({ type: "object" })({}), true);
  const project = compileSubjectProjection('{ "name": input.name }');
  assert.deepEqual(await project({ input: { name: "independent" } }), { name: "independent" });
});

test("strict parsing rejects malformed definitions and check envelopes", () => {
  assert.throws(() => parseStrictYaml("key: 1\nkey: 2\n"), /YAML/);
  assert.throws(() => parseManifest("{}"), ObjectiveConfigurationError);
  const value = { status: 200, payload: { ok: true, problems: [] }, message: "" };
  assert.deepEqual(parseCheckEnvelope(value), value);
  assert.throws(() => parseCheckEnvelope({ ...value, payload: { ok: true, problems: [{}] } }));
});
