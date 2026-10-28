import assert from "node:assert/strict";
import test from "node:test";
import { Effect, SubscriptionRef } from "@potential-guide/effects";
import type { ManagedArtifact } from "../dist/artifact-manager.js";
import type { ExecutionLifecycle } from "../dist/kernel.js";
import {
  TaskScheduler,
  defaults,
  v2Limits,
  type CheckState,
  type StartCheck,
  type SchedulerArtifacts,
  type SchedulerKernel,
  type TaskEvent,
} from "../dist/index.js";

const digest = `sha256-pguide-check-v1:${"a".repeat(64)}`;
const manifest = {
  format: "pguide-check-v1" as const,
  id: "fixture",
  worker: "worker.cjs" as const,
  protocol: "pguide-check-host-v1" as const,
  subjectSchema: { type: "object" },
  resultSchema: { type: "object", required: ["ok"] },
  resources: [],
  references: { check: "references/check.md", problems: {} },
};
function artifact(version = digest): ManagedArtifact {
  return {
    metadata: {
      digest: version,
      revision: "b".repeat(64),
      source: "https://example.test",
      checkedAt: "fixed",
      manifest,
    },
    prepared: {
      digest: version,
      revision: "b".repeat(64),
      manifest,
      artifactDirectory: "private",
      directory: "private",
    },
  };
}
async function fixture() {
  let now = 0;
  const pending: ((value: ManagedArtifact) => void)[] = [];
  const runs: { request: StartCheck; lifecycle: ExecutionLifecycle }[] = [];
  const cancelled: string[] = [];
  const artifacts: SchedulerArtifacts = {
    authorize: (source) => new URL(source),
    resolve: () => new Promise((resolve) => pending.push(resolve)),
    retain() {},
    release() {},
    metadata: async () => artifact().metadata,
    reference: async () => Buffer.from("reference"),
    close: async () => {},
  };
  const kernel: SchedulerKernel = {
    limits: defaults,
    executeCheck: async (request, lifecycle) => {
      assert.ok(lifecycle);
      runs.push({ request, lifecycle });
      return {
        checkId: request.checkId,
        state: await Effect.runPromise(
          SubscriptionRef.make<CheckState>({ checkId: request.checkId, state: "Queued" }),
        ),
      };
    },
    cancel: (id) => {
      cancelled.push(id);
      return { checkId: id, state: "Cancelled" };
    },
    close: async () => {},
  };
  const scheduler = new TaskScheduler(
    artifacts,
    kernel,
    { ...v2Limits, retentionMs: 1000 },
    { now: () => now, date: () => `date-${now}` },
  );
  const accept = (
    options: {
      freshness?: "started-after-request" | "completed-after-request";
      timeoutMs?: number;
      context?: { x: number };
      subject?: { x: number; y: number };
    } = {},
    scope = "owner",
    key?: string,
  ) =>
    scheduler.accept(
      { check: { url: "https://example.test/check" }, subject: options.subject ?? {}, ...options },
      scope,
      key,
    );
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  const resolve = async (version = digest) => {
    const next = pending.shift();
    assert.ok(next);
    next(artifact(version));
    await settle();
  };
  const start = (index = 0) => {
    const run = runs[index];
    assert.ok(run);
    run.lifecycle.started();
  };
  const finish = (index = 0) => {
    const run = runs[index];
    assert.ok(run);
    run.lifecycle.finished({
      checkId: run.request.checkId,
      state: "Completed",
      result: { ok: false, value: index },
    });
  };
  return {
    scheduler,
    accept,
    settle,
    resolve,
    runs,
    cancelled,
    start,
    finish,
    advance: (value: number) => {
      now = value;
    },
  };
}
test("queued strong Tasks share one reserved Execution; identity and canonical JSON remain distinct", async () => {
  const f = await fixture();
  try {
    const a = f.accept({ subject: { x: 1, y: 2 } });
    const b = f.accept({ subject: { y: 2, x: 1 } });
    await f.settle();
    await f.resolve();
    await f.resolve();
    assert.notEqual(a.taskId, b.taskId);
    assert.equal(f.runs.length, 1);
    f.start();
    f.finish();
    const sa = f.scheduler.snapshot(a.taskId, "owner"),
      sb = f.scheduler.snapshot(b.taskId, "owner");
    assert.equal(sa.state, "completed");
    assert.deepEqual(sa.result, { ok: false, value: 0 });
    assert.equal(sa.executionId, sb.executionId);
  } finally {
    await f.scheduler.close();
  }
});
test("running weak freshness shares, strong freshness reserves a new observation", async () => {
  const f = await fixture();
  try {
    const a = f.accept();
    await f.settle();
    await f.resolve();
    f.start();
    const weak = f.accept({ freshness: "completed-after-request" });
    const strong = f.accept();
    await f.settle();
    await f.resolve();
    await f.resolve();
    assert.equal(f.runs.length, 2);
    assert.equal(
      f.scheduler.snapshot(weak.taskId, "owner").executionId,
      f.scheduler.snapshot(a.taskId, "owner").executionId,
    );
    f.finish();
    assert.equal(f.scheduler.snapshot(weak.taskId, "owner").state, "completed");
    assert.equal(f.scheduler.snapshot(strong.taskId, "owner").state, "waiting");
    f.start(1);
    f.finish(1);
    assert.equal(f.scheduler.snapshot(strong.taskId, "owner").state, "completed");
  } finally {
    await f.scheduler.close();
  }
});
test("late resolution after completion reuses retained weak result only after accurate digest resolution", async () => {
  const f = await fixture();
  try {
    f.accept();
    await f.settle();
    await f.resolve();
    f.start();
    const weak = f.accept({ freshness: "completed-after-request" });
    const nextVersion = f.accept({ freshness: "completed-after-request" });
    await f.settle();
    f.finish();
    await f.resolve();
    assert.equal(f.scheduler.snapshot(weak.taskId, "owner").state, "completed");
    assert.equal(f.runs.length, 1);
    await f.resolve(`sha256-pguide-check-v1:${"c".repeat(64)}`);
    assert.equal(f.runs.length, 2);
    assert.notEqual(
      f.scheduler.snapshot(nextVersion.taskId, "owner").executionId,
      f.runs[0]?.request.checkId,
    );
  } finally {
    await f.scheduler.close();
  }
});
test("Task deadlines are independent, cancellation never stops another waiter, stopping execution rejects newcomers", async () => {
  const f = await fixture();
  try {
    const a = f.accept({ timeoutMs: 10 }),
      b = f.accept({ timeoutMs: 100 });
    await f.settle();
    await f.resolve();
    await f.resolve();
    f.start();
    f.advance(11);
    assert.equal(f.scheduler.snapshot(a.taskId, "owner").error?.code, "task_timeout");
    assert.equal(f.cancelled.length, 0);
    f.scheduler.cancel(b.taskId, "owner");
    assert.equal(f.cancelled.length, 1);
    const c = f.accept({ freshness: "completed-after-request" });
    await f.settle();
    await f.resolve();
    assert.equal(f.runs.length, 2);
    f.finish();
    assert.equal(f.scheduler.snapshot(b.taskId, "owner").state, "cancelled");
    assert.equal(f.scheduler.snapshot(c.taskId, "owner").state, "waiting");
  } finally {
    await f.scheduler.close();
  }
});
test("late timer cannot deliver success after actual deadline, and old completion cannot reverse terminal", async () => {
  const f = await fixture();
  try {
    const task = f.accept({ timeoutMs: 10 });
    await f.settle();
    await f.resolve();
    f.start();
    f.advance(10);
    f.finish();
    assert.equal(f.scheduler.snapshot(task.taskId, "owner").error?.code, "task_timeout");
    f.finish();
    assert.equal(f.scheduler.snapshot(task.taskId, "owner").state, "failed");
  } finally {
    await f.scheduler.close();
  }
});
test("idempotency precedes floating resolution and preserves acceptance, conflicts fail 409", async () => {
  const f = await fixture();
  try {
    const a = f.accept({}, "owner", "key");
    f.advance(2);
    const b = f.accept({}, "owner", "key");
    assert.deepEqual(a, b);
    await f.settle();
    await f.resolve();
    assert.equal(f.runs.length, 1);
    assert.throws(() => f.accept({ context: { x: 1 } }, "owner", "key"), { status: 409 });
    const otherScope = f.accept({}, "other", "key");
    assert.notEqual(a.taskId, otherScope.taskId);
  } finally {
    await f.scheduler.close();
  }
});
test("execution compatibility includes scope and context, not merely revision or URL", async () => {
  const f = await fixture();
  try {
    f.accept();
    f.accept({ context: { x: 1 } });
    f.accept({}, "other");
    await f.settle();
    await f.resolve();
    await f.resolve();
    await f.resolve();
    assert.equal(f.runs.length, 3);
  } finally {
    await f.scheduler.close();
  }
});
test("atomic event subscription initial/finish/reconnect includes terminal and monotonic revisions, read-only", async () => {
  const f = await fixture();
  try {
    const task = f.accept();
    await f.settle();
    await f.resolve();
    f.start();
    const events: TaskEvent[] = [];
    const release = f.scheduler.subscribe([task.taskId, task.taskId], "owner", (event) =>
      events.push(event),
    );
    f.finish();
    release();
    assert.deepEqual(
      events.map((event) => event.snapshot.state),
      ["running", "completed"],
    );
    assert.ok((events[1]?.snapshot.revision ?? 0) > (events[0]?.snapshot.revision ?? 0));
    const replay: TaskEvent[] = [];
    f.scheduler.subscribe([task.taskId], "owner", (event) => replay.push(event))();
    assert.equal(replay[0]?.snapshot.state, "completed");
    assert.equal(f.runs.length, 1);
    assert.throws(() => f.scheduler.subscribe(["missing"], "owner", () => {}), { status: 404 });
    assert.throws(() => f.scheduler.subscribe([task.taskId], "other", () => {}), { status: 403 });
    assert.throws(() => f.scheduler.subscribe([], "owner", () => {}), { status: 400 });
  } finally {
    await f.scheduler.close();
  }
});

test("expired subscriptions report unavailability without reversing a completed Task", async () => {
  const f = await fixture();
  try {
    const task = f.accept();
    await f.settle();
    await f.resolve();
    f.start();
    f.finish();
    const events: TaskEvent[] = [];
    const release = f.scheduler.subscribe([task.taskId], "owner", (event) => events.push(event));
    f.advance(1001);
    assert.throws(() => f.scheduler.snapshot(task.taskId, "owner"), { status: 404 });
    assert.equal(events.at(-1)?.unavailable?.code, "task_expired");
    assert.equal(events.at(-1)?.snapshot.state, "completed");
    release();
  } finally {
    await f.scheduler.close();
  }
});

test("a late wall timer cannot attach new demand to a logically expired Execution", async () => {
  const f = await fixture();
  try {
    const first = f.accept({ timeoutMs: 120_000 });
    await f.settle();
    await f.resolve();
    f.start();
    f.advance(defaults.deadlineMs + 1);
    const second = f.accept({ freshness: "completed-after-request", timeoutMs: 120_000 });
    await f.settle();
    await f.resolve();
    assert.equal(f.scheduler.snapshot(first.taskId, "owner").error?.code, "execution_timeout");
    assert.equal(f.runs.length, 2);
    assert.notEqual(
      f.scheduler.snapshot(first.taskId, "owner").executionId,
      f.scheduler.snapshot(second.taskId, "owner").executionId,
    );
  } finally {
    await f.scheduler.close();
  }
});

test("invalid normal output is a verification failure, never a business completion", async () => {
  const f = await fixture();
  try {
    const task = f.accept();
    await f.settle();
    await f.resolve();
    f.start();
    const run = f.runs[0];
    assert.ok(run);
    run.lifecycle.finished({ checkId: run.request.checkId, state: "Completed", result: {} });
    const failed = f.scheduler.snapshot(task.taskId, "owner");
    assert.equal(failed.state, "failed");
    assert.equal(failed.error?.code, "invalid_result");
    assert.equal(failed.error?.stage, "verify");
  } finally {
    await f.scheduler.close();
  }
});

test("initial event snapshots enforce the actual Task deadline even before its timer runs", async () => {
  const f = await fixture();
  try {
    const task = f.accept({ timeoutMs: 10 });
    await f.settle();
    await f.resolve();
    f.start();
    f.advance(11);
    const events: TaskEvent[] = [];
    f.scheduler.subscribe([task.taskId], "owner", (event) => events.push(event))();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.snapshot.error?.code, "task_timeout");
  } finally {
    await f.scheduler.close();
  }
});

test("a new weak Task cannot resurrect an execution whose last demand expired before timer dispatch", async () => {
  const f = await fixture();
  try {
    const first = f.accept({ timeoutMs: 10_000 });
    await f.settle();
    await f.resolve();
    f.start();
    f.advance(10_001);
    const next = f.accept({ freshness: "completed-after-request", timeoutMs: 10_000 });
    await f.settle();
    await f.resolve();
    assert.equal(f.scheduler.snapshot(first.taskId, "owner").error?.code, "task_timeout");
    assert.equal(f.cancelled.length, 1);
    assert.equal(f.runs.length, 2);
    assert.notEqual(
      f.scheduler.snapshot(next.taskId, "owner").executionId,
      f.runs[0]?.request.checkId,
    );
  } finally {
    await f.scheduler.close();
  }
});
