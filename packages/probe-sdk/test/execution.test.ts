import assert from "node:assert/strict";
import test from "node:test";
import { MemoryIpfsClient } from "@potential-guide/ipfs-content/testing";
import { newId } from "@potential-guide/task-engine";
import type { TaskContext } from "@potential-guide/task-sdk";
import type { TaskSnapshot } from "@potential-guide/task-protocol";
import {
  CheckInvocationCleanupError,
  createCheckInvoker,
  type TaskInvocationService,
} from "../src/execution.js";

async function fixture() {
  const client = new MemoryIpfsClient();
  const bytes = Buffer.from("independent content\n");
  const cid = await client.import(new Map([["content.txt", bytes]]));
  const parentCid = await client.import(new Map([["resources/checks/child/content.txt", bytes]]));
  const caller = { scope: "recovery", subject: "test" };
  const controller = new AbortController();
  const context = {
    scope: caller.scope,
    signal: controller.signal,
    bundle: { cid: parentCid },
  } as TaskContext;
  const request = { parentCid, cid, path: "resources/checks/child", input: {} };
  const taskId = newId();
  let durableRequestId = "";
  let submits = 0;
  const lookups: string[] = [];
  const cancellations: string[] = [];
  const snapshot = (changes: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
    requestId: durableRequestId,
    taskId,
    seriesId: taskId,
    bundle: cid,
    stage: "running",
    receivedAt: "2026-11-08T00:00:00.000Z",
    eligibleAt: "2026-11-08T00:00:00.000Z",
    deadlineAt: "2026-11-08T00:01:00.000Z",
    timestamp: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
    dataDomain: "test",
    revision: "1",
    canceled: false,
    ...changes,
  });
  const service: TaskInvocationService = {
    async submit(request) {
      submits++;
      durableRequestId = request.requestId;
      return { status: "accepted", requestId: durableRequestId, taskId };
    },
    async getRequestStatus(id) {
      lookups.push(id);
      assert.equal(id, durableRequestId);
      return { status: "accepted", requestId: id, taskId };
    },
    cancelTask(id) {
      cancellations.push(id);
      assert.equal(id, taskId);
      return { ...snapshot({ canceled: true, stage: "stopped" }), changed: true };
    },
    getTask: () => snapshot({ stage: "completed", result: null }),
  };
  return {
    client,
    caller,
    context,
    controller,
    request,
    service,
    taskId,
    snapshot,
    lookups,
    cancellations,
    get durableRequestId() {
      return durableRequestId;
    },
    get submits() {
      return submits;
    },
    invoke(cleanupTimeoutMs = 500) {
      return createCheckInvoker({
        service,
        client,
        caller,
        timeoutMs: 2000,
        cleanupTimeoutMs,
        authorize: () => true,
      })(request, context);
    },
  };
}

test("lost durable submit response recovers the original request, survives a transient lookup and cancels", async () => {
  const f = await fixture();
  const lostResponse = new Error("submit response lost after durable acceptance");
  const unavailable = new Error("transient status transport failure");
  const submit = f.service.submit;
  f.service.submit = async (request, caller) => {
    await submit(request, caller);
    throw lostResponse;
  };
  const status = f.service.getRequestStatus;
  let attempts = 0;
  f.service.getRequestStatus = async (id, options, caller) => {
    const accepted = await status(id, options, caller);
    if (++attempts === 1) {
      f.controller.abort(new Error("parent cancelled during recovery"));
      throw unavailable;
    }
    return accepted;
  };
  await assert.rejects(f.invoke(), (error) => {
    assert.ok(error instanceof CheckInvocationCleanupError);
    assert.equal(error.cause, lostResponse);
    assert.match(error.message, /submit response lost after durable acceptance/);
    assert.deepEqual(error.errors, [lostResponse, unavailable]);
    assert.equal(error.requestId, f.durableRequestId);
    assert.equal(error.taskId, f.taskId);
    assert.equal(error.cleanupConfirmed, true);
    return true;
  });
  assert.equal(f.submits, 1, "recovery must not resubmit");
  assert.deepEqual(f.lookups, [f.durableRequestId, f.durableRequestId]);
  assert.deepEqual(f.cancellations, [f.taskId]);
});

test("a failed preparing-status response still recovers and cancels without masking the original failure", async () => {
  const f = await fixture();
  const failure = new Error("status response lost");
  const submit = f.service.submit;
  f.service.submit = async (request, caller) => {
    await submit(request, caller);
    return { status: "preparing", requestId: request.requestId, trackingToken: request.requestId };
  };
  const status = f.service.getRequestStatus;
  let attempts = 0;
  f.service.getRequestStatus = async (id, options, caller) => {
    const decision = await status(id, options, caller);
    if (++attempts === 1) throw failure;
    return decision;
  };
  await assert.rejects(f.invoke(), (error) => error === failure);
  assert.equal(f.submits, 1);
  assert.deepEqual(f.lookups, [f.durableRequestId, f.durableRequestId]);
  assert.deepEqual(f.cancellations, [f.taskId]);
});

test("cancellation transport failures are retried and retained alongside the invocation failure", async () => {
  const f = await fixture();
  const primary = new Error("result transport failed");
  const cleanup = new Error("cancel response lost");
  f.service.getTask = async () => {
    throw primary;
  };
  const cancel = f.service.cancelTask;
  let attempts = 0;
  f.service.cancelTask = async (id, caller) => {
    const result = await cancel(id, caller);
    if (++attempts === 1) throw cleanup;
    return result;
  };
  await assert.rejects(f.invoke(), (error) => {
    assert.ok(error instanceof CheckInvocationCleanupError);
    assert.deepEqual(error.errors, [primary, cleanup]);
    assert.equal(error.cause, primary);
    assert.equal(error.cleanupConfirmed, true);
    return true;
  });
  assert.deepEqual(f.cancellations, [f.taskId, f.taskId]);
});

test("permanently unavailable and never-settling admission recovery are bounded and explicitly unconfirmed", async (t) => {
  for (const mode of ["reject", "hang"]) {
    await t.test(mode, { timeout: 3000 }, async () => {
      const f = await fixture();
      const primary = new Error("durable submit response lost");
      const unavailable = new Error("status permanently unavailable");
      const submit = f.service.submit;
      f.service.submit = async (request, caller) => {
        await submit(request, caller);
        throw primary;
      };
      f.service.getRequestStatus = async (id) => {
        assert.equal(id, f.durableRequestId);
        f.lookups.push(id);
        if (mode === "reject") throw unavailable;
        return new Promise(() => {});
      };
      const started = performance.now();
      await assert.rejects(f.invoke(60), (error) => {
        assert.ok(error instanceof CheckInvocationCleanupError);
        assert.equal(error.cause, primary);
        assert.equal(error.cleanupConfirmed, false);
        assert.match(error.message, /cleanup could not be confirmed/);
        assert.equal(error.requestId, f.durableRequestId);
        assert.ok(error.errors.some((entry) => entry?.code === "child_cleanup_timeout"));
        if (mode === "reject") assert.ok(error.errors.includes(unavailable));
        return true;
      });
      assert.ok(performance.now() - started < 2000);
      assert.equal(f.submits, 1);
      assert.ok(f.lookups.length > 0 && f.lookups.length < 10);
      assert.deepEqual(f.cancellations, []);
    });
  }
});

test("the invocation adapter exposes unknown results rather than asserting CheckResult", async () => {
  const f = await fixture();
  f.service.getTask = () => f.snapshot({ stage: "completed", result: 42 });
  assert.equal(await f.invoke(), 42);
  assert.deepEqual(f.cancellations, []);
});
