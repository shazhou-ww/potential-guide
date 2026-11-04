import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { RunLogPage, RunSnapshot } from "@potential-guide/task-protocol";
import { defaultRunLogLimits } from "@potential-guide/task-protocol";
import { newIdentity } from "../src/model.js";
import { consumeRunLogSse, RunLogWindow } from "../src/run-logs.js";
import { browserDom } from "./browser-dom.js";

const time = "2026-11-03T00:00:00.000Z";
function page(id: string, sequences: number[], extra: Partial<RunLogPage> = {}): RunLogPage {
  return {
    limits: defaultRunLogLimits,
    runId: id,
    entries: sequences.map((sequence) => ({
      runId: id,
      sequence,
      receivedAt: time,
      level: "info",
      message: `<script>${id}:${sequence}</script>`,
      fields: { selected: id },
    })),
    state: {
      availability: "available",
      completeness: "open",
      dropped: 0,
      firstSequence: 1,
      lastSequence: sequences.at(-1) ?? 0,
    },
    nextSequence: sequences.at(-1) ?? 0,
    hasMore: false,
    gap: false,
    ...extra,
  };
}
test("Run log windows reject foreign Runs, deduplicate reconnects, show gaps and bound count/bytes", () => {
  const logs = new RunLogWindow("a", 3, 1000);
  logs.accept(page("a", [1, 2]));
  logs.accept(page("a", [2, 3]));
  assert.deepEqual(
    logs.entries.map((entry) => entry.sequence),
    [1, 2, 3],
  );
  logs.accept(page("a", [5]));
  assert.equal(logs.gap, true);
  assert.equal(logs.trimmed, true);
  assert.equal(logs.entries.length, 3);
  assert.throws(() => logs.accept(page("b", [6])), /其他 Run/);
  assert.ok(logs.entries.every((entry) => entry.runId === "a"));
  logs.accept(page("a", [100], { hasMore: true }), true);
  assert.equal(logs.entries.length, 1);
  assert.equal(logs.sequence, 100);
  assert.equal(logs.hasMore, true);
  const bytes = new RunLogWindow("a", 300, 100);
  bytes.accept(page("a", [1]));
  assert.equal(bytes.entries.length, 0);
  assert.equal(bytes.trimmed, true);
});
test("fragmented SSE preserves complete frames, reports transport/storage errors and bounds partial frames", async () => {
  const value = page("a", [1]);
  const text = `event: run.logs\ndata: ${JSON.stringify(value)}\n\n`;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text.slice(0, 40)));
        controller.enqueue(new TextEncoder().encode(text.slice(40)));
        controller.close();
      },
    }),
  );
  const pages: RunLogPage[] = [];
  await consumeRunLogSse(response, (page) => pages.push(page));
  assert.deepEqual(pages, [value]);
  await assert.rejects(
    consumeRunLogSse(new Response(text.slice(0, -1)), () => {}),
    /不完整/,
  );
  await assert.rejects(
    consumeRunLogSse(
      new Response(
        `event: error\ndata: ${JSON.stringify({ error: { code: "log_storage_unavailable", message: "disk offline" } })}\n\n`,
      ),
      () => {},
    ),
    /disk offline/,
  );
  await assert.rejects(
    consumeRunLogSse(new Response("x".repeat(2_097_153)), () => {}),
    /2 MiB/,
  );
});
async function until(check: () => boolean, reason: string): Promise<void> {
  const end = performance.now() + 5000;
  while (!check()) {
    if (performance.now() > end) assert.fail(reason);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
test("Run detail Logs follow/pause/reconnect/history are independent, switched Runs reject late history and browser memory stays bounded", async () => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { document } = dom;
  const originalFetch = globalThis.fetch;
  const a = newIdentity(),
    b = newIdentity();
  let resolveA!: (response: Response) => void;
  let emit: ((page: RunLogPage) => void) | undefined;
  const resumed: number[] = [];
  let historyReads = 0;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), "http://ui.fixture");
    if (url.pathname === "/api/bootstrap")
      return json({
        csrf: "fixture",
        endpoints: [{ id: "demo", label: "fixture", binding: "fixture" }],
      });
    if (url.pathname === "/api/favorites") return json([]);
    const path = url.pathname.replace("/api/endpoints/demo", "");
    if (path === "/runs") {
      const runs = [a, b].map((runId) => ({
        runId,
        type: "fixture",
        version: "2",
        stage: "running",
        startedAt: time,
        updatedAt: time,
        state: {
          running: true,
          completed: false,
          failed: false,
          stopping: false,
          stopped: false,
          reclaimed: false,
          sealed: false,
        },
      }));
      return json({ runs, items: runs, revision: "domain:10", observedAt: time, expiresAt: time });
    }
    for (const id of [a, b]) {
      if (path === `/runs/${id}`)
        return json({
          runId: id,
          dataDomain: "domain",
          revision: "domain:10",
          timestamp: time,
          type: "fixture",
          version: "2",
          scope: "scope",
          environment: "fixture",
          startedAt: time,
          startedSequence: 1,
          updatedAt: time,
          stage: "running",
        } satisfies RunSnapshot);
      if (path === `/runs/${id}/logs`) {
        if (id === a)
          return new Promise((resolve) => {
            resolveA = resolve;
          });
        historyReads++;
        if (historyReads > 2)
          return json(
            { error: { code: "unsupported_version", message: "Run Logs unsupported." } },
            503,
          );
        if (historyReads > 1) return json(page(b, [3], { hasMore: false }));
        return json(page(b, [1], { hasMore: true }));
      }
      if (path === `/runs/${id}/logs/events`) {
        resumed.push(Number(url.searchParams.get("afterSequence")));
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              emit = (value) =>
                controller.enqueue(
                  new TextEncoder().encode(`event: run.logs\ndata: ${JSON.stringify(value)}\n\n`),
                );
              options?.signal?.addEventListener("abort", () => controller.close(), { once: true });
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
    }
    if (path === "/events")
      return new Response(
        new ReadableStream({
          start(controller) {
            options?.signal?.addEventListener("abort", () => controller.close(), { once: true });
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    return json(
      { error: { code: "forbidden", message: "Lifecycle history is not authorized." } },
      403,
    );
  };
  const detail = () => document.getElementById("execution-detail")!;
  const action = (name: string) =>
    detail().querySelector<HTMLButtonElement>(`button[data-action="${name}"]`)!;
  async function open(id: string) {
    document.getElementById("tab-executions")!.click();
    document.querySelector<HTMLButtonElement>("#execution-actions button")!.click();
    await until(
      () => !!document.querySelector(`#execution-directory tr[data-entity-id="${id}"]`),
      "Run row ready",
    );
    document.querySelector<HTMLElement>(`#execution-directory tr[data-entity-id="${id}"]`)!.click();
    await until(() => !!detail()?.textContent?.includes(id), "Run identity displayed");
  }
  try {
    await import("../src/browser.js");
    await until(
      () => document.getElementById("notice")?.textContent?.includes("当前目标：fixture") === true,
      "browser ready",
    );
    await open(a);
    await until(() => !!resolveA, "A history request pending");
    document.querySelector<HTMLButtonElement>('[role="dialog"] [data-close]')!.click();
    await open(b);
    await until(() => !!emit && resumed.length === 1, "B follows independently");
    resolveA(json(page(a, [1])));
    emit!(page(b, [2], { hasMore: true }));
    await until(() => detail().textContent!.includes(`${b}:2`), "B stream rendered");
    assert.equal(detail().textContent!.includes(`${a}:1`), false);
    assert.equal(detail().querySelector(".run-logs script"), null, "Diagnostic text is not HTML.");
    document.querySelector<HTMLButtonElement>(".error-launcher")!.click();
    await until(
      () =>
        document
          .querySelector(".error-sheet")
          ?.textContent?.includes("Lifecycle history is not authorized") === true,
      "history denial appears in error center",
    );
    document.querySelector<HTMLButtonElement>(".error-sheet [data-close]")!.click();
    action("暂停日志跟随").click();
    await until(() => detail().textContent!.includes("跟随已暂停"), "pause visible");
    action("下一页日志").click();
    await until(
      () => detail().textContent!.includes(`${b}:3`),
      "history paging remains available while paused",
    );
    assert.equal(
      detail().textContent!.includes(`${b}:1`),
      false,
      "History replaces its bounded page.",
    );
    action("跟随 / 重新连接日志").click();
    await until(() => resumed.length === 2, "explicit reconnect");
    assert.deepEqual(resumed, [1, 3]);
    emit!(
      page(
        b,
        Array.from({ length: 310 }, (_, index) => index + 4),
      ),
    );
    await until(
      () => detail().textContent!.includes("浏览器窗口已按 300 条"),
      "bounded viewport warning",
    );
    assert.equal(detail().querySelectorAll(".run-log-entry").length, 300);
    emit!(
      page(b, [], {
        nextSequence: 313,
        gap: true,
        state: {
          availability: "expired",
          completeness: "unknown",
          dropped: 10,
          firstSequence: 314,
          lastSequence: 313,
        },
      }),
    );
    await until(() => detail().textContent!.includes("日志已过期"), "expired status is explicit");
    assert.match(detail().textContent!, /日志游标存在缺口/);
    assert.match(detail().textContent!, /完整性未知/);
    action("暂停日志跟随").click();
    action("从头读取日志").click();
    document.querySelector<HTMLButtonElement>(".error-launcher")!.click();
    await until(
      () =>
        document
          .querySelector(".error-sheet")
          ?.textContent?.includes("此服务不支持 Run Logs 接口") === true,
      "Unsupported host is distinct from storage failure.",
    );
  } finally {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    globalThis.fetch = originalFetch;
    await dom.restore();
  }
});
