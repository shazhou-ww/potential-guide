import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "../../../.staging/objective-pguide-self-check/runtime/setup-check.mjs";

test("self-check rejects remote targets and setup-only consent before starting processes", async () => {
  for (const input of [{ target: { type: "ssh" } }, { allowSanity: true }]) {
    const result = await check("sanity", input, { selfCheck: true, pilot: true });
    assert.equal(result.status, 400);
    assert.equal(result.payload, null);
    assert.match(result.message, /local-only/);
  }
});
