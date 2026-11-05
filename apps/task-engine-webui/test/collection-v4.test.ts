import assert from "node:assert/strict";
import test from "node:test";
import type {
  CollectionEnvelope,
  PublicEvent,
  RunPage,
  RunSummary,
  TaskPage,
  TaskSummary,
} from "@potential-guide/task-protocol";
import { observeDirectory } from "../src/directory-observation.js";
import {
  ApiError,
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

function page(tasks: TaskSummary[], revision: string, next?: string): TaskPage {
  return {
    tasks,
    items: tasks,
    revision,
    observedAt: now,
    expiresAt: new Date(Date.parse(now) + 60000).toISOString(),
    ...(next ? { next } : {}),
  };
}

test("polling replaces the whole loaded window using only the new snapshot's cursors and applied filters", async () => {
  const directory = new Directory();
  const original = row(),
    sibling = row(),
    a = row(),
    b = row();
  await directory.load(async () => page([original], "domain:1", "old-2"), "type=echo");
  await directory.load(async () => page([sibling], "domain:1", "old-3"), "", true);
  const previous = directory.page;
  const queries: string[] = [];
  assert.equal(
    await directory.refresh(async (query) => {
      queries.push(query);
      assert.equal(directory.page, previous, "no partial refresh is published");
      return query.includes("cursor=")
        ? page([b], "domain:2", "new-3")
        : page([a], "domain:2", "new-2");
    }),
    true,
  );
  assert.deepEqual(queries, ["type=echo", "type=echo&cursor=new-2"]);
  assert.deepEqual(directory.page?.tasks, [a, b]);
  assert.equal(directory.page?.revision, "domain:2");
  assert.equal(directory.page?.next, "new-3");
  await directory.load(
    async (query) => {
      assert.equal(query, "type=echo&cursor=new-3");
      return page([original], "domain:2");
    },
    "",
    true,
  );
  assert.equal(directory.prepareLive(), "domain:2");
});

test("failed, inconsistent, duplicate, regressed or cross-domain refreshes preserve the last confirmed window", async () => {
  const directory = new Directory();
  const a = row(),
    b = row();
  await directory.load(async () => page([a], "domain:2", "old-2"), "type=echo");
  await directory.load(async () => page([b], "domain:2", "old-3"), "", true);
  const previous = directory.page;
  for (const fetchPage of [
    async (query: string) => {
      if (query.includes("cursor=")) throw new ApiError(503, "unavailable", "fixture");
      return page([row()], "domain:3", "new-2");
    },
    async (query: string) =>
      page([row()], query.includes("cursor=") ? "domain:4" : "domain:3", "new-2"),
    async () => page([a], "domain:3", "new-2"),
    async () => page([a], "domain:1"),
    async () => page([a], "other:3"),
  ]) {
    await assert.rejects(directory.refresh(fetchPage));
    assert.equal(directory.page, previous);
    assert.equal(directory.stale, true);
    assert.equal(directory.refreshing, false);
    assert.match(directory.error, /保留上次确认窗口/);
  }
  await directory.refresh(async () => page([a], "domain:3"));
  assert.equal(directory.stale, false);
  assert.equal(directory.error, "");
});

test("refreshes do not overlap or overwrite a newer query and abort between pages without publishing a partial result", async () => {
  const directory = new Directory();
  const a = row(),
    b = row();
  await directory.load(async () => page([a], "domain:1", "old-2"), "type=echo");
  let resolve!: (page: TaskPage) => void;
  const pending = directory.refresh(
    () =>
      new Promise<TaskPage>((accept) => {
        resolve = accept;
      }),
  );
  assert.equal(directory.refreshing, true);
  assert.equal(
    await directory.refresh(async () => {
      assert.fail("overlapping refresh");
    }),
    false,
  );
  await directory.load(async () => page([b], "domain:2", "other-2"), "type=other");
  resolve(page([a], "domain:3"));
  assert.equal(await pending, false);
  assert.equal(directory.query, "type=other");
  assert.deepEqual(directory.page?.tasks, [b]);
  await directory.load(async () => page([a], "domain:2", "other-3"), "", true);
  const previous = directory.page;
  let active = true,
    reads = 0;
  assert.equal(
    await directory.refresh(
      async () => {
        reads++;
        active = false;
        return page([row()], "domain:3", "new-2");
      },
      () => active,
    ),
    false,
  );
  assert.equal(reads, 1);
  assert.equal(directory.page, previous);
});

test("paginated observation backs off on failures and switches to SSE only after an atomic complete refresh", async () => {
  const directory = new Directory();
  const a = row(),
    b = row();
  await directory.load(async () => page([a], "domain:1", "next"), "type=echo");
  const controller = new AbortController(),
    delays: number[] = [];
  let reads = 0;
  await observeDirectory({
    directory,
    signal: controller.signal,
    current: () => true,
    canRefresh: () => true,
    wait: async (delay) => {
      delays.push(delay);
    },
    fetchPage: async () => {
      reads++;
      if (reads <= 4) throw new ApiError(503, "unavailable", "fixture");
      return page([a], "domain:2");
    },
    stream: async (revision, receive) => {
      assert.equal(revision, "domain:2");
      assert.equal(directory.polling, false);
      receive({ revision: "domain:3", changes: [{ kind: "joined", id: b.taskId, summary: b }] });
      controller.abort();
    },
    changed: () => {},
  });
  assert.deepEqual(delays, [5000, 10000, 20000, 30000, 30000]);
  assert.deepEqual(
    directory.page?.tasks,
    [a, b].sort((left, right) => (left.taskId < right.taskId ? -1 : 1)),
  );
  assert.equal(directory.page?.revision, "domain:3");
  assert.equal(directory.live, true);
  assert.equal(directory.stale, false);
});

test("paused polling makes no reads and abort or permission failure stops observation", async () => {
  for (const denied of [false, true]) {
    const directory = new Directory();
    await directory.load(async () => page([row()], "domain:1", "next"), "");
    const controller = new AbortController();
    let visible = false,
      waits = 0,
      reads = 0;
    await observeDirectory({
      directory,
      signal: controller.signal,
      current: () => true,
      canRefresh: () => visible,
      wait: async () => {
        waits++;
        if (waits === 2) visible = true;
        if (!denied && waits === 2) controller.abort();
      },
      fetchPage: async () => {
        reads++;
        throw new ApiError(403, "forbidden", "fixture");
      },
      stream: async () => {
        assert.fail("partial baseline must not subscribe");
      },
      changed: () => {},
    });
    assert.equal(waits, 2);
    assert.equal(reads, denied ? 1 : 0);
    if (denied) {
      assert.equal(directory.polling, false);
      assert.equal(directory.stale, true);
    }
  }
});

test("Run windows use the same atomic polling and retain the new paging cursor", async () => {
  const run = (): RunSummary => ({
    runId: newIdentity(),
    type: "echo",
    version: "1",
    stage: "running",
    scope: "scope",
    startedSequence: 1,
    stopRequested: false,
    startedAt: now,
    updatedAt: now,
    state: {
      running: true,
      completed: false,
      failed: false,
      stopping: false,
      stopped: false,
      reclaimed: false,
      sealed: false,
    },
  });
  const a = run(),
    b = run(),
    directory = new Directory<RunPage>("runs");
  const runPage = (runs: RunSummary[], revision: string, next: string): RunPage => ({
    runs,
    items: runs,
    revision,
    observedAt: now,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    next,
  });
  await directory.load(async () => runPage([a], "domain:1", "old"), "sort=started-desc");
  await directory.refresh(async (query) => {
    assert.equal(query, "sort=started-desc");
    return runPage([b], "domain:2", "new");
  });
  assert.deepEqual(directory.page?.runs, [b]);
  assert.equal(directory.page?.next, "new");
});
