import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "@potential-guide/effects";
import { ObjectiveConfigurationError, ObjectiveInputError } from "@potential-guide/pilot-protocol";
import { observe, type PilotRuntime } from "../src/index.js";
import { fixture, objectiveId } from "./fixtures.js";

test("subject input errors carry typed issues without changing the existing message", async () => {
  const spec = await fixture().load();
  const runtime: PilotRuntime = {
    resolveCheck: () => {
      throw new Error("Invalid subjects must not execute checks.");
    },
  };
  await assert.rejects(Effect.runPromise(observe({ spec, subject: {} }, runtime)), (error) => {
    assert.ok(error instanceof ObjectiveInputError);
    assert.ok(error instanceof ObjectiveConfigurationError);
    assert.equal(error.details.kind, "subject");
    assert.equal(error.details.objectiveId, objectiveId);
    assert.ok(error.details.kind === "subject" && error.details.issues !== null);
    assert.equal(error.details.issues[0].keyword, "required");
    assert.equal(
      error.message,
      `Invalid subject for ${objectiveId}: ${JSON.stringify(error.details.issues)}.`,
    );
    return true;
  });
});

test("unsupported language errors retain the requested and available locales", async () => {
  const spec = await fixture().load();
  const runtime: PilotRuntime = {
    resolveCheck: () => {
      throw new Error("Unsupported languages must not execute checks.");
    },
  };
  await assert.rejects(
    Effect.runPromise(observe({ spec, subject: { name: "fixture" }, language: "fr-FR" }, runtime)),
    (error) => {
      assert.ok(error instanceof ObjectiveInputError);
      assert.deepEqual(error.details, {
        kind: "language",
        objectiveId,
        requested: "fr-FR",
        supported: ["en-US", "zh-CN"],
      });
      assert.equal(error.message, `Unsupported language fr-FR for ${objectiveId}.`);
      return true;
    },
  );
});
