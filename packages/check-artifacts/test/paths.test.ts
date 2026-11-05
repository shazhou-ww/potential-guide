import assert from "node:assert/strict";
import test from "node:test";
import { safeComponent, safePath } from "../src/paths.js";

test("Check portability uses standard filename rules without sanitizing artifact identity", () => {
  assert.ok(safeComponent("example.json"));
  assert.ok(safePath("resources/example.json"));
  for (const component of [
    "",
    ".",
    "..",
    "CON.txt",
    "a:",
    "a\\b",
    "a/b",
    "a ",
    "a.",
    "a?",
    "x".repeat(256),
  ])
    assert.equal(safeComponent(component), false, component);
  for (const path of [
    "../outside",
    "/absolute",
    "a//b",
    "resources/Node_Modules/a",
    "resources/e\u0301",
  ])
    assert.equal(safePath(path), false, path);
  assert.equal(safeComponent("a\u0085"), false);
});
