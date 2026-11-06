import { CliError } from "@potential-guide/cli-core";
import { RegulationError } from "@potential-guide/objective-regulator";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  regulationInputGuidance,
  regulationMarkdown,
} from "../../pguide-regulate/src/commands/regulator.js";
import { root, run, scratch } from "./fixtures.js";

test("nested CliError human input guidance survives regulation wrapping", () => {
  const input = new CliError(
    "Original machine error",
    2,
    "pilot-error",
    undefined,
    "Supported languages: `en-US`.\n\nNext: choose a supported language.",
  );
  const error = new RegulationError(400, "Outer regulation context", {
    cause: new Error("Intermediate context", { cause: input }),
  });
  assert.equal(regulationInputGuidance(error), input.humanMessage);
  assert.equal(error.message, "Outer regulation context");
  assert.equal(error.status, 400);
  assert.equal(input.message, "Original machine error");
  const cycle = new RegulationError(400, "No input guidance");
  cycle.cause = cycle;
  assert.equal(regulationInputGuidance(cycle), undefined);
});

test("regulation quota labels distinguish singular and plural runs", () => {
  const input = {
    regulationId: "fixture-run",
    objectiveId: "fixture-objective",
    targetLevel: "terminal",
    status: "target-reached",
    quota: { timeoutMs: 1000, maxAgentRuns: 1, maxStallRuns: 1 },
    statePath: "state.json",
    recoveryCommand: "pguide continue fixture-run",
  };
  const singular = regulationMarkdown(input);
  assert.match(singular, /1000 ms; 1 Agent run; 1 additional stalled run\./u);
  assert.match(singular, /Objective complete - terminal reached\./u);
  assert.doesNotMatch(singular, /[—–]/u);
  const plural = regulationMarkdown({
    ...input,
    quota: { ...input.quota, maxAgentRuns: 2, maxStallRuns: 2 },
  });
  assert.match(plural, /1000 ms; 2 Agent runs; 2 additional stalled runs\./u);
});

test("retired supervise execution options are rejected without dispatch", async () => {
  const directory = await mkdtemp(join(scratch, "retired-supervise-"));
  try {
    const result = await run(
      join(root, "packages", "pguide", "dist", "bin.js"),
      ["supervise", "--execute", "--duration-ms", "1500", "--format", "json"],
      { ...process.env, PATH: "" },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /Unknown command.*supervise/u);
    await assert.rejects(readdir(join(directory, "state", "regulations")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
