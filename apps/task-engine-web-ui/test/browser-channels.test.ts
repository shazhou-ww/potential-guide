import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Observation, TaskSnapshot } from "@potential-guide/task-protocol";
import { newIdentity, TaskSnapshots } from "../src/model.js";
import { browserDom } from "./browser-dom.js";

async function until(check: () => boolean, message: string): Promise<void> {
  const end = performance.now() + 3000;
  while (performance.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

test("actual browser entry wires cancellation receipts and SSE without cross-channel rollback", async (t) => {
  let now = Date.parse("2026-10-31T04:00:00.000Z");
  t.mock.method(Date, "now", () => now);
  const reads = t.mock.method(TaskSnapshots.prototype, "begin");
  const cancellations = t.mock.method(TaskSnapshots.prototype, "beginCancellation");
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { window, document } = dom;
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    Option: globalThis.Option,
    fetch: globalThis.fetch,
  };
  const snapshots = new Map<string, TaskSnapshot>();
  const streams = new Map<
    string,
    { emit(value: Observation): void; fail(): void; closed: boolean }
  >();
  const receipts = new Map<string, (snapshot: TaskSnapshot) => void>();
  const canceledIds: string[] = [];
  let rejectReconnect = false;
  const response = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const mockFetch: typeof fetch = async (input, options) => {
    const url = new URL(String(input), "http://ui.fixture");
    if (url.pathname === "/api/bootstrap")
      return response({
        csrf: "fixture-session",
        endpoints: [{ id: "demo", label: "fixture", binding: "fixture" }],
      });
    if (url.pathname === "/api/favorites") return response([]);
    const path = url.pathname.replace("/api/endpoints/demo", "");
    if (path === "/task-types")
      return response([
        { type: "echo", version: "1", revision: "a".repeat(64), inputSchema: { type: "object" } },
      ]);
    const task = /^\/tasks\/([^/]+)(\/cancel)?$/.exec(path);
    if (task?.[1]) {
      const id = task[1];
      if (!task[2]) return response(snapshots.get(id));
      assert.equal(options?.method, "POST");
      canceledIds.push(id);
      return new Promise<Response>((resolve) => {
        receipts.set(id, (snapshot) => {
          snapshots.set(id, snapshot);
          resolve(response(snapshot));
        });
      });
    }
    if (path.startsWith("/requests/"))
      return response({
        requestId: path.slice("/requests/".length),
        type: "echo",
        timeoutMs: 30000,
        text: "fixture",
      });
    const id = url.searchParams.get("taskId") ?? "";
    if (path === "/event-history")
      return response({
        events: [],
        items: [],
        revision: "domain:10",
        watermark: 10,
        cursor: "history-resume",
      });
    if (path === "/events") {
      if (rejectReconnect)
        return response({ error: { code: "forbidden", message: "fixture disconnect" } }, 403);
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const state = {
        closed: false,
        emit(value: Observation) {
          assert.equal(state.closed, false);
          controller.enqueue(
            new TextEncoder().encode(`event: task.observation\ndata: ${JSON.stringify(value)}\n\n`),
          );
        },
        fail() {
          if (state.closed) return;
          state.closed = true;
          controller.error(new Error("deliberate stream failure"));
        },
      };
      const abort = () => state.fail();
      const stream = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
        cancel() {
          state.closed = true;
          options?.signal?.removeEventListener("abort", abort);
        },
      });
      streams.set(id, state);
      options?.signal?.addEventListener("abort", abort, { once: true });
      state.emit({
        snapshots: [snapshots.get(id)!],
        events: [],
        watermark: 10,
        revision: "domain:10",
        cursor: "stream-10",
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error(`Unexpected browser route ${path}`);
  };
  Object.assign(globalThis, {
    window,
    document,
    fetch: mockFetch,
    Option: function Option(text: string, value: string) {
      const option = document.createElement("option");
      option.textContent = text;
      option.value = value;
      return option;
    },
  });
  const snapshot = (): TaskSnapshot => ({
    taskId: newIdentity(),
    requestId: newIdentity(),
    seriesId: newIdentity(),
    stage: "running",
    receivedAt: "2026-10-31T02:00:00.000Z",
    eligibleAt: "2026-10-31T02:00:00.000Z",
    deadlineAt: "2026-10-31T03:00:00.000Z",
    timestamp: "2026-10-31T02:00:00.000Z",
    updatedAt: "2026-10-31T02:00:00.000Z",
    dataDomain: "domain",
    revision: "domain:10",
    canceled: false,
    run: { runId: newIdentity(), startedAt: "2026-10-31T02:00:00.000Z" },
  });
  const readDetail = () => {
    const text = document.querySelector('#task-detail [data-key="task-snapshot"] pre')?.textContent;
    return text ? (JSON.parse(text) as TaskSnapshot) : undefined;
  };
  const open = async (task: TaskSnapshot) => {
    document.querySelector<HTMLButtonElement>('[role="dialog"] [data-close]')?.click();
    snapshots.set(task.taskId, task);
    const field = document.querySelector("#task-lookup input") as unknown as HTMLInputElement;
    const button = document.querySelector("#task-lookup button") as unknown as HTMLButtonElement;
    await until(() => !button.disabled, "lookup should be ready");
    field.value = task.taskId;
    button.click();
    await until(
      () => streams.has(task.taskId) && readDetail()?.taskId === task.taskId,
      "real openTask/live path should observe selected Task",
    );
  };
  const cancel = async (id: string) => {
    (
      document.querySelector('#task-detail [data-action="cancel"]') as unknown as HTMLButtonElement
    ).click();
    await until(() => receipts.has(id), "actual cancel button should issue POST");
  };
  const emit = (task: TaskSnapshot, watermark: number) =>
    streams.get(task.taskId)!.emit({
      snapshots: [{ ...task, revision: `domain:${watermark}` }],
      watermark,
      revision: `domain:${watermark}`,
      cursor: `stream-${watermark}`,
      events: [
        {
          sequence: watermark,
          revision: `domain:${watermark}`,
          type: "task.changed",
          taskId: task.taskId,
          scope: "fixture",
          runId: task.run!.runId,
          occurredAt: task.timestamp,
          data: { snapshot: { ...task, revision: `domain:${watermark}` } } as never,
        },
      ],
    });
  try {
    await import("../src/browser.js");
    await until(
      () => !!document.querySelector("#task-lookup button"),
      "browser actions should load",
    );
    document.getElementById("new-task")!.click();
    await until(
      () =>
        document.getElementById("discovery-status")?.textContent?.includes("无需类型注册") === true,
      "browser bootstrap should finish",
    );
    document.querySelector<HTMLButtonElement>("#create-dialog [data-close]")!.click();

    // A: this running frame was captured before cancellation, despite its larger global watermark.
    const a = snapshot();
    await open(a);
    await cancel(a.taskId);
    const canceledA = {
      ...a,
      canceled: true,
      revision: "domain:25",
      canceledAt: "2026-10-31T01:59:00.000Z",
      timestamp: "2026-10-31T01:59:00.000Z",
    };
    receipts.get(a.taskId)!(canceledA);
    await until(
      () => readDetail()?.canceledAt === canceledA.canceledAt,
      "confirmed cancellation must appear",
    );
    const cache = cancellations.mock.calls[0]!.this as TaskSnapshots;
    for (let index = 0; index < 201; index++) cache.seed(snapshot());
    assert.equal(
      cache.values.has(a.taskId),
      false,
      "exercise bounded list eviction while the detail stays selected",
    );
    cache.seed(a);
    assert.equal(
      cache.values.get(a.taskId)?.canceledAt,
      undefined,
      "simulate a late receipt after list eviction",
    );
    emit(a, 20);
    await until(
      () => document.querySelector('#task-detail [data-key^="event:domain:20:"]') !== null,
      "late SSE frame must actually traverse live/renderObserver",
    );
    assert.equal(readDetail()?.canceledAt, canceledA.canceledAt);
    assert.match(document.getElementById("task-list")!.textContent!, /已取消/);
    assert.match(document.getElementById("task-detail")!.textContent!, /超时事实保留/);
    assert.doesNotMatch(document.getElementById("task-detail")!.textContent!, /Run 已形成结局/);
    assert.match(document.getElementById("task-detail")!.textContent!, /不代表关联 Run 已退出/);
    emit(
      {
        ...canceledA,
        stage: "completed",
        result: { ok: true },
        termination: { terminatedAt: a.timestamp },
        run: { ...a.run!, completedAt: a.timestamp },
      },
      26,
    );
    await until(
      () => readDetail()?.stage === "completed",
      "canceled Task must still follow its Run to completion",
    );
    assert.equal(readDetail()?.canceledAt, canceledA.canceledAt);
    assert.equal(streams.get(a.taskId)!.closed, false);

    // B: an in-flight cancel receipt must survive an intervening running observation and stream loss.
    const b = snapshot();
    await open(b);
    await cancel(b.taskId);
    emit({ ...b, timestamp: "2026-10-31T01:58:00.000Z" }, 11);
    await until(
      () => document.querySelector('#task-detail [data-key^="event:domain:11:"]') !== null,
      "intervening observation must be consumed before receipt",
    );
    const canceledB = {
      ...b,
      canceled: true,
      revision: "domain:12",
      canceledAt: "2026-10-31T01:57:00.000Z",
      timestamp: "2026-10-31T01:57:00.000Z",
    };
    receipts.get(b.taskId)!(canceledB);
    await until(
      () => readDetail()?.canceledAt === canceledB.canceledAt,
      "SSE must not invalidate acknowledged modification",
    );
    rejectReconnect = true;
    streams.get(b.taskId)!.fail();
    await until(
      () => document.getElementById("task-detail")!.textContent!.includes("观察陈旧"),
      "stream failure should be visible",
    );
    assert.equal(readDetail()?.canceledAt, canceledB.canceledAt);
    assert.equal(readDetail()?.stage, "running");
    assert.deepEqual(canceledIds, [a.taskId, b.taskId]);
    assert.equal(reads.mock.callCount(), 2, "GETs must use ordinary read generations");
    assert.equal(
      cancellations.mock.callCount(),
      2,
      "both actual cancel callbacks must use the modification-receipt path",
    );

    rejectReconnect = false;
    now = Date.parse("2026-10-31T02:30:00.000Z");
    const c: TaskSnapshot = {
      ...snapshot(),
      stage: "completed",
      result: { ok: true },
      termination: { terminatedAt: "2026-10-31T02:01:00.000Z" },
    };
    c.run = { ...c.run!, completedAt: c.termination!.terminatedAt };
    await open(c);
    const cancelControl = () =>
      document.querySelector<HTMLButtonElement>('#task-detail [data-action="cancel"]')!;
    assert.equal(cancelControl().disabled, false, "terminal Task still accepts first cancellation");
    assert.doesNotMatch(document.getElementById("task-detail")!.textContent!, /超时事实保留/);
    assert.equal(streams.get(c.taskId)!.closed, false);
    now = Date.parse("2026-10-31T04:00:00.000Z");
    emit(c, 31);
    await until(
      () => document.getElementById("task-detail")!.textContent!.includes("超时事实保留"),
      "time advances after Run termination rather than freezing at termination",
    );
    await cancel(c.taskId);
    const canceledC = {
      ...c,
      canceled: true,
      canceledAt: "2026-10-31T02:02:00.000Z",
      revision: "domain:32",
    };
    receipts.get(c.taskId)!(canceledC);
    await until(
      () => readDetail()?.canceledAt === canceledC.canceledAt && cancelControl().disabled,
      "terminal cancellation must be acknowledged and disable only further cancellations",
    );
    cancelControl().click();
    assert.deepEqual(canceledIds, [a.taskId, b.taskId, c.taskId]);
    assert.equal(readDetail()?.stage, "completed");
    assert.deepEqual(readDetail()?.result, c.result);
    assert.equal(streams.get(c.taskId)!.closed, false);
    now = Date.parse("2026-10-31T02:30:00.000Z");
    emit(canceledC, 33);
    await until(
      () => !document.getElementById("task-detail")!.textContent!.includes("超时事实保留"),
      "current time can roll back independently of termination and cancellation",
    );
    assert.equal(readDetail()?.stage, "completed");
    assert.equal(readDetail()?.canceled, true);
  } finally {
    window.dispatchEvent(new window.Event("pagehide"));
    for (const stream of streams.values()) stream.fail();
    await new Promise((resolve) => setTimeout(resolve, 10));
    Object.assign(globalThis, original);
    await dom.restore();
  }
});
