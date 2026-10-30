import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { ContractStore } from "../src/contract-store.js";
import { TaskProtocolError } from "../src/v2-types.js";

test("legacy Host remains HTTPS-only even though direct generic Check accepts file references", () => {
  const store = new ContractStore(["https://example.test", "null"], undefined, async () => {
    assert.fail("Authorization must not acquire an unsupported source.");
  });
  try {
    assert.throws(
      () =>
        store.authorize(
          { kind: "checker", url: pathToFileURL(resolve("missing.tgz")).href },
          "scope",
        ),
      (error: unknown) =>
        error instanceof TaskProtocolError &&
        error.status === 400 &&
        error.detail.code === "invalid_source",
    );
    assert.doesNotThrow(() =>
      store.authorize({ kind: "checker", url: "https://example.test/archive.tgz" }, "scope"),
    );
  } finally {
    store.close();
  }
});
