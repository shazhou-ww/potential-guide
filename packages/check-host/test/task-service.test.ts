import assert from "node:assert/strict";
import test from "node:test";
import { checkerSchemaUri, type Json } from "@potential-guide/check-artifacts";
import {
  TaskService,
  serviceLimits,
  type TaskOptions,
  type ExecutionContext,
  type PreparedTask,
} from "../src/task-service.js";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
interface Request extends TaskOptions {
  value: string;
  delay?: boolean;
}
function fixture(overrides: Partial<typeof serviceLimits> = {}) {
  const preparation = deferred<void>();
  const runs: {
    context: ExecutionContext<Json, Json>;
    done: ReturnType<typeof deferred<{ result: Json; evidence: Json }>>;
  }[] = [];
  const service = new TaskService<Request, PreparedTask, Json>(
    {
      normalize: (request) => request,
      authorize() {},
      async prepare(request) {
        if (request.delay) await preparation.promise;
        return {
          language: "en",
          compatibility: request.value,
          artifact: {
            digest: `sha256:${"a".repeat(64)}`,
            source: "https://example.test/a",
            checkedAt: new Date().toISOString(),
            manifest: {
              $schema: checkerSchemaUri,
              runtime: { type: "node", minVersion: "22.13.0" },
              entry: "checker.cjs",
              subjectSchema: { type: "object" },
              problems: [],
              languages: ["en"],
            },
          },
        };
      },
      async execute(_prepared, _request, context) {
        const done = deferred<{ result: Json; evidence: Json }>();
        runs.push({ context, done });
        context.signal.addEventListener(
          "abort",
          () => done.resolve({ result: null, evidence: {} }),
          { once: true },
        );
        return done.promise;
      },
    },
    { ...serviceLimits, retentionMs: 1000, ...overrides },
  );
  return { service, runs, preparation };
}
test("causal freshness, shared reservations, late resolution and independent cancellation", async () => {
  const { service, runs, preparation } = fixture();
  try {
    const first = service.accept({ value: "x" }, "scope");
    const queued = service.accept({ value: "x" }, "scope");
    const late = service.accept({ value: "x", delay: true }, "scope");
    await tick();
    assert.equal(runs.length, 1);
    runs[0]?.context.start();
    const weak = service.accept({ value: "x", freshness: "completed-after-request" }, "scope");
    const strong = service.accept({ value: "x" }, "scope");
    await tick();
    assert.equal(runs.length, 2);
    assert.equal(
      service.snapshot(weak.taskId, "scope").executionId,
      service.snapshot(first.taskId, "scope").executionId,
    );
    service.cancel(first.taskId, "scope");
    assert.equal(runs[0]?.context.signal.aborted, false);
    runs[0]?.done.resolve({ result: { ok: true }, evidence: { actual: "runtime" } });
    await tick();
    preparation.resolve();
    await tick();
    assert.equal(service.snapshot(late.taskId, "scope").state, "completed");
    assert.equal(
      service.snapshot(late.taskId, "scope").executionId,
      service.snapshot(queued.taskId, "scope").executionId,
    );
    assert.equal(service.snapshot(first.taskId, "scope").state, "cancelled");
    assert.equal(service.snapshot(strong.taskId, "scope").state, "waiting");
    runs[1]?.context.start();
    runs[1]?.done.resolve({ result: {}, evidence: {} });
    await tick();
    assert.notEqual(
      service.snapshot(strong.taskId, "scope").executionId,
      service.snapshot(queued.taskId, "scope").executionId,
    );
  } finally {
    await service.close();
  }
});
test("late wall-clock callbacks cannot attach demand to an expired execution", async () => {
  const { service, runs } = fixture({ executionMs: 20 });
  try {
    const first = service.accept({ value: "x", timeoutMs: 1000 }, "scope");
    await tick();
    runs[0]?.context.start();
    const until = performance.now() + 30;
    while (performance.now() < until) {
      /* Hold timers while the wall-clock expires. */
    }
    const next = service.accept(
      { value: "x", freshness: "completed-after-request", timeoutMs: 1000 },
      "scope",
    );
    await tick();
    assert.equal(service.snapshot(first.taskId, "scope").error?.code, "execution_timeout");
    assert.notEqual(
      service.snapshot(next.taskId, "scope").executionId,
      service.snapshot(first.taskId, "scope").executionId,
    );
    assert.equal(runs.length, 2);
  } finally {
    await service.close();
  }
});
test("weak late resolution, idempotency, deadlines and sealed execution ownership", async () => {
  const { service, runs, preparation } = fixture();
  try {
    const first = service.accept({ value: "x", timeoutMs: 20 }, "scope", "original");
    assert.equal(
      service.accept({ value: "x", timeoutMs: 20 }, "scope", "original").taskId,
      first.taskId,
    );
    assert.throws(
      () => service.accept({ value: "other", timeoutMs: 20 }, "scope", "original"),
      /differs/,
    );
    await tick();
    runs[0]?.context.start();
    const delayedWeak = service.accept(
      { value: "x", delay: true, freshness: "completed-after-request" },
      "scope",
    );
    const survivor = service.accept({ value: "x", freshness: "completed-after-request" }, "scope");
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(service.snapshot(first.taskId, "scope").error?.code, "task_timeout");
    assert.equal(runs[0]?.context.signal.aborted, false);
    runs[0]?.done.resolve({ result: true, evidence: {} });
    await tick();
    preparation.resolve();
    await tick();
    assert.equal(
      service.snapshot(delayedWeak.taskId, "scope").executionId,
      service.snapshot(survivor.taskId, "scope").executionId,
    );
    const cancelled = service.accept({ value: "y" }, "scope");
    await tick();
    service.cancel(cancelled.taskId, "scope");
    assert.equal(runs[1]?.context.signal.aborted, true);
    const later = service.accept({ value: "y" }, "scope");
    await tick();
    assert.notEqual(
      service.snapshot(cancelled.taskId, "scope").executionId,
      service.snapshot(later.taskId, "scope").executionId,
    );
  } finally {
    await service.close();
  }
});
test("progress and combined result/evidence bounds count UTF-8 bytes", async () => {
  const { service, runs } = fixture();
  try {
    const task = service.accept({ value: "progress" }, "scope");
    await tick();
    const run = runs[0];
    assert.ok(run);
    run.context.start();
    const limit = 1024 * 1024;
    const framing = Buffer.byteLength(JSON.stringify({ progress: "" }));
    run.context.progress("a".repeat(limit - framing));
    assert.equal(service.snapshot(task.taskId, "scope").state, "running");
    assert.throws(() => run.context.progress("a".repeat(limit - framing + 1)), /bounds/);
    assert.throws(() => run.context.progress("界".repeat(Math.ceil(limit / 3))), /bounds/);
    let invoked = false;
    assert.throws(
      () =>
        run.context.progress({
          get value() {
            invoked = true;
            return "not plain JSON";
          },
        }),
      /bounds/,
    );
    assert.equal(invoked, false);
    const output = {
      result: "界".repeat(limit),
      evidence: "界".repeat(limit / 2),
    };
    assert.ok(JSON.stringify(output).length < 4 * limit);
    assert.ok(Buffer.byteLength(JSON.stringify(output)) > 4 * limit);
    run.done.resolve(output);
    await tick();
    assert.equal(service.snapshot(task.taskId, "scope").state, "failed");
    assert.equal(service.snapshot(task.taskId, "scope").error?.code, "observation_failed");
    const bounded = service.accept({ value: "bounded-result" }, "scope");
    await tick();
    const boundedRun = runs[1];
    assert.ok(boundedRun);
    boundedRun.context.start();
    const resultFraming = Buffer.byteLength(JSON.stringify({ result: "", evidence: {} }));
    boundedRun.done.resolve({
      result: "a".repeat(4 * limit - resultFraming),
      evidence: {},
    });
    await tick();
    assert.equal(service.snapshot(bounded.taskId, "scope").state, "completed");
  } finally {
    await service.close();
  }
});
