import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { RunPage, RunSummary, TaskPage, TaskSummary } from "@potential-guide/task-protocol";
import { newIdentity } from "../src/model.js";
import { browserDom } from "./browser-dom.js";

async function until(check: () => boolean, message: string): Promise<void> {
  const end = performance.now() + 10000;
  while (performance.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

test("actual browser atomically samples paginated windows, pauses hidden pages and hands complete baselines to SSE", async () => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { document, window } = dom;
  const nativeFetch = globalThis.fetch;
  const now = new Date().toISOString();
  const task = (): TaskSummary => {
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
      deadlineAt: new Date(Date.now() + 60000).toISOString(),
      state: {
        stage: "initial",
        canceled: false,
        pending: false,
        timedOut: false,
        completed: false,
        runFailed: false,
      },
    };
  };
  const a = task(),
    b = task(),
    c = task(),
    d = task(),
    e = task(),
    f = task(),
    other = task();
  const run = (): RunSummary => ({
    runId: newIdentity(),
    type: "echo",
    version: "1",
    scope: "scope",
    stage: "running",
    startedAt: now,
    updatedAt: now,
    startedSequence: 1,
    stopRequested: false,
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
  const oldRun = run(),
    newRun = run();
  const common = (revision: string, next?: string) => ({
    revision,
    observedAt: now,
    expiresAt: new Date(Date.parse(now) + 60000).toISOString(),
    ...(next ? { next } : {}),
  });
  const taskPage = (tasks: TaskSummary[], revision: string, next?: string): TaskPage => ({
    ...common(revision, next),
    tasks,
    items: tasks,
  });
  const runPage = (runs: RunSummary[], revision: string, next?: string): RunPage => ({
    ...common(revision, next),
    runs,
    items: runs,
  });
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    });
  const reads: URL[] = [];
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  let first = true,
    holdSecond = true,
    holdFirst = false,
    runReads = 0;
  let release: (() => void) | undefined;
  let heldSignal: AbortSignal | null | undefined;
  const visibility = (hidden: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    document.dispatchEvent(new window.Event("visibilitychange"));
  };
  const ids = () =>
    [...document.querySelectorAll<HTMLElement>("#directory tbody tr")].map((row) =>
      row.dataset.key?.slice(-26),
    );
  const click = (selector: string) => {
    const control = document.querySelector<HTMLButtonElement>(selector)!;
    if (selector.startsWith("#tab-")) control.focus();
    control.click();
  };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), "http://ui.fixture");
    if (url.pathname === "/api/bootstrap")
      return json({
        csrf: "fixture-session",
        endpoints: [
          { id: "one", label: "one", binding: "one-binding" },
          { id: "other", label: "other", binding: "other-binding" },
        ],
      });
    if (url.pathname === "/api/favorites") return json([]);
    reads.push(url);
    const path = url.pathname.replace(/^\/api\/endpoints\/(one|other)/, "");
    const endpoint = url.pathname.includes("/other/") ? "other" : "one";
    if (path === "/tasks") {
      if (endpoint === "other") return json(taskPage([other], "other:1"));
      const cursor = url.searchParams.get("cursor");
      if (cursor === "old-2") return json(taskPage([b], "domain:1", "old-3"));
      if (cursor === "new-3") return json(taskPage([e], "domain:2"));
      if (cursor === "new-2") {
        if (holdSecond) {
          holdSecond = false;
          return new Promise<Response>((resolve) => {
            release = () => resolve(json(taskPage([d], "domain:2", "new-3")));
          });
        }
        return json(taskPage([d], "domain:2", "new-3"));
      }
      assert.equal(cursor, null, "fresh sampling never reuses an old snapshot cursor");
      if (first) {
        first = false;
        return json(taskPage([a], "domain:1", "old-2"));
      }
      if (holdFirst) {
        holdFirst = false;
        heldSignal = options?.signal;
        return new Promise<Response>((resolve) => {
          release = () => resolve(json(taskPage([a], "domain:4", "late")));
        });
      }
      return json(taskPage([c], "domain:2", "new-2"));
    }
    if (path === "/runs") {
      runReads++;
      return json(
        runReads === 1 ? runPage([oldRun], "other:1", "run-next") : runPage([newRun], "other:2"),
      );
    }
    if (path === "/tasks/events" || path === "/runs/events") {
      let closed = false;
      let streamController: ReadableStreamDefaultController<Uint8Array>;
      const abort = () => {
        if (!closed) {
          closed = true;
          streamController.close();
        }
      };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          streams.set(`${endpoint}${path}`, controller);
          controller.enqueue(new TextEncoder().encode(": connected\n\n"));
          options?.signal?.addEventListener("abort", abort, { once: true });
          if (options?.signal?.aborted) abort();
        },
        cancel() {
          closed = true;
          options?.signal?.removeEventListener("abort", abort);
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error(`Unexpected browser route ${url}`);
  };
  try {
    await import("../src/browser.js");
    await until(() => ids().includes(a.taskId), "initial paginated baseline");
    assert.match(document.getElementById("directory")!.textContent!, /分页近实时/);
    visibility(true);
    click('#directory button[data-action="目录下一页（原过滤条件）"]');
    await until(() => ids().length === 2, "manual paging retains the original baseline");
    const input = document.getElementById("history-type") as HTMLInputElement;
    input.value = "unapplied";
    input.focus();
    const container = document.getElementById("directory")!;
    container.scrollTop = 77;
    const count = reads.length;
    await new Promise((resolve) => setTimeout(resolve, 5100));
    assert.equal(reads.length, count, "hidden pages do not sample");
    visibility(false);
    await until(() => !!release, "returning to visible starts a fresh multi-page sample");
    assert.deepEqual(ids(), [a.taskId, b.taskId], "new first page is not published alone");
    assert.equal(streams.has("one/tasks/events"), false);
    release!();
    release = undefined;
    await until(() => ids().includes(d.taskId), "the complete new window replaces old rows");
    assert.deepEqual(ids(), [c.taskId, d.taskId]);
    assert.equal(input.value, "unapplied");
    assert.equal(document.activeElement, input);
    assert.equal(container.scrollTop, 77);
    assert.equal(
      reads.some((url) => url.searchParams.has("bundleDigest")),
      false,
    );
    click('#directory button[data-action="目录下一页（原过滤条件）"]');
    await until(
      () => streams.has("one/tasks/events"),
      "complete paginated baseline switches to SSE",
    );
    const subscription = reads.find((url) => url.pathname.endsWith("/tasks/events"))!;
    assert.equal(subscription.searchParams.get("fromRevision"), "domain:2");
    streams.get("one/tasks/events")!.enqueue(
      new TextEncoder().encode(
        `id: domain:3\nevent: task.collection\ndata: ${JSON.stringify({
          revision: "domain:3",
          changes: [{ kind: "joined", id: f.taskId, summary: f }],
        })}\n\n`,
      ),
    );
    await until(() => ids().includes(f.taskId), "full collection still applies SSE deltas");

    input.value = "";
    click('#history-actions button[data-action="重新查询"]');
    await until(
      () => ids().length === 1 && ids()[0] === c.taskId,
      "manual requery starts a new partial window",
    );
    holdFirst = true;
    visibility(true);
    visibility(false);
    await until(() => !!release, "hold a refresh while switching endpoints");
    const endpoint = document.getElementById("endpoint") as HTMLSelectElement;
    endpoint.value = "other";
    endpoint.dispatchEvent(new window.Event("change", { bubbles: true }));
    await until(() => ids().includes(other.taskId), "new endpoint owns the view");
    assert.equal(heldSignal?.aborted, true);
    release!();
    release = undefined;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(
      ids(),
      [other.taskId],
      "late old-endpoint sample cannot replace the new query",
    );

    click("#tab-executions");
    await until(
      () =>
        runReads === 1 &&
        document
          .getElementById("execution-directory")!
          .textContent!.includes(oldRun.runId.slice(-8)),
      "Run baseline is paginated",
    );
    visibility(true);
    visibility(false);
    await until(
      () => streams.has("other/runs/events"),
      "Run sample becoming complete switches to SSE",
    );
    assert.equal(runReads, 2);
    assert.ok(
      document.getElementById("execution-directory")!.textContent!.includes(newRun.runId.slice(-8)),
    );
    assert.equal(
      reads.find((url) => url.pathname.endsWith("/runs/events"))!.searchParams.get("fromRevision"),
      "other:2",
    );
  } finally {
    release?.();
    window.dispatchEvent(new window.Event("pagehide"));
    globalThis.fetch = nativeFetch;
    await dom.restore();
  }
});
