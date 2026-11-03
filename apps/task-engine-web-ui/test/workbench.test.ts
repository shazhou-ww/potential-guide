import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Observation, PublicEvent, TaskSnapshot } from "@potential-guide/task-protocol";
import { newIdentity } from "../src/model.js";
import type { Favorite } from "../src/server.js";
import { browserDom } from "./browser-dom.js";

async function until(check: () => boolean, reason: string): Promise<void> {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(reason);
}
test("workbench tabs, retained popup draft, all stars, independent execution directory and stream-only stop are wired", async () => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { window, document } = dom;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    Option: globalThis.Option,
  };
  const endpoint = { id: "demo", label: "demo", binding: "binding" };
  const bundle = { url: "https://example.test/task", digest: `sha256:${"a".repeat(64)}` };
  const makeTask = (): TaskSnapshot => ({
    bundle,
    taskId: newIdentity(),
    requestId: newIdentity(),
    seriesId: newIdentity(),
    stage: "running",
    receivedAt: "2026-10-31T00:00:00.000Z",
    eligibleAt: "2026-10-31T00:00:00.000Z",
    deadlineAt: "2026-10-31T00:00:01.000Z",
    timestamp: "2026-10-31T00:00:00.000Z",
    updatedAt: "2026-10-31T00:00:00.000Z",
    dataDomain: "domain",
    revision: "domain:10",
    canceled: false,
    run: { runId: newIdentity(), startedAt: "2026-10-31T00:00:00.000Z" },
  });
  const source = makeTask(),
    remote = makeTask();
  const records = new Map([
    [source.taskId, source],
    [remote.taskId, remote],
  ]);
  const parameters = {
    bundle,
    timeoutMs: 1000,
    text: "saved",
    metadata: { url: "https://example.invalid/floating", digest: "user-lock" },
  };
  let favorites: Favorite[] = [
    {
      id: "00000000-0000-0000-0000-000000000001",
      name: "旧模板",
      endpoint,
      parameters: { type: "echo", timeoutMs: 1000, text: "legacy" },
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      name: "已保存",
      endpoint,
      parameters,
      source: { taskId: source.taskId, requestId: source.requestId, receivedAt: source.receivedAt },
    },
  ];
  const calls: string[] = [],
    historySignals: AbortSignal[] = [];
  const streams = new Map<string, { emit(value: Observation): void; closed: boolean }>();
  const envelope = {
    revision: "domain:10",
    observedAt: "2026-10-31T00:00:00.000Z",
    expiresAt: "2100-01-01T00:00:00.000Z",
  };
  let failStar = false,
    historyPages = 0,
    streamStarts = 0,
    cancels = 0;
  let created: TaskSnapshot | undefined;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
  const summary = (task: TaskSnapshot) => ({
    bundle,
    taskId: task.taskId,
    requestId: task.requestId,
    seriesId: task.seriesId,
    type: "echo",
    version: "1",
    receivedAt: task.receivedAt,
    updatedAt: task.timestamp,
    eligibleAt: task.eligibleAt,
    deadlineAt: task.deadlineAt,
    scope: "scope",
    stage: task.stage,
    canceled: task.canceled,
    runId: task.run?.runId,
    state: {
      stage: task.stage,
      pending: false,
      timedOut: false,
      canceled: !!task.canceledAt,
      completed: task.stage === "completed",
      runFailed: false,
    },
  });
  const mockFetch: typeof fetch = async (input, options) => {
    const url = new URL(String(input), "http://ui.fixture"),
      method = options?.method ?? "GET";
    calls.push(`${method} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/bootstrap") return json({ csrf: "fixture", endpoints: [endpoint] });
    if (url.pathname === "/api/favorites") {
      if (method === "POST") {
        if (failStar)
          return json({ error: { code: "forbidden", message: "Original request denied" } }, 403);
        const body = JSON.parse(String(options?.body));
        const task = records.get(body.taskId)!;
        const favorite = {
          id: newIdentity(),
          name: "echo",
          endpoint,
          parameters,
          source: { taskId: task.taskId, requestId: task.requestId, receivedAt: task.receivedAt },
        };
        favorites.push(favorite);
        return json(favorite, 201);
      }
      return json(favorites);
    }
    if (url.pathname.startsWith("/api/favorites/")) {
      favorites = favorites.filter((item) => item.id !== url.pathname.split("/").at(-1));
      return json({ deleted: true });
    }
    const path = url.pathname.replace("/api/endpoints/demo", "");
    if (path === "/task-types")
      return json([
        {
          type: "echo",
          version: "1",
          revision: "a".repeat(64),
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" }, metadata: { type: "object" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      ]);
    if (path === "/tasks" && method === "GET")
      return json({ ...envelope, tasks: [summary(created ?? remote)] });
    if (path === "/tasks" && method === "POST") {
      created = { ...makeTask(), requestId: new Headers(options?.headers).get("Idempotency-Key")! };
      records.set(created.taskId, created);
      return json({ status: "accepted", requestId: created.requestId, taskId: created.taskId });
    }
    if (path === "/runs")
      return json({
        ...envelope,
        runs: [
          {
            runId: remote.run!.runId,
            type: "remote-execution",
            version: "1",
            startedAt: remote.receivedAt,
            startedSequence: 1,
            updatedAt: remote.updatedAt,
            scope: "scope",
            stage: "running",
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
          },
        ],
      });
    if (path === `/runs/${remote.run!.runId}`)
      return json({
        runId: remote.run!.runId,
        dataDomain: "domain",
        revision: "domain:10",
        timestamp: remote.timestamp,
        type: "echo",
        version: "1",
        scope: "scope",
        environment: "fixture",
        startedAt: remote.run!.startedAt,
        startedSequence: 1,
        updatedAt: remote.updatedAt,
        stage: "running",
      });
    const task = /^\/tasks\/([^/]+)(\/cancel)?$/.exec(path);
    if (task?.[1]) {
      if (task[2]) {
        cancels++;
        throw new Error("Observation/star actions must not cancel Tasks");
      }
      return records.has(task[1])
        ? json(records.get(task[1]))
        : json({ error: { code: "not_found", message: "source removed" } }, 404);
    }
    if (path.startsWith("/requests/"))
      return json({ requestId: path.split("/").at(-1), ...parameters });
    const id = url.searchParams.get("taskId") ?? url.searchParams.get("runId")!;
    if (path === "/event-history") {
      if (options?.signal) historySignals.push(options.signal);
      if (url.searchParams.has("cursor")) {
        historyPages++;
        return json({
          events: [],
          items: [],
          revision: "domain:10",
          watermark: 10,
          cursor: "resume-next",
        });
      }
      return json({
        events: [],
        items: [],
        revision: "domain:10",
        watermark: 10,
        cursor: "resume",
        next: "history-next",
      });
    }
    if (path === "/events") {
      streamStarts++;
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const state = {
        closed: false,
        emit(value: Observation) {
          assert.equal(state.closed, false);
          controller.enqueue(
            new TextEncoder().encode(`event: task.observation\ndata: ${JSON.stringify(value)}\n\n`),
          );
        },
      };
      const abort = () => {
        if (!state.closed) {
          state.closed = true;
          controller.error(new Error("stream released"));
        }
      };
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
        events: [],
        snapshots: records.has(id) ? [records.get(id)!] : [],
        watermark: 10,
        revision: "domain:10",
        cursor: "live",
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }
    throw new Error(`Unexpected ${path}`);
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
  const element = <T extends HTMLElement = HTMLElement>(selector: string) => {
    const found = document.querySelector(selector);
    assert.ok(found, selector);
    return found as unknown as T;
  };
  const click = (selector: string) => {
    if (selector.startsWith("#tab-"))
      document.querySelector<HTMLButtonElement>('[role="dialog"] [data-close]')?.click();
    const control = element<HTMLButtonElement>(selector);
    control.focus();
    control.click();
  };
  const named = (root: string, name: string) =>
    [...element(root).querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === name,
    )!;
  const key = (target: HTMLElement, value: string, shiftKey = false) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperties(event, { key: { value }, shiftKey: { value: shiftKey } });
    target.dispatchEvent(event);
  };
  const field = (name: string) => {
    const label = [...element("#form-fields").querySelectorAll<HTMLLabelElement>("label")].find(
      (label) => label.htmlFor && label.textContent === name,
    )!;
    return element<HTMLInputElement>(`#${label.htmlFor}`);
  };
  try {
    await import("../src/browser.js");
    await until(
      () => element("#directory").textContent!.includes(remote.taskId.slice(-8)),
      "Task directory must load by default",
    );
    assert.equal(document.querySelectorAll('[role="tab"]').length, 3);
    assert.equal(document.querySelector("#bar-toggle"), null);
    assert.equal(document.querySelectorAll('main [role="tabpanel"]:not([hidden])').length, 1);
    click("#tab-executions");
    await until(
      () => element("#execution-directory").textContent!.includes("remote-execution"),
      "Execution directory must be fetched without opening any Task",
    );
    assert.ok(element("#tasks").hidden);
    assert.equal(
      calls.some((call) => call.includes("/event-history")),
      false,
    );
    assert.ok(calls.some((call) => call.includes("/runs?")));
    click("#tab-tasks");
    const taskRow = element<HTMLTableRowElement>(
      `#directory tr[data-entity-id="${remote.taskId}"]`,
    );
    assert.equal(taskRow.cells[1]!.querySelector("button"), null);
    assert.equal(taskRow.querySelector('[data-action="详情"]'), null);
    assert.equal(
      taskRow.querySelector(".bundle-digest")?.textContent,
      `sha256:${bundle.digest.slice(7, 19)}`,
    );
    const star = taskRow.querySelector<HTMLButtonElement>(".star")!;
    star.click();
    await until(
      () => star.getAttribute("aria-pressed") === "true" && !star.disabled,
      "row star remains independent",
    );
    assert.equal(document.querySelector('[role="dialog"]'), null);
    star.click();
    await until(
      () => star.getAttribute("aria-pressed") === "false" && !star.disabled,
      "restore original stars",
    );
    taskRow.cells[1]!.click();
    await until(
      () => streams.has(remote.taskId) && !!document.querySelector("#task-detail"),
      "Task row opens the real task observer",
    );
    assert.match(element("#task-detail").textContent!, new RegExp(remote.taskId));
    assert.equal(
      element("#task-detail .bundle-reference").textContent,
      `${bundle.url}#${bundle.digest}`,
    );
    element<HTMLButtonElement>("#task-detail-sheet [data-close]").click();
    await until(() => document.activeElement === taskRow, "closing returns focus to the Task row");
    element<HTMLInputElement>("#history-type").value = bundle.digest;
    click("#new-task");
    field("Task Bundle 引用（URL#digest）").value = `${bundle.url}#${bundle.digest}`;
    field("超时预算 timeoutMs（毫秒）").value = "1000";
    const draft = element<HTMLTextAreaElement>("#form-fields textarea");
    draft.value = JSON.stringify({ text: "draft retained" });
    key(field("Task Bundle 引用（URL#digest）"), "Escape");
    await until(() => !document.querySelector("#create-dialog"), "Esc closes Dialog");
    await until(
      () => document.activeElement === element("#new-task"),
      "Esc returns focus to opener",
    );
    click("#tab-executions");
    click("#tab-tasks");
    click("#new-task");
    assert.ok(
      element("#form-fields textarea") === draft,
      "draft control identity survives close and tab switches",
    );
    assert.equal(draft.value, JSON.stringify({ text: "draft retained" }));
    assert.equal(element<HTMLInputElement>("#history-type").value, bundle.digest);
    const first = field("Task Bundle 引用（URL#digest）");
    const last = element<HTMLElement>("#create-dialog [data-close]");
    first.focus();
    key(first, "Tab", true);
    assert.ok(
      document.activeElement === last,
      "focus trap wraps to the visible close button, not closed template contents",
    );
    key(last, "Tab");
    assert.ok(document.activeElement === first, "Tab wraps to first dialog control");
    first.value = bundle.url;
    named("#create-actions", "提交任务").click();
    await until(
      () => element(".error-launcher").textContent !== "0",
      "incomplete Bundle reference is rejected locally",
    );
    element<HTMLButtonElement>(".error-launcher").click();
    await until(() => !!document.querySelector(".error-sheet"), "error panel opens");
    await until(
      () => element(".error-sheet").textContent!.includes("URL#Digest"),
      "validation error is logged",
    );
    element<HTMLButtonElement>(".error-sheet [data-close]").click();
    assert.equal(calls.filter((call) => call === "POST /api/endpoints/demo/tasks").length, 0);
    assert.equal(draft.value, JSON.stringify({ text: "draft retained" }));
    first.value = `${bundle.url}#${bundle.digest}`;
    await new Promise((resolve) => setTimeout(resolve, 310));
    named("#create-actions", "提交任务").click();
    await until(
      () => !!created && element("#batches").textContent!.includes("已确认"),
      "submission should retain its receipt in the create dialog",
    );
    assert.ok(document.querySelector("#create-dialog"));
    assert.equal(calls.filter((call) => call === "POST /api/endpoints/demo/tasks").length, 1);
    assert.match(element("#bar-count").textContent!, /1 项/);
    named("#batches", `打开 Task ${created!.taskId.slice(-8)}`).click();
    await until(() => streams.has(created!.taskId), "receipt opens the submitted Task");
    const id = created!.taskId;
    assert.equal(named("#task-detail", "暂停观察").dataset.glyphAction, "暂停观察");
    assert.equal(named("#task-detail", "暂停观察").querySelectorAll("svg").length, 1);
    assert.equal(
      document.querySelector('#task-detail [data-action="refresh"]')?.getAttribute("aria-label"),
      "重新观察",
    );
    assert.equal(document.querySelector('#task-detail [data-action="cancel"] svg'), null);
    named("#task-detail", "暂停观察").click();
    await until(() => streams.get(id)!.closed, "manual pause must release SSE");
    assert.equal(
      historySignals.at(-1)!.aborted,
      false,
      "pause must not retire the observer/history",
    );
    named("#task-detail", "下一页事件历史").click();
    await until(() => historyPages === 1, "history must paginate after manual pause");
    named("#task-detail", "重新观察").click();
    await until(() => streams.has(id) && !streams.get(id)!.closed, "manual resume must reconnect");
    const finishedAt = "2026-10-31T00:00:02.000Z";
    const completed: TaskSnapshot = {
      ...created!,
      stage: "completed",
      revision: "domain:20",
      result: { ok: false },
      timestamp: finishedAt,
      run: { ...created!.run!, completedAt: finishedAt },
      termination: { terminatedAt: finishedAt },
    };
    const event = (type: PublicEvent["type"], sequence: number, runId: string): PublicEvent => ({
      type,
      sequence,
      revision: `domain:${sequence}`,
      runId,
      scope: "scope",
      occurredAt: finishedAt,
      data: type === "run.completed" ? { result: { ok: false } } : {},
    });
    streams.get(id)!.emit({
      snapshots: [completed],
      events: [],
      watermark: 20,
      revision: "domain:20",
      cursor: "complete",
    });
    await until(
      () =>
        element("#task-detail .status").textContent === "已完成" &&
        element("#task-detail").textContent!.includes("当前已过截止时间，不代表结果逾期"),
      "completion is the primary status while the current time boundary remains in details",
    );
    assert.equal(streams.get(id)!.closed, false, "logical completion is not reclamation");
    streams.get(id)!.emit({
      snapshots: [{ ...completed, revision: "domain:21" }],
      events: [],
      watermark: 21,
      revision: "domain:21",
      cursor: "reclaimed",
    });
    assert.equal(
      streams.get(id)!.closed,
      false,
      "terminal Task remains observable for later cancellation",
    );
    named("#task-detail", "暂停观察").click();
    await until(() => streams.get(id)!.closed, "explicit pause only releases observation");
    const starts = streamStarts;
    named("#task-detail", "下一页事件历史").click();
    await until(() => historyPages === 2, "history must remain available after automatic end");
    assert.equal(historySignals.at(-1)!.aborted, false);
    assert.equal(streamStarts, starts);
    click("#tab-executions");
    const runId = remote.run!.runId;
    const runRow = element<HTMLTableRowElement>(
      `#execution-directory tr[data-entity-id="${runId}"]`,
    );
    assert.equal(runRow.cells[0]!.querySelector("button"), null);
    runRow.focus();
    key(runRow, " ");
    await until(() => streams.has(runId), "independent Run can open");
    streams.get(runId)!.emit({
      snapshots: [],
      events: [event("run.exited", 30, runId), event("run.reclaimed", 31, runId)],
      watermark: 31,
      revision: "domain:31",
      cursor: "exec-end",
    });
    await until(
      () =>
        streams.get(runId)!.closed &&
        element("#execution-detail").textContent!.includes("观察已结束"),
      "Execution end must handle observations with no Task snapshots",
    );
    assert.ok(calls.some((call) => call.includes(`/tasks?runId=${runId}`)));
    click("#tab-tasks");
    const only = element<HTMLInputElement>("#only-favorites");
    only.click();
    await until(
      () => element("#directory").textContent!.includes(source.taskId.slice(-8)),
      "all stored stars must include off-page Task",
    );
    assert.equal(
      element("#directory").textContent!.includes("旧模板"),
      false,
      "legacy recipes are not fake tasks",
    );
    records.delete(source.taskId);
    named("#history-actions", "重新查询").click();
    await until(
      () => element("#directory").textContent!.includes("来源已清理"),
      "retained recipe must show removed source",
    );
    named("#directory", "查看来源 / 模板").click();
    await until(
      () =>
        document.querySelector("#task-detail")?.textContent?.includes("本机保存的完整参数模板") ===
        true,
      "cleaned source opens a template, not an empty Task",
    );
    assert.match(element("#task-detail").textContent!, /user-lock/);
    named("#task-detail", "★").click();
    await until(() => favorites.length === 1, "unstar should remove only local star");
    assert.equal(cancels, 0);
    document.querySelector<HTMLButtonElement>("#task-detail-sheet [data-close]")!.click();
    only.click();
    await until(
      () => element("#directory").querySelector(".star") !== null,
      "normal Task directory returns",
    );
    failStar = true;
    element<HTMLButtonElement>("#directory .star").click();
    await until(
      () => Number(element(".error-launcher").textContent) > 0,
      "original-request denial must remain visible",
    );
    element<HTMLButtonElement>(".error-launcher").click();
    await until(() => !!document.querySelector(".error-sheet"), "denial appears in error log");
    await until(() => element(".error-sheet").textContent!.includes("403"), "denial is logged");
    assert.equal(favorites.length, 1);
    assert.equal(element("#directory .star").getAttribute("aria-pressed"), "false");
    element<HTMLButtonElement>(".error-sheet [data-close]").click();

    click("#new-task");
    field("Task Bundle 引用（URL#digest）").value = `${bundle.url}#${bundle.digest}`;
    field("超时预算 timeoutMs（毫秒）").value = "1000";
    const batchInput = element<HTMLTextAreaElement>("#form-fields textarea");
    batchInput.value = JSON.stringify({ text: "batch first" });
    named("#create-actions", "加入批量").click();
    await until(
      () =>
        element("#batches").textContent!.includes("batch first") &&
        !named("#create-actions", "加入批量").disabled,
      "first draft is queued",
    );
    batchInput.value = JSON.stringify({ text: "batch second" });
    named("#create-actions", "加入批量").click();
    await until(
      () => element("#batches").textContent!.includes("batch second"),
      "second draft is queued",
    );
    const queued = [...element("#batches").querySelectorAll<HTMLElement>(".receipt")].filter(
      (row) => row.querySelector('[data-action="下移"]'),
    );
    assert.equal(queued.length, 2);
    assert.match(queued[0]!.textContent!, /batch first/);
    assert.doesNotMatch(queued[0]!.textContent!, /batch second/);
    assert.match(queued[1]!.textContent!, /batch second/);
    const before = calls.filter((call) => call === "POST /api/endpoints/demo/tasks").length;
    assert.equal(before, 1, "adding drafts must not submit");
    const draftIds = queued.map((row) => row.dataset.key);
    element<HTMLButtonElement>("#create-dialog [data-close]").click();
    click("#new-task");
    assert.equal(element<HTMLTextAreaElement>("#form-fields textarea").value, batchInput.value);
    assert.deepEqual(
      [...element("#batches").querySelectorAll<HTMLElement>(".receipt")]
        .filter((row) => row.querySelector('[data-action="下移"]'))
        .map((row) => row.dataset.key),
      draftIds,
      "reopening retains batch identities",
    );
    batchInput.value = JSON.stringify({ text: "direct alongside batch" });
    named("#create-actions", "提交任务").click();
    await until(
      () =>
        calls.filter((call) => call === "POST /api/endpoints/demo/tasks").length === before + 1 &&
        !element("#create-actions").querySelector('[data-busy="true"]'),
      "direct submit does not send pending batch",
    );
    assert.equal(element("#batches").querySelectorAll('[data-action="下移"]').length, 2);
    named("#batches", "提交此批").click();
    await until(
      () =>
        calls.filter((call) => call === "POST /api/endpoints/demo/tasks").length === before + 3 &&
        !element("#batches").querySelector('[data-busy="true"]'),
      "batch sends both entries once",
    );
    assert.equal(element("#batches").querySelector('[data-action="提交此批"]'), null);
    assert.ok(document.querySelector("#create-dialog"), "batch submit keeps the form open");
    assert.equal(batchInput.value, JSON.stringify({ text: "direct alongside batch" }));
  } finally {
    window.dispatchEvent(new window.Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    Object.assign(globalThis, previous);
    await dom.restore();
  }
});
