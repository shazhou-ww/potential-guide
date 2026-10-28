import assert from "node:assert/strict";
import test from "node:test";
import { isJson } from "../dist/json.js";

test("finite JSON preserves plain data without invoking accessors or coercing values", () => {
  const shared = { value: 1 };
  assert.equal(isJson({ a: shared, b: shared, values: [null, true, "1", 1] }), true);
  assert.equal(isJson(Object.assign(Object.create(null), { value: 1 })), true);
  const cycle: Record<string, unknown> = {};
  cycle.child = cycle;
  for (const value of [NaN, Infinity, undefined, () => {}, new Date(), new Map(), cycle])
    assert.equal(isJson(value), false);
  let invoked = false;
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      invoked = true;
      return 1;
    },
  });
  assert.equal(isJson(accessor), false);
  assert.equal(invoked, false);
  const sparse = [1, 2];
  delete sparse[0];
  Object.defineProperty(sparse, "note", { value: 3, enumerable: true });
  assert.equal(isJson(sparse), false);
  assert.equal(isJson({ [Symbol("hidden")]: 1 }), false);
  let deep: unknown = null;
  for (let index = 0; index < 64; index++) deep = { value: deep };
  assert.equal(isJson(deep), true);
  assert.equal(isJson({ value: deep }), false);
});
