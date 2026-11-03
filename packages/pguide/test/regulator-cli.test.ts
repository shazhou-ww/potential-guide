import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { agentPrompt } from "../../pguide-regulate/src/commands/regulator.js";
import { scratch } from "./fixtures.js";

test("Agent prompts contain the subject, target and every problem, not a selected task", () => {
  const prompt = agentPrompt({
    permissions: { ceiling: [], grants: [] },
    binding: { id: "fixture" },
    subject: { name: "subject" },
    target: {
      objectiveId: "git+https://example.invalid/repo.git#objective.yaml",
      levelId: "terminal",
    },
    observation: {
      current: {
        objectiveId: "git+https://example.invalid/repo.git#objective.yaml",
        levelId: "initial",
      },
      problems: ["first", "second"].map((problemId) => ({
        kind: "internal" as const,
        ref: {
          objectiveId: "git+https://example.invalid/repo.git#objective.yaml",
          levelId: "initial",
          checkId: "ready",
          problemId,
        },
        parameters: {},
      })),
      gapSummary: "Both failures",
      observedAt: "2026-01-01T00:00:00.000Z",
      versions: {},
    },
    limits: { timeoutMs: 1234 },
  });
  assert.match(prompt, /first/);
  assert.match(prompt, /second/);
  assert.match(prompt, /"timeoutMs":1234/);
  assert.match(prompt, /"name":"subject"/);
  assert.match(prompt, /Current run authorization: \{"grants":\[\]\}/);
  assert.match(prompt, /request host permission evaluation again/);
  assert.match(prompt, /do not let you self-authorize or bypass protocol permission requests/);
});

test("Agent prompt exposes effective grants without the ungranted administrative ceiling", () => {
  const prompt = agentPrompt({
    binding: { id: "fixture" },
    subject: {},
    target: { objectiveId: "git+file:///fixture.git#objective.yaml", levelId: "terminal" },
    observation: {
      current: { objectiveId: "git+file:///fixture.git#objective.yaml", levelId: "initial" },
      problems: [],
      gapSummary: "",
      observedAt: new Date().toISOString(),
      versions: {},
    },
    limits: { timeoutMs: 1000 },
    permissions: {
      ceiling: [
        { id: "active", operation: "edit", resources: [join(scratch, "active-marker")] },
        { id: "ungranted-private-rule", operation: "execute", command: "private-command" },
      ],
      grants: ["active"],
    },
  });
  assert.match(prompt, /"id":"active"/);
  assert.doesNotMatch(prompt, /ungranted-private-rule|private-command/);
});
