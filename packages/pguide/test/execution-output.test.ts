import { CliError } from "@potential-guide/cli-core";
import type { Envelope, PilotObservation, PilotSpec } from "@potential-guide/objective-pilot";
import { RegulationError } from "@potential-guide/objective-regulator";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { observationMarkdown } from "../../pguide-pilot/src/commands/pilot.js";
import {
  regulationInputGuidance,
  regulationMarkdown,
} from "../../pguide-regulate/src/commands/regulator.js";
import { bin, root, run, scratch } from "./fixtures.js";

test("scaffold receipts and validate scope have default/Markdown parity; --bogus is rejected", async () => {
  const directory = await mkdtemp(join(scratch, "execution-receipt-"));
  try {
    const target = join(directory, "objective");
    const args = ["pilot", target, "--check", "ready"];
    const plain = await run(bin("scaffold"), args);
    assert.equal(plain.code, 0, plain.stderr);
    for (const text of [
      "# Pilot scaffold created",
      "- Action:",
      "- Directory:",
      "- Manifest:",
      "- Languages: `en-US`",
      "- Check: `ready`",
      "pguide validate pilot",
      "Commit source, not generated workers",
    ])
      assert.ok(plain.stdout.includes(text), text);
    await rm(target, { recursive: true });
    const markdown = await run(bin("scaffold"), [...args, "--format", "markdown"]);
    assert.equal(markdown.stdout, plain.stdout);
    const validated = await run(bin("validate"), ["pilot", target]);
    const explicit = await run(bin("validate"), ["pilot", target, "--format", "markdown"]);
    assert.equal(validated.code, 0, validated.stderr);
    assert.equal(validated.stdout, explicit.stdout);
    assert.match(validated.stdout, /^# Pilot validation\n/u);
    assert.match(validated.stdout, /checks were not executed/u);
    const json = await run(bin("validate"), ["pilot", target, "--format", "json"]);
    assert.deepEqual(Object.keys(JSON.parse(json.stdout)).sort(), [
      "objectiveId",
      "schemaVersion",
      "status",
    ]);
    assert.equal(JSON.parse(json.stdout).status, "valid");
    for (const script of [bin("validate"), join(root, "packages", "pguide", "dist", "bin.js")]) {
      const prefix = script === bin("validate") ? [] : ["validate"];
      const rejected = await run(
        script,
        [...prefix, "pilot", target, "--bogus", "--format", "json", "--cwd", directory],
        { ...process.env, PATH: "" },
      );
      assert.equal(rejected.code, 2, rejected.stdout + rejected.stderr);
      assert.equal(rejected.stderr, "");
      const failure = JSON.parse(rejected.stdout);
      assert.equal(failure.status, "invalid");
      assert.match(failure.error, /Unknown option: --bogus/u);
      assert.equal(failure.objectiveId, undefined);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

test("renderers escape Markdown and never display dependency subjects or transcript bodies", () => {
  const objectiveId = "git+file:///fixture#objective/";
  const spec: PilotSpec = {
    objectiveId,
    version: "a".repeat(40),
    manifest: {
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
      subjectSchema: { type: "object" },
      levels: [{ id: "ready", checks: [] }],
      defaultLanguage: "en-US",
      languages: ["en-US"],
    },
    locales: { "en-US": {} },
  };
  const observation: Envelope<PilotObservation> = {
    status: 200,
    message: "",
    payload: {
      current: { objectiveId, levelId: "initial" },
      problems: [
        {
          kind: "dependency",
          objectiveId: "dependency`name",
          subject: { secret: "PRIVATE_SUBJECT" },
          currentLevelId: "initial",
          expectedLevelId: "terminal",
        },
      ],
      gapSummary: "PRIVATE_SUBJECT",
      observedAt: "2026-01-01",
      versions: { [objectiveId]: spec.version },
    },
  };
  const probe = observationMarkdown(observation, spec);
  assert.match(probe, /``dependency`name``/u);
  assert.doesNotMatch(probe, /PRIVATE_SUBJECT/u);
});
