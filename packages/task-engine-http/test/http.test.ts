import assert from "node:assert/strict";
import test from "node:test";
import { newId } from "@potential-guide/task-engine";
import { TaskError, type TaskSnapshot } from "@potential-guide/task-protocol";
import { caller, flush, harness } from "../../task-engine/test/fixtures.js";
import { createTaskHandler } from "../src/index.js";

test("Web adapter and core preserve body/header identity, auth and errors without listener", async () => {
  const h = harness();
  const audit: { requestId?: string; code: string }[] = [];
  const handler = createTaskHandler({
    service: h.engine,
    prefix: "/api",
    auditRejection: (event) => audit.push(event),
    resolveCaller: (request) => {
      if (!request.headers.has("authorization"))
        throw new TaskError("unauthenticated", "Token required.");
      return request.headers.get("authorization") === "a" ? caller : { ...caller, scope: "b" };
    },
  });
  function request(path: string, init: RequestInit = {}) {
    return handler(
      new Request(`http://host/api${path}`, {
        ...init,
        headers: { authorization: "a", ...init.headers },
      }),
    );
  }
  try {
    const id = newId();
    const body = { type: "echo", text: "hello", timeoutMs: 100 };
    const response = await request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": id },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 202);
    const task = (await response.json()) as TaskSnapshot;
    assert.equal(task.requestId, id);
    assert.equal(task.stage, "initial");
    assert.deepEqual(await (await request(`/requests/${id}`)).json(), { ...body, requestId: id });
    await h.turn();
    await h.finish();
    h.engine.tick();
    assert.deepEqual(
      await (await request(`/tasks/${task.taskId}`)).json(),
      h.engine.getTask(task.taskId, caller),
    );
    assert.equal((await request(`/tasks/${task.taskId}/cancel`, { method: "POST" })).status, 409);
    assert.equal(
      (await request(`/tasks/${task.taskId}`, { headers: { authorization: "b" } })).status,
      403,
    );
    assert.equal((await handler(new Request(`http://host/api/tasks/${task.taskId}`))).status, 401);
    assert.equal(
      (
        await request("/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": id },
          body: "{",
        })
      ).status,
      400,
    );
    assert.deepEqual(audit.at(-1), { requestId: id, code: "invalid_request" });
    assert.equal(
      (
        await request("/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": id },
          body: JSON.stringify({ ...body, requestId: id }),
        })
      ).status,
      400,
    );
  } finally {
    await h.close();
  }
});

test("SSE handoff and Last-Event-ID use durable facts; disconnect never cancels", async () => {
  const h = harness();
  const handler = createTaskHandler({ service: h.engine, resolveCaller: () => caller, pollMs: 1 });
  try {
    const task = h.submit();
    const response = await handler(new Request(`http://host/events?taskId=${task.taskId}`));
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const reader = response.body?.getReader();
    assert.ok(reader);
    const first = new TextDecoder().decode((await reader.read()).value);
    const cursor = /^id: (.+)$/m.exec(first)?.[1];
    assert.ok(cursor);
    await h.turn();
    h.work[0]?.permit.progress({ detail: "after initial watermark" });
    await reader.cancel();
    assert.equal(h.engine.getTask(task.taskId, caller).canceledAt, undefined);
    const resumed = await handler(
      new Request(`http://host/events?taskId=${task.taskId}`, {
        headers: { "Last-Event-ID": cursor },
      }),
    );
    const resumedReader = resumed.body?.getReader();
    assert.ok(resumedReader);
    const frame = new TextDecoder().decode((await resumedReader.read()).value);
    assert.match(frame, /execution.progress/);
    assert.match(frame, /after initial watermark/);
    await resumedReader.cancel();
    await h.finish();
    h.engine.tick();
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "completed");
  } finally {
    await h.close();
  }
});

test("HTTP payload bounds, filter checks and expired cursor mapping", async () => {
  const h = harness({ limits: { retentionMs: 5 } });
  const handler = createTaskHandler({
    service: h.engine,
    resolveCaller: () => caller,
    maxBodyBytes: 128,
  });
  try {
    const task = h.submit();
    const page = h.engine.readHistory({ taskId: task.taskId }, {}, caller);
    const oversized = await handler(
      new Request("http://host/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": newId() },
        body: JSON.stringify({ type: "echo", text: "x".repeat(200), timeoutMs: 100 }),
      }),
    );
    assert.equal(oversized.status, 413);
    assert.equal(
      (await handler(new Request("http://host/event-history?taskId=a&seriesId=b"))).status,
      400,
    );
    await h.turn();
    await h.finish();
    h.engine.tick();
    await flush();
    h.clock.advance(10);
    h.engine.collect();
    const expired = await handler(
      new Request(`http://host/events?taskId=${task.taskId}`, {
        headers: { "Last-Event-ID": page.cursor },
      }),
    );
    assert.equal(expired.status, 410);
    assert.equal(
      ((await expired.json()) as { error: { code: string } }).error.code,
      "history_expired",
    );
  } finally {
    await h.close();
  }
});

test("core reauthorizes each subscription pull; slow clients have bounded pull pages", async () => {
  const h = harness({ limits: { pageSize: 2, maxSubscriptions: 1 } });
  try {
    const task = h.submit();
    const subscription = h.engine.subscribe({ taskId: task.taskId }, undefined, caller);
    assert.throws(() => h.engine.subscribe({ taskId: task.taskId }, undefined, caller), {
      code: "capacity_exceeded",
    });
    await h.turn();
    for (let i = 0; i < 10; i++) h.work[0]?.permit.progress({ i });
    assert.equal(subscription.pull().events.length, 2);
    const saved = caller.subject;
    caller.subject = "revoked";
    try {
      assert.throws(() => subscription.pull(), { code: "forbidden" });
    } finally {
      caller.subject = saved;
    }
    subscription.close();
    assert.equal(h.engine.getTask(task.taskId, caller).canceledAt, undefined);
  } finally {
    await h.close();
  }
});
