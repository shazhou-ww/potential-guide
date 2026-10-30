import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceImports } from "../src/imports.js";
import { checkSourceImport, type SourceBoundaryContext } from "../src/source-boundaries.js";
import { parsePackageSubject } from "../src/subjects.js";

test("syntax-aware imports ignore comments and ordinary strings, preserve type-only uses", () => {
  assert.deepEqual(
    sourceImports(
      "entry.ts",
      `
    // import "node:fs";
    const description = 'import "private-package/internal"';
    import type { Node } from "node:fs";
    export { value } from "shared";
    import legacy = require("legacy");
    void import("dynamic-literal");
    require("commonjs");
    void import(variable);
  `,
    ),
    [
      { specifier: "node:fs", typeOnly: true },
      { specifier: "shared", typeOnly: false },
      { specifier: "legacy", typeOnly: false },
      { specifier: "dynamic-literal", typeOnly: false },
      { specifier: "commonjs", typeOnly: false },
      { specifier: null, typeOnly: false },
    ],
  );
});
test("computed imports remain unverified without an explicit Node CLI entry and local file-URL shape", async () => {
  const findings: { state: string; rule: string }[] = [];
  const declarations = new Map([["packages/server/src/main.ts", "Operator-owned configuration"]]);
  const context = {
    workspace: {
      path: "packages/server",
      runtime: "node",
      roles: ["cli"],
      entries: ["src/main.ts"],
    },
    localConfigurationImports: declarations,
    put(state: string, rule: string) {
      findings.push({ state, rule });
    },
  } as unknown as SourceBoundaryContext;
  await checkSourceImport(context, "packages/server/src/main.ts", {
    specifier: null,
    typeOnly: false,
    localConfiguration: true,
  });
  assert.deepEqual(findings.pop(), { state: "pass", rule: "local-configuration-import" });
  for (const [source, observation, scopes] of [
    ["packages/server/src/main.ts", { specifier: null, typeOnly: false }, declarations],
    [
      "packages/server/src/http.ts",
      { specifier: null, typeOnly: false, localConfiguration: true },
      declarations,
    ],
    [
      "packages/server/src/main.ts",
      { specifier: null, typeOnly: false, localConfiguration: true },
      new Map(),
    ],
  ] as const) {
    await checkSourceImport({ ...context, localConfigurationImports: scopes }, source, observation);
    assert.deepEqual(findings.pop(), { state: "unverified", rule: "computed-import" });
  }
  const subject = {
    root: process.cwd(),
    directory: "packages/server",
    roles: ["cli"],
    runtime: "node",
    allows: [],
    entries: ["src/main.ts"],
    generated: [],
    joins: [],
    deliveries: [],
    localConfigurationImports: [{ path: "src/main.ts", reason: "Operator-owned configuration" }],
  };
  assert.doesNotThrow(() => parsePackageSubject(subject));
  assert.throws(() => parsePackageSubject({ ...subject, roles: ["npm"] }), /Node CLI/);
  assert.throws(() => parsePackageSubject({ ...subject, runtime: "browser" }), /Node CLI/);
  assert.throws(() => parsePackageSubject({ ...subject, entries: ["src/index.ts"] }), /Node CLI/);
});
test("local configuration recognition requires actual Node path and file-URL imports", () => {
  const prefix = 'import {resolve} from "node:path";import {pathToFileURL} from "node:url";';
  assert.deepEqual(
    sourceImports("entry.ts", `${prefix}void import(pathToFileURL(resolve(input)).href);`).at(-1),
    { specifier: null, typeOnly: false, localConfiguration: true },
  );
  for (const expression of [
    "import(input)",
    "import(new URL(input).href)",
    "import(pathToFileURL(input).href)",
    "require(pathToFileURL(resolve(input)).href)",
  ])
    assert.deepEqual(sourceImports("entry.ts", `${prefix}${expression}`).at(-1), {
      specifier: null,
      typeOnly: false,
    });
  assert.deepEqual(sourceImports("entry.ts", "import(pathToFileURL(resolve(input)).href)").at(-1), {
    specifier: null,
    typeOnly: false,
  });
});
