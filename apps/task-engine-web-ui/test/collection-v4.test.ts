import assert from "node:assert/strict";
import test from "node:test";
import type { CollectionEnvelope, PublicEvent, TaskSummary } from "@potential-guide/task-protocol";
import {
  CollectionReplica,
  consumeCollectionSse,
  Directory,
  EventWindow,
  newIdentity,
} from "../src/model.js";

const now = new Date().toISOString();
function row(): TaskSummary {
  const taskId = newIdentity();
  return {
    taskId,
    requestId: newIdentity(),
    seriesId: taskId,
    type: "echo",
    version: "1",
    scope: "scope",
    stage: "initial",
    canceled: false,
    receivedAt: now,
    updatedAt: now,
    eligibleAt: now,
    deadlineAt: new Date(Date.now() + 10000).toISOString(),
    state: {
      stage: "initial",
      canceled: false,
      pending: false,
      timedOut: false,
      completed: false,
      runFailed: false,
    },
  };
}
test("one complete source envelope applies every member before advancing and whole-envelope retries do not lose siblings", () => {
  const original = row(),
    a = row(),
    b = row(),
    replica = new CollectionReplica("tasks", [original], "domain:1");
  const envelope: CollectionEnvelope<TaskSummary> = {
    revision: "domain:2",
    changes: [
      { kind: "joined", id: a.taskId, summary: a },
      { kind: "joined", id: b.taskId, summary: b },
      { kind: "removed", id: original.taskId },
    ],
  };
  assert.equal(replica.apply(envelope), true);
  assert.equal(replica.revision, "domain:2");
  assert.deepEqual(
    replica.items().map((item) => (item as TaskSummary).taskId),
    [a.taskId, b.taskId],
  );
  assert.equal(replica.apply(envelope), false);
  const invalid = {
    revision: "domain:3",
    changes: [
      { kind: "removed" as const, id: a.taskId },
      { kind: "updated" as const, id: newIdentity(), summary: row() },
    ],
  };
  assert.throws(() => replica.apply(invalid), /基线/);
  assert.equal(replica.revision, "domain:2");
  assert.equal(replica.items().length, 2);
  assert.throws(() => replica.apply({ ...envelope, revision: "other-domain:3" }), /另一个数据域/);
});
test("collection source size limits fail atomically without returning a successful partial member set", () => {
  const original = row(),
    replica = new CollectionReplica("tasks", [original], "domain:1", 1);
  const added = row();
  assert.throws(
    () =>
      replica.apply({
        revision: "domain:2",
        changes: [{ kind: "joined", id: added.taskId, summary: added }],
      }),
    /预算/,
  );
  assert.equal(replica.revision, "domain:1");
  assert.deepEqual(replica.items(), [original]);
});
test("a directory must finish a single frozen revision before subscribing or applying a live envelope", async () => {
  const directory = new Directory(),
    a = row(),
    b = row();
  const common = {
    revision: "domain:2",
    observedAt: now,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  await directory.load(
    async () => ({ ...common, tasks: [a], items: [a], next: "next" }),
    "type=echo",
  );
  assert.throws(() => directory.prepareLive(), /完整分页基线/);
  await directory.load(async () => ({ ...common, tasks: [b], items: [b] }), "", true);
  assert.equal(directory.prepareLive(), "domain:2");
  const c = row();
  directory.apply({
    revision: "domain:3",
    changes: [{ kind: "joined", id: c.taskId, summary: c }],
  });
  assert.equal(directory.page?.tasks.length, 3);
  assert.equal(directory.page?.revision, "domain:3");
});
test("event windows retain distinct Task changes that inherit the same source revision", () => {
  const window = new EventWindow(),
    a = row(),
    b = row();
  const event = (id: string): PublicEvent => ({
    sequence: 3,
    revision: "domain:3",
    type: "task.changed",
    taskId: id,
    scope: "scope",
    occurredAt: now,
    data: {},
  });
  window.merge([event(a.taskId), event(b.taskId)]);
  window.merge([event(a.taskId), event(b.taskId)]);
  assert.equal(window.events.length, 2);
});
test("partial collection SSE never applies a source; a transport error preserves the client's own complete position", async () => {
  let applied = 0;
  const incomplete = new Response(
    'id: domain:2\nevent: task.collection\ndata: {"revision":"domain:2","changes":[',
  );
  await assert.rejects(
    consumeCollectionSse(incomplete, () => {
      applied++;
    }),
    /中途断线/,
  );
  assert.equal(applied, 0);
  const error = new Response(
    'event: task.error\ndata: {"error":{"code":"capacity_exceeded","message":"fanout","details":{"lastCompleteRevision":"domain:1"}}}\n\n',
  );
  await assert.rejects(
    consumeCollectionSse(error, () => {
      applied++;
    }),
    (failure: unknown) => failure instanceof Error && failure.message.includes("capacity_exceeded"),
  );
  assert.equal(applied, 0);
});
