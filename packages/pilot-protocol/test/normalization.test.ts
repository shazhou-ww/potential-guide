import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canonicalObjectiveUri,
  compileInputSchema,
  compileSubjectProjection,
  migrateLegacyObjectiveDocument,
  migrateSubjectExpression,
  OBJECTIVE_SCHEMA_URI,
  OBJECTIVES_SCHEMA_URI,
  parseManifest,
  parseObjectives,
  projectObjective,
  SUBJECT_PROJECTION_LIMITS,
  validateObjectiveDocument,
  validateObjectivesDocument,
} from "../src/index.js";
import { migrateFiles } from "../src/migrate-cli.js";

const context = { repo: { rootPath: "root", origin: null }, path: "." };
const entry = { description: "test", objective: "./rules", subject: '{"value":input}' };
const legacyManifest = {
  schemaVersion: 1,
  domainSchema: { type: "object", properties: { value: { type: "string" } } },
  levels: [{ id: "initial", advancement: { checks: [{ id: "ready", problems: ["missing"] }] } }],
  defaultLanguage: "en-US",
  languages: ["en-US"],
};

test("attainment migration requires reviewed IDs and never silently reinterprets v1 or terminal targets", () => {
  const old = {
    $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json",
    subjectSchema: legacyManifest.domainSchema,
    levels: [{ id: "initial", checks: [{ id: "ready", problems: ["missing"] }] }],
    defaultLanguage: "en-US",
    languages: ["en-US"],
  };
  assert.throws(() => parseManifest(JSON.stringify(old)), /Migrate/);
  assert.throws(() => migrateLegacyObjectiveDocument(old, "manifest"), /attainment-levels/);
  const migrated = migrateLegacyObjectiveDocument(old, "manifest", { attainmentLevels: ["ready"] });
  assert.deepEqual(parseManifest(JSON.stringify(migrated)).levels, [
    { id: "ready", checks: [{ id: "ready", problems: ["missing"] }] },
  ]);
  assert.equal(old.levels[0]?.id, "initial");
  for (const id of ["initial", "terminal"])
    assert.throws(() =>
      migrateLegacyObjectiveDocument(old, "manifest", { attainmentLevels: [id] }),
    );
  assert.throws(
    () =>
      migrateLegacyObjectiveDocument(
        {
          schemaVersion: 3,
          goals: [{ targetLevel: "terminal" }],
          resources: [],
        },
        "portfolio",
      ),
    /explicit review/,
  );
});

test("omitted schema normalizes to Unit; explicit empty schema never implies omitted input", () => {
  const source = (declaration: unknown) =>
    JSON.stringify({ $schema: OBJECTIVES_SCHEMA_URI, objectives: { test: declaration } });
  const parsed = parseObjectives(source(entry)).test;
  assert.ok(parsed);
  assert.deepEqual(parsed.inputSchema, { const: {} });
  assert.deepEqual(projectObjective(parsed, context, undefined), { value: {} });
  assert.throws(() => projectObjective(parsed, context, null), /Invalid Objective input/);
  for (const inputSchema of [{}, true]) {
    const explicit = parseObjectives(source({ ...entry, inputSchema })).test;
    assert.ok(explicit);
    assert.throws(() => projectObjective(explicit, context, undefined), /Only Unit/);
    for (const value of [null, "a", 3, [], { a: 1 }])
      assert.deepEqual(projectObjective(explicit, context, value), { value });
  }
  const never = { ...entry, inputSchema: false };
  assert.throws(() => projectObjective(never, context, {}), /Invalid Objective input/);
  assert.throws(() => projectObjective(never, context, undefined), /Only Unit/);
  assert.deepEqual(projectObjective({ ...entry, inputSchema: { const: {} } }, context, undefined), {
    value: {},
  });
  assert.throws(
    () => projectObjective({ ...entry, inputSchema: { const: {} } }, context, null),
    /Invalid Objective input/,
  );
});

test("pathJoin is only the bounded host join operation, with exactly two strings", () => {
  const project = compileSubjectProjection('{"value": $pathJoin(input.root, input.path)}', {
    requireDefined: true,
  });
  for (const [root, path] of [
    ["root", "."],
    ["root", "../outside"],
    ["", ""],
    ["root", "/absolute"],
    ["C:\\root", "..\\outside"],
    ["\\\\server\\share", "child"],
    ["/root", "a/../b"],
  ])
    assert.deepEqual(project({ input: { root: root ?? "", path: path ?? "" } }), {
      value: join(root ?? "", path ?? ""),
    });
  assert.equal(win32.join("C:\\root", "..\\outside"), "C:\\outside");
  assert.equal(posix.join("/root", "../outside"), "/outside");
  for (const expression of [
    "$pathJoin()",
    "$pathJoin('a')",
    "$pathJoin('a','b','c')",
    "$eval('1')",
    "$now()",
    "$join(['a','b'])",
    "$pathJoin.path",
    "$pathJoin ~> $eval()",
    "$pathJoin('a', $env('SECRET'))",
  ])
    assert.throws(() => compileSubjectProjection(expression));
  for (const expression of [
    "$pathJoin(null, 'a')",
    "$pathJoin('a', 1)",
    "$pathJoin([], 'a')",
    "$pathJoin({}, 'a')",
  ])
    assert.throws(() => compileSubjectProjection(expression)({}), /two strings/);
  assert.throws(() => project({ input: { root: "a" } }), /Missing projection/);
  assert.throws(
    () =>
      project({ input: { root: "a", path: "x".repeat(SUBJECT_PROJECTION_LIMITS.outputBytes) } }),
    /bounded/,
  );
});

test("context is exact, non-Git context.path works, and null repo field reads fail", () => {
  const declaration = { ...entry, subject: '{"path":context.path}' };
  assert.deepEqual(projectObjective(declaration, { repo: null, path: "/plain" }, undefined), {
    path: "/plain",
  });
  assert.throws(
    () =>
      projectObjective(
        { ...entry, subject: '{"path":context.repo.rootPath}' },
        { repo: null, path: "/plain" },
        undefined,
      ),
    /Missing projection/,
  );
  for (const invalid of [
    { directory: { absolutePath: "/plain" } },
    { ...context, checkout: {} },
    { repo: { rootPath: "/root", origin: null, id: "opaque" }, path: "." },
  ])
    assert.throws(() => projectObjective(declaration, invalid, undefined), /exactly/);
});

test("canonical documents reject legacy and unknown fields and schemas compile offline", () => {
  const migrated = migrateLegacyObjectiveDocument(legacyManifest, "manifest", {
    attainmentLevels: ["ready"],
  });
  assert.ok(validateObjectiveDocument(migrated));
  assert.equal(parseManifest(JSON.stringify(migrated)).$schema, OBJECTIVE_SCHEMA_URI);
  for (const value of [
    legacyManifest,
    { ...(migrated as object), domainSchema: {} },
    { ...(migrated as object), $schema: "https://unknown.test/schema" },
  ])
    assert.throws(() => parseManifest(JSON.stringify(value)), /Migrate|Expected/);
  for (const path of ["pilot.yaml", "objective.yaml"])
    assert.throws(
      () => canonicalObjectiveUri(`git+https://example.test/repo.git#rules/${path}`),
      /directory/,
    );
  assert.equal(
    validateObjectivesDocument({ $schema: OBJECTIVES_SCHEMA_URI, objectives: { test: entry } }),
    true,
  );
  assert.equal(
    validateObjectivesDocument({
      $schema: OBJECTIVES_SCHEMA_URI,
      objectives: { test: { ...entry, pilot: "./old" } },
    }),
    false,
  );
  assert.equal(
    compileInputSchema({ const: { $ref: "literal business data" } })({
      $ref: "literal business data",
    }),
    true,
  );
  assert.equal(
    compileInputSchema({
      $defs: { value: { type: "string" } },
      type: "object",
      properties: { value: { $ref: "#/$defs/value" } },
    })({ value: "ok" }),
    true,
  );
  assert.throws(
    () =>
      compileInputSchema({
        type: "object",
        properties: { value: { $ref: "https://unavailable.test/schema" } },
      }),
    /local/,
  );
  assert.throws(
    () => compileInputSchema(JSON.parse('{"$async":true,"type":"object"}')),
    /Asynchronous/,
  );
  const mutable = { const: { value: "original" } };
  const compiled = compileInputSchema(mutable);
  mutable.const.value = "changed";
  assert.equal(compiled({ value: "original" }), true);
  assert.equal(compileInputSchema({ const: { value: "original" } })({ value: "changed" }), false);
});

test("migration changes AST paths, never text literals, and refuses unknown or unrepresentable data", () => {
  const expression =
    '{"literal":"context.checkout.rootPath","root":context.checkout.rootPath,"path":context.directory.relativePath,"absolute":context.directory.absolutePath}';
  const migrated = migrateSubjectExpression(expression, { contextKind: "git" });
  assert.deepEqual(compileSubjectProjection(migrated)({ context }), {
    literal: "context.checkout.rootPath",
    root: "root",
    path: ".",
    absolute: join("root", "."),
  });
  assert.equal(
    migrateSubjectExpression('{"path":context.directory.absolutePath}', { contextKind: "non-git" }),
    '{"path":context.path}',
  );
  for (const expression of [
    "context",
    "context.repository.id",
    "context.checkout.id",
    "$",
    "$eval('1')",
  ])
    assert.throws(
      () => migrateSubjectExpression(expression, { contextKind: "git" }),
      /Migration refused/,
    );
  assert.throws(() => migrateSubjectExpression("context.directory.absolutePath"), /context-kind/);
  assert.throws(
    () => migrateLegacyObjectiveDocument({ ...legacyManifest, unknown: true }, "manifest"),
    /Expected fields/,
  );
  const declarations = {
    schemaVersion: 1,
    objectives: {
      test: {
        description: "test",
        pilot: "./rules",
        inputSchema: { const: {} },
        subject: "context.checkout.id",
      },
    },
  };
  assert.throws(
    () => migrateLegacyObjectiveDocument(declarations, "declarations", { contextKind: "git" }),
    /opaque/,
  );
  assert.ok(
    validateObjectivesDocument(
      migrateLegacyObjectiveDocument(declarations, "declarations", {
        subjects: { test: '{"reviewed":"identity-policy-v2"}' },
      }),
    ),
  );
  assert.throws(
    () =>
      migrateLegacyObjectiveDocument(
        {
          schemaVersion: 3,
          goals: [
            {
              id: "a",
              pilot: "./rules",
              revision: "a".repeat(40),
              subject: {},
              targetLevel: "terminal",
              priority: 1,
              observationIntervalMs: 100,
            },
          ],
          resources: [],
        },
        "portfolio",
      ),
    /pinned/,
  );
});

test("file migration never overwrites input, existing output, or damaged/unknown documents", async (t) => {
  const base = new URL("../../../.cache/", import.meta.url);
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(new URL("objective-migration-", base)));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, "pilot.yaml");
  const output = join(directory, "objective.yaml");
  const source = JSON.stringify(legacyManifest);
  await writeFile(input, source);
  const args = [
    "--format",
    "manifest",
    "--input",
    input,
    "--output",
    output,
    "--attainment-levels",
    "ready",
  ];
  await migrateFiles(args);
  assert.equal(await readFile(input, "utf8"), source);
  assert.equal(parseManifest(await readFile(output, "utf8")).$schema, OBJECTIVE_SCHEMA_URI);
  await assert.rejects(migrateFiles(args), /EEXIST/);
  await assert.rejects(
    migrateFiles(["--format", "manifest", "--input", input, "--output", input]),
    /never overwrites/,
  );
  await writeFile(input, JSON.stringify({ ...legacyManifest, unknown: "preserve me" }));
  const untouched = await readFile(output, "utf8");
  await assert.rejects(migrateFiles(args), /Expected fields/);
  assert.equal(await readFile(output, "utf8"), untouched);
});
