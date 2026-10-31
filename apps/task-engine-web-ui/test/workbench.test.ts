import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Observation, PublicEvent, TaskSnapshot } from "@potential-guide/task-protocol";
import { parseHTML } from "linkedom";
import { newIdentity } from "../src/model.js";
import type { Favorite } from "../src/server.js";

async function until(check: () => boolean, reason: string): Promise<void> {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(reason);
}
test("workbench tabs, retained popup draft, all stars, independent execution directory and stream-only stop are wired", async () => {
  const { window, document } = parseHTML(
    await readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  );
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    Option: globalThis.Option,
  };
  const selectValue = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
  const oldFocus = window.HTMLElement.prototype.focus,
    oldScroll = window.HTMLElement.prototype.scrollIntoView;
  const tabIndex = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "tabIndex");
  Object.defineProperty(window.HTMLElement.prototype, "tabIndex", {
    configurable: true,
    get(this: HTMLElement) {
      const value = this.getAttribute("tabindex");
      return value !== null
        ? Number(value)
        : ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(this.tagName)
          ? 0
          : -1;
    },
    set(this: HTMLElement, value: number) {
      this.setAttribute("tabindex", String(value));
    },
  });
  let active: Element | null = null;
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => active });
  window.HTMLElement.prototype.focus = function () {
    active = this;
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get(this: HTMLSelectElement) {
      return [...this.options].find((item) => item.selected)?.value ?? "";
    },
    set(this: HTMLSelectElement, value: string) {
      for (const option of this.options) option.selected = option.value === value;
    },
  });
  const endpoint = { id: "demo", label: "demo", binding: "binding" };
  const makeTask = (): TaskSnapshot => ({
    taskId: newIdentity(),
    requestId: newIdentity(),
    seriesId: newIdentity(),
    stage: "running",
    receivedAt: "2026-10-31T00:00:00.000Z",
    eligibleAt: "2026-10-31T00:00:00.000Z",
    deadlineAt: "2026-10-31T00:00:01.000Z",
    timestamp: "2026-10-31T00:00:00.000Z",
    preparation: { startedAt: "2026-10-31T00:00:00.000Z", completedAt: "2026-10-31T00:00:00.000Z" },
    allocation: { boundAt: "2026-10-31T00:00:00.000Z" },
    execution: { executionId: newIdentity(), startedAt: "2026-10-31T00:00:00.000Z" },
  });
  const source = makeTask(),
    remote = makeTask();
  const records = new Map([
    [source.taskId, source],
    [remote.taskId, remote],
  ]);
  const parameters = {
    type: "echo",
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
    taskId: task.taskId,
    requestId: task.requestId,
    seriesId: task.seriesId,
    type: "echo",
    version: "1",
    receivedAt: task.receivedAt,
    updatedAt: task.timestamp,
    state: {
      stage: task.stage,
      pending: false,
      timedOut: false,
      canceled: !!task.canceledAt,
      completed: task.stage === "completed",
      executionFailed: false,
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
      return json(created, 202);
    }
    if (path === "/executions")
      return json({
        ...envelope,
        executions: [
          {
            executionId: remote.execution!.executionId,
            type: "remote-execution",
            version: "1",
            startedAt: remote.receivedAt,
            state: {
              running: true,
              completed: false,
              failed: false,
              reclaimed: false,
              sealed: false,
            },
          },
        ],
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
    const id = url.searchParams.get("taskId") ?? url.searchParams.get("executionId")!;
    if (path === "/event-history") {
      if (options?.signal) historySignals.push(options.signal);
      if (url.searchParams.has("cursor")) {
        historyPages++;
        return json({ events: [], watermark: 10, cursor: "resume-next" });
      }
      return json({ events: [], watermark: 10, cursor: "resume", next: "history-next" });
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
    assert.equal(document.querySelectorAll('[role="tab"]').length, 2);
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
    assert.ok(calls.some((call) => call.includes("/executions?")));
    click("#tab-tasks");
    element<HTMLInputElement>("#history-type").value = "echo";
    click("#new-task");
    const type = element<HTMLSelectElement>("#type");
    type.value = "echo";
    type.dispatchEvent(new window.Event("change"));
    field("超时预算 timeoutMs（毫秒）").value = "1000";
    field("text").value = "draft retained";
    const draft = field("text");
    key(type, "Escape");
    assert.ok(element("#create-dialog").hidden);
    assert.ok(active === element("#new-task"), "Esc returns focus to opener");
    click("#tab-executions");
    click("#tab-tasks");
    click("#new-task");
    assert.ok(field("text") === draft, "draft control identity survives close and tab switches");
    assert.equal(draft.value, "draft retained");
    assert.equal(element<HTMLInputElement>("#history-type").value, "echo");
    for (const control of element("#create-dialog").querySelectorAll<HTMLElement>(
      "button,input,select,textarea,summary",
    ))
      control.tabIndex = 0;
    const first = element<HTMLElement>("#create-dialog [data-close]");
    first.focus();
    key(first, "Tab", true);
    assert.ok(
      active === element("#legacy-templates > summary"),
      "focus trap includes visible legacy summary, not hidden template buttons",
    );
    key(active as unknown as HTMLElement, "Tab");
    assert.ok(active === first, "Tab wraps to first dialog control");
    named("#create-actions", "提交任务").click();
    await until(
      () => !!created && streams.has(created.taskId),
      "submission should select the new Task",
    );
    assert.ok(element("#create-dialog").hidden);
    assert.equal(calls.filter((call) => call === "POST /api/endpoints/demo/tasks").length, 1);
    assert.match(element("#bar-count").textContent!, /1 项/);
    const id = created!.taskId;
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
      result: { ok: false },
      timestamp: finishedAt,
      execution: { ...created!.execution!, completedAt: finishedAt },
      termination: { terminatedAt: finishedAt },
    };
    const event = (
      type: PublicEvent["type"],
      sequence: number,
      executionId: string,
    ): PublicEvent => ({
      type,
      sequence,
      executionId,
      scope: "scope",
      occurredAt: finishedAt,
      data: type === "execution.completed" ? { result: { ok: false } } : {},
    });
    streams.get(id)!.emit({
      snapshots: [completed],
      events: [event("execution.completed", 20, completed.execution!.executionId)],
      watermark: 20,
      cursor: "complete",
    });
    await until(
      () => element("#task-detail").textContent!.includes("已完成 · 已超时"),
      "late completion must retain timeout",
    );
    assert.equal(streams.get(id)!.closed, false, "logical completion is not reclamation");
    streams.get(id)!.emit({
      snapshots: [completed],
      events: [event("execution.reclaimed", 21, completed.execution!.executionId)],
      watermark: 21,
      cursor: "reclaimed",
    });
    await until(
      () => streams.get(id)!.closed && element("#task-detail").textContent!.includes("观察已结束"),
      "completed and reclaimed should end SSE",
    );
    const starts = streamStarts;
    named("#task-detail", "下一页事件历史").click();
    await until(() => historyPages === 2, "history must remain available after automatic end");
    assert.equal(historySignals.at(-1)!.aborted, false);
    assert.equal(streamStarts, starts);
    click("#tab-executions");
    named("#execution-directory", "remote-execution").click();
    const executionId = remote.execution!.executionId;
    await until(() => streams.has(executionId), "independent Execution can open");
    streams.get(executionId)!.emit({
      snapshots: [],
      events: [
        event("execution.completed", 30, executionId),
        event("execution.reclaimed", 31, executionId),
      ],
      watermark: 31,
      cursor: "exec-end",
    });
    await until(
      () =>
        streams.get(executionId)!.closed &&
        element("#execution-detail").textContent!.includes("观察已结束"),
      "Execution end must handle observations with no Task snapshots",
    );
    assert.ok(calls.some((call) => call.includes(`/tasks?executionId=${executionId}`)));
    click("#tab-tasks");
    const only = element<HTMLInputElement>("#only-favorites");
    only.checked = true;
    only.dispatchEvent(new window.Event("change"));
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
      () => element("#task-detail").textContent!.includes("本机保存的完整参数模板"),
      "cleaned source opens a template, not an empty Task",
    );
    assert.match(element("#task-detail").textContent!, /user-lock/);
    named("#task-detail", "★").click();
    await until(() => favorites.length === 1, "unstar should remove only local star");
    assert.equal(cancels, 0);
    only.checked = false;
    only.dispatchEvent(new window.Event("change"));
    await until(
      () => element("#directory").querySelector(".star") !== null,
      "normal Task directory returns",
    );
    failStar = true;
    element<HTMLButtonElement>("#directory .star").click();
    await until(
      () => element("#notice").textContent!.includes("403"),
      "original-request denial must remain visible",
    );
    assert.equal(favorites.length, 1);
    assert.equal(element("#directory .star").getAttribute("aria-pressed"), "false");
  } finally {
    window.dispatchEvent(new window.Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    Object.assign(globalThis, previous);
    if (selectValue)
      Object.defineProperty(window.HTMLSelectElement.prototype, "value", selectValue);
    window.HTMLElement.prototype.focus = oldFocus;
    window.HTMLElement.prototype.scrollIntoView = oldScroll;
    if (tabIndex) Object.defineProperty(window.HTMLElement.prototype, "tabIndex", tabIndex);
    else Reflect.deleteProperty(window.HTMLElement.prototype, "tabIndex");
  }
});
