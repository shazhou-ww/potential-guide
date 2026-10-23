import assert from "node:assert/strict";
import { test } from "node:test";
import type { PilotSpec } from "@potential-guide/objective-pilot";
import { RequestModel } from "../src/index.js";

function spec(commit = "a".repeat(40), directory = "rules"): PilotSpec {
  return {
    objectiveId: `git+https://example.test/rules.git#${directory}/`,
    version: "1".repeat(40),
    source: {
      kind: "git-tree",
      repository: "https://example.test/rules.git",
      directory,
      commit,
      tree: "1".repeat(40),
      repositoryTree: "2".repeat(40),
    },
    manifest: {
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
      subjectSchema: { type: "object", additionalProperties: true },
      levels: [
        { id: "available", checks: [] },
        { id: "ready", checks: [] },
      ],
      defaultLanguage: "en",
      languages: ["en"],
    },
    locales: {
      en: {
        "system/404": {
          id: "system/404",
          title: "Missing",
          description: "",
          references: [],
          content: "",
        },
      },
    },
  };
}

function command(
  requestRef: string,
  changes: Partial<RequestModel.RequestCommand> = {},
): RequestModel.RequestCommand {
  return {
    type: "request",
    requestRef,
    objective: spec(),
    subject: {},
    desiredLevel: "ready",
    priority: 1,
    origin: { kind: "external" },
    ...changes,
  };
}

test("definition upgrades preserve Objective and Target but pin distinct immutable revisions", () => {
  const empty = RequestModel.createRegulationRequests();
  const first = RequestModel.reduceRegulationRequests(command("request-1"), empty);
  const second = RequestModel.reduceRegulationRequests(
    command("request-2", { objective: spec("b".repeat(40)) }),
    first,
  );
  assert.equal(empty.requests.length, 0);
  assert.equal(first.requests.length, 1);
  assert.equal(second.objectives.length, 1);
  assert.equal(second.targets.length, 1);
  assert.equal(second.objectiveRevisions.length, 2);
  assert.equal(second.requests.length, 2);
  assert.equal(
    RequestModel.requestDetails(second, "request-1").objectiveRevision.commit,
    "a".repeat(40),
  );
  assert.equal(
    RequestModel.requestDetails(second, "request-2").objectiveRevision.commit,
    "b".repeat(40),
  );
});

test("request identity is caller supplied and independent of execution Host", () => {
  const message = command("shared-request");
  const hostA = RequestModel.reduceRegulationRequests(
    message,
    RequestModel.createRegulationRequests(),
  );
  const hostB = RequestModel.reduceRegulationRequests(
    message,
    RequestModel.createRegulationRequests(),
  );
  assert.deepEqual(hostA, hostB);
  assert.strictEqual(RequestModel.reduceRegulationRequests(message, hostA), hostA);
  const another = RequestModel.reduceRegulationRequests(command("same-value-new-request"), hostA);
  assert.equal(another.requests.length, 2);
  assert.equal(another.revision, 2);
  assert.throws(
    () => RequestModel.reduceRegulationRequests(command("shared-request", { priority: 2 }), hostA),
    /Conflicting immutable request/,
  );
});

test("keys use canonical subject properties and distinguish subject and source identities", () => {
  const first = RequestModel.reduceRegulationRequests(
    command("one", { subject: { b: 2, a: 1 } }),
    RequestModel.createRegulationRequests(),
  );
  const second = RequestModel.reduceRegulationRequests(
    command("two", { subject: { a: 1, b: 2 } }),
    first,
  );
  assert.equal(second.targets.length, 1);
  const third = RequestModel.reduceRegulationRequests(
    command("three", { subject: { a: 3, b: 2 } }),
    second,
  );
  assert.equal(third.targets.length, 2);
  const fourth = RequestModel.reduceRegulationRequests(
    command("four", { objective: spec("a".repeat(40), "another-objective") }),
    third,
  );
  assert.equal(fourth.objectives.length, 2);
  assert.equal(fourth.targets.length, 3);
});

test("dependency requests require an existing immutable consumer, without allocating identities", () => {
  const provider = command("provider", {
    origin: { kind: "dependency", consumerRequestRef: "consumer" },
  });
  assert.throws(
    () => RequestModel.reduceRegulationRequests(provider, RequestModel.createRegulationRequests()),
    /existing consumer/,
  );
  const state = RequestModel.reduceRegulationRequests(
    command("consumer"),
    RequestModel.createRegulationRequests(),
  );
  const result = RequestModel.reduceRegulationRequests(provider, state);
  assert.deepEqual(RequestModel.requestDetails(result, "provider").request.origin, provider.origin);
  assert.equal(result.requests.length, 2);
});

test("initial and terminal are validated without executing business checks", () => {
  const initial = RequestModel.reduceRegulationRequests(
    command("initial", { desiredLevel: "initial" }),
    RequestModel.createRegulationRequests(),
  );
  assert.equal(RequestModel.requestDetails(initial, "initial").request.desiredLevel, "initial");
  const terminal = RequestModel.reduceRegulationRequests(
    command("terminal", { desiredLevel: "terminal" }),
    initial,
  );
  assert.equal(RequestModel.requestDetails(terminal, "terminal").request.desiredLevel, "ready");
  assert.throws(() =>
    RequestModel.reduceRegulationRequests(command("bad", { desiredLevel: "missing" }), terminal),
  );
});

test("replay and JSON restore rebuild the same frozen facts without changing inputs", () => {
  const commands = [
    command("one"),
    command("two", { objective: spec("b".repeat(40)), subject: { repository: "example" } }),
    command("three", { origin: { kind: "dependency", consumerRequestRef: "one" } }),
  ];
  const before = JSON.stringify(commands);
  const replay = () =>
    commands.reduce(
      (state, value) => RequestModel.reduceRegulationRequests(value, state),
      RequestModel.createRegulationRequests(),
    );
  const state = replay();
  assert.deepEqual(state, replay());
  const restored = RequestModel.restoreRegulationRequests(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  assert.ok(Object.isFrozen(restored));
  assert.ok(Object.isFrozen(restored.objectiveRevisions[0]?.spec.manifest));
  assert.equal(JSON.stringify(commands), before);
  assert.ok(!Object.isFrozen(commands[0]?.objective));
});

test("restore rejects tampering, duplicate identities, dangling and cross-objective references", () => {
  const state = RequestModel.reduceRegulationRequests(
    command("two", { objective: spec("b".repeat(40), "second") }),
    RequestModel.reduceRegulationRequests(command("one"), RequestModel.createRegulationRequests()),
  );
  const changes = [
    (value: Record<string, unknown>) => {
      value.revision = 99;
    },
    (value: Record<string, unknown>) => {
      value.schemaVersion = 2;
    },
    (value: Record<string, unknown>) => {
      value.extra = true;
    },
    (value: Record<string, unknown>) => {
      value.objectives = [];
    },
    (value: Record<string, unknown>) => {
      value.targets = [];
    },
    (value: Record<string, unknown>) => {
      value.requests = [...state.requests, state.requests[0]];
    },
    (value: Record<string, unknown>) => {
      value.requests = [
        { ...state.requests[0], objectiveRevisionKey: state.requests[1]?.objectiveRevisionKey },
        state.requests[1],
      ];
    },
  ];
  for (const change of changes) {
    const value: Record<string, unknown> = JSON.parse(JSON.stringify(state));
    change(value);
    assert.throws(() => RequestModel.restoreRegulationRequests(value));
  }
  for (const value of [null, [], {}, { schemaVersion: 1 }, { ...state, requests: [null] }])
    assert.throws(() => RequestModel.restoreRegulationRequests(value));
});

test("invalid commands and conflicting revision contents fail without mutating state", () => {
  const state = RequestModel.reduceRegulationRequests(
    command("one"),
    RequestModel.createRegulationRequests(),
  );
  const before = JSON.stringify(state);
  for (const changes of [
    { requestRef: "" },
    { priority: -1 },
    { priority: Number.NaN },
    { priority: 0.5 },
    { desiredLevel: "" },
  ])
    assert.throws(() => RequestModel.reduceRegulationRequests(command("invalid", changes), state));
  const originalSpec = spec();
  const changedSpec: PilotSpec = {
    ...originalSpec,
    locales: {
      ...originalSpec.locales,
      en: {
        ...originalSpec.locales.en,
        changed: { id: "changed", title: "Changed", description: "", references: [], content: "" },
      },
    },
  };
  assert.throws(
    () => RequestModel.reduceRegulationRequests(command("two", { objective: changedSpec }), state),
    /Conflicting immutable record/,
  );
  assert.throws(
    () =>
      RequestModel.reduceRegulationRequests(command("overflow"), {
        ...state,
        revision: Number.MAX_SAFE_INTEGER,
      }),
    /exhausted/,
  );
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => RequestModel.requestDetails(state, "missing"), /Unknown request/);
});
