import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceImports } from "../src/imports.js";

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
