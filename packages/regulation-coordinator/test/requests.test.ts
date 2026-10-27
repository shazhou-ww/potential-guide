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

test("timing, recurrence lineage and explicit replacement remain immutable through replay", () => {
  const first = command("root", {
    eligibleAt: "2026-10-27T00:00:00Z",
    recurrence: { intervalMs: 100 },
  });
  let state = RequestModel.reduceRegulationRequests(first, RequestModel.createRegulationRequests());
  const successor = command("successor", {
    eligibleAt: "2026-10-27T00:00:00.100Z",
    recurrence: { intervalMs: 100 },
    origin: { kind: "recurrence", predecessorRequestRef: "root" },
  });
  state = RequestModel.reduceRegulationRequests(successor, state);
  assert.equal(RequestModel.recurrenceRoot(state, "successor"), "root");
  assert.equal(RequestModel.reduceRegulationRequests(successor, state), state);
  assert.deepEqual(RequestModel.commandForRequest(state, "root"), first);
  assert.deepEqual(
    RequestModel.restoreRegulationRequests(JSON.parse(JSON.stringify(state))),
    state,
  );
  assert.throws(
    () => RequestModel.reduceRegulationRequests({ ...successor, requestRef: "duplicate" }, state),
    /duplicate/,
  );
  assert.throws(
    () =>
      RequestModel.reduceRegulationRequests(
        { ...first, eligibleAt: "2026-10-27T00:00:00.100Z" },
        state,
      ),
    /Conflicting/,
  );
  assert.throws(
    () =>
      RequestModel.reduceRegulationRequests(
        command("other-target", {
          subject: { other: true },
          eligibleAt: "2026-10-27T00:00:00Z",
          replacesRequestRef: "root",
        }),
        state,
      ),
    /same Target/,
  );
});

test("invalid schedules cannot create recurring initial or dependency obligations", () => {
  const state = RequestModel.reduceRegulationRequests(
    command("consumer"),
    RequestModel.createRegulationRequests(),
  );
  for (const changes of [
    { eligibleAt: "tomorrow" },
    { recurrence: { intervalMs: 10 } },
    { eligibleAt: "2026-10-27T00:00:00Z", recurrence: { intervalMs: 0 } },
    {
      eligibleAt: "2026-10-27T00:00:00Z",
      recurrence: { intervalMs: 10 },
      desiredLevel: "initial",
    },
    {
      eligibleAt: "2026-10-27T00:00:00Z",
      recurrence: { intervalMs: 10 },
      origin: { kind: "dependency" as const, consumerRequestRef: "consumer" },
    },
    { replacesRequestRef: "consumer" },
  ])
    assert.throws(() => RequestModel.reduceRegulationRequests(command("bad", changes), state));
});

test("npm revisions bind package name and content digest through replay without a Git commit", () => {
  const packageSpec = (digest: string): PilotSpec => ({
    ...spec(),
    objectiveId: "@fixture/objective",
    version: `sha256-pguide-package-v1:${digest.repeat(64)}`,
    source: {
      kind: "npm-package",
      packageName: "@fixture/objective",
      packageDigest: `sha256-pguide-package-v1:${digest.repeat(64)}`,
      spec: "alias@npm:@fixture/objective@^1",
      resolved: "https://registry.example.test/objective-1.0.0.tgz",
      version: "1.0.0",
      integrity: "sha512-fixture",
    },
  });
  let state = RequestModel.createRegulationRequests();
  state = RequestModel.reduceRegulationRequests(
    command("npm-one", { objective: packageSpec("a") }),
    state,
  );
  state = RequestModel.reduceRegulationRequests(
    command("npm-two", { objective: packageSpec("b") }),
    state,
  );
  assert.equal(state.objectives.length, 1);
  assert.equal(state.targets.length, 1);
  assert.equal(state.objectiveRevisions.length, 2);
  assert.deepEqual(state.objectives[0]?.source, { packageName: "@fixture/objective" });
  assert.equal(
    RequestModel.requestDetails(state, "npm-one").objectiveRevision.packageDigest,
    packageSpec("a").version,
  );
  assert.equal(RequestModel.requestDetails(state, "npm-one").objectiveRevision.commit, undefined);
  assert.deepEqual(
    RequestModel.restoreRegulationRequests(JSON.parse(JSON.stringify(state))),
    state,
  );
  const tampered = JSON.parse(JSON.stringify(state));
  tampered.objectiveRevisions[0].packageDigest = packageSpec("b").version;
  assert.throws(
    () => RequestModel.restoreRegulationRequests(tampered),
    /snapshot|canonical|replay|mismatch|Invalid/i,
  );
});

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

test("npm aliases preserve distinct request provenance without inventing another Objective revision", () => {
  const packageDigest = `sha256-pguide-package-v1:${"c".repeat(64)}`;
  const source = {
    kind: "npm-package" as const,
    packageName: "@fixture/aliased-objective",
    packageDigest,
    version: "1.0.0",
    resolved: "https://registry.example.test/objective-1.0.0.tgz",
    integrity: "sha512-fixture",
    spec: "first@npm:@fixture/aliased-objective@^1",
  };
  const objective: PilotSpec = {
    ...spec(),
    objectiveId: source.packageName,
    version: packageDigest,
    source,
  };
  let state = RequestModel.reduceRegulationRequests(
    command("alias-first", { objective }),
    RequestModel.createRegulationRequests(),
  );
  const secondSource = { ...source, spec: "second@npm:@fixture/aliased-objective@1.0.0" };
  state = RequestModel.reduceRegulationRequests(
    command("alias-second", {
      objective: { ...objective, source: secondSource },
    }),
    state,
  );
  assert.equal(state.objectives.length, 1);
  assert.equal(state.objectiveRevisions.length, 1);
  assert.equal(state.requests.length, 2);
  assert.equal(
    RequestModel.requestDetails(state, "alias-first").objectiveRevision.spec.source?.kind,
    "npm-package",
  );
  assert.deepEqual(
    RequestModel.commandForRequest(state, "alias-second").objective.source,
    secondSource,
  );
  assert.deepEqual(
    RequestModel.restoreRegulationRequests(JSON.parse(JSON.stringify(state))),
    state,
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
