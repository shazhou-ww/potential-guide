import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Observation, RunSnapshot } from "@potential-guide/task-protocol";
import { newIdentity } from "../src/model.js";
import { browserDom } from "./browser-dom.js";

async function until(check: () => boolean, reason: string): Promise<void> {
  const end = performance.now() + 3000;
  while (performance.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(reason);
}

test("Run diagnostics use the independent snapshot without history or Task access and retain keyed disclosures", async () => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { window, document } = dom;
  const originalFetch = globalThis.fetch;
  const at = "2026-11-03T00:00:00.000Z";
  const runId = newIdentity();
  let snapshot: RunSnapshot = {
    runId,
    dataDomain: "domain",
    revision: "domain:10",
    timestamp: at,
    type: "fixture",
    version: "1",
    scope: "scope",
    environment: "fixture",
    startedAt: at,
    startedSequence: 1,
    updatedAt: at,
    stage: "running",
    progress: { stage: "execution", message: "Waiting for physical exit" },
    outcome: { kind: "completed", result: false, occurredAt: at },
    result: false,
  };
  let emit: ((value: Observation) => void) | undefined;
  const denied = new Set<string>();
  let allowRunListing = true;
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
    if (path === `/runs/${snapshot.runId}`) return json(snapshot);
    if (path === "/runs" && allowRunListing) {
      const runs = [
        {
          ...snapshot,
          ...(snapshot.stage === "failed" ? { failedAt: at } : {}),
          state: {
            running: snapshot.stage === "running",
            completed: false,
            failed: snapshot.stage === "failed",
            stopping: snapshot.stage === "stopping",
            stopped: false,
            reclaimed: !!snapshot.reclaimedAt,
            sealed: false,
          },
        },
      ];
      return json({
        runs,
        items: runs,
        revision: snapshot.revision,
        observedAt: at,
        expiresAt: "2026-11-03T01:00:00.000Z",
      });
    }
    if (["/tasks", "/runs", "/event-history"].includes(path)) {
      denied.add(path);
      return json({ error: { code: "forbidden", message: `No access to ${path}` } }, 403);
    }
    if (path === "/events") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          emit = (value) =>
            controller.enqueue(
              new TextEncoder().encode(
                `event: task.observation\ndata: ${JSON.stringify(value)}\n\n`,
              ),
            );
          options?.signal?.addEventListener("abort", () => controller.close(), { once: true });
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error(`Unexpected browser route ${path}`);
  };
  const detail = () => document.getElementById("execution-detail")!;
  const read = (key: string) => {
    const value = detail()?.querySelector(`[data-key="${key}"] pre`)?.textContent;
    return value === undefined ? undefined : JSON.parse(value!);
  };
  const openRun = async () => {
    allowRunListing = true;
    document.getElementById("tab-executions")!.click();
    const refresh = document.querySelector<HTMLButtonElement>("#execution-actions button")!;
    await until(() => !refresh.disabled, "Run query should be ready");
    refresh.click();
    await until(
      () => !!document.querySelector(`#execution-directory tr[data-entity-id="${snapshot.runId}"]`),
      "Run should be listed",
    );
    allowRunListing = false;
    document
      .querySelector<HTMLElement>(`#execution-directory tr[data-entity-id="${snapshot.runId}"]`)!
      .click();
    await until(() => read("run-snapshot")?.runId === snapshot.runId, "Run snapshot should render");
  };
  try {
    await import("../src/browser.js");
    await until(
      () => !!document.querySelector("#execution-actions button"),
      "browser should start",
    );
    await openRun();
    await until(() => !!emit && denied.has("/event-history"), "history denial should be visible");
    assert.equal(read("run-result"), false, "false is a real result, not an absent result");
    assert.deepEqual(read("run-progress"), snapshot.progress);
    assert.deepEqual(read("run-outcome"), snapshot.outcome);
    assert.equal(read("run-error"), undefined);
    assert.equal(read("run-exit"), undefined);
    assert.match(detail().textContent!, /类型结果报告（不代表退出或回收）/);
    assert.match(detail().textContent!, /尝试中 · 回收未确认/);
    document.querySelector<HTMLButtonElement>(".error-launcher")!.click();
    await until(() => !!document.querySelector(".error-sheet"), "error center should open");
    assert.match(
      document.querySelector(".error-sheet")!.textContent!,
      /No access to \/event-history/,
    );
    document.querySelector<HTMLButtonElement>(".error-sheet [data-close]")!.click();
    assert.match(detail().textContent!, /关联任务不可读/);

    const progress = detail().querySelector<HTMLDetailsElement>('[data-key="run-progress"]')!;
    progress.open = true;
    snapshot = {
      ...snapshot,
      revision: "domain:11",
      stage: "stopping",
      progress: { stage: "cleanup", message: "Cleanup is still unknown" },
      stopRequested: { occurredAt: at, sequence: 11, reason: "owners_canceled" },
      cleanupUnknown: { observedAt: at, reason: "<script>not executable</script>" },
    };
    emit!({
      snapshots: [],
      events: [
        {
          sequence: 11,
          revision: "domain:11",
          type: "run.cleanup.unknown",
          occurredAt: at,
          scope: "scope",
          runId,
          data: snapshot.cleanupUnknown!,
        },
      ],
      watermark: 11,
      revision: "domain:11",
      cursor: "domain:11",
    });
    await until(
      () => read("run-snapshot")?.revision === "domain:11",
      "live diagnostics should update",
    );
    assert.equal(detail().querySelector('[data-key="run-progress"]'), progress);
    assert.equal(progress.open, true, "live diagnostics must retain the user's disclosure state");
    assert.deepEqual(read("run-progress"), snapshot.progress);
    assert.deepEqual(read("run-stop-request"), snapshot.stopRequested);
    assert.deepEqual(read("run-cleanup-unknown"), snapshot.cleanupUnknown);
    assert.match(detail().textContent!, /资源清理未确认/);
    assert.equal(detail().querySelector("script"), null);
    assert.match(detail().textContent!, /正在停止 · 回收未确认/);

    document.querySelector<HTMLButtonElement>('[role="dialog"] [data-close]')!.click();
    snapshot = {
      runId: newIdentity(),
      dataDomain: "domain",
      revision: "domain:12",
      timestamp: at,
      type: "fixture",
      version: "1",
      scope: "scope",
      environment: "fixture",
      startedAt: at,
      startedSequence: 1,
      updatedAt: at,
      stage: "failed",
      result: null,
      error: { code: "fixture_failed", message: "Independent Run failure" },
      exit: { basis: "worker", occurredAt: at, sequence: 12, code: 1 },
      reclaimedAt: at,
    };
    await openRun();
    assert.equal(read("run-result"), null, "null is a real result, not an absent result");
    assert.deepEqual(read("run-error"), snapshot.error);
    assert.deepEqual(read("run-exit"), snapshot.exit);
    assert.equal(read("run-outcome"), undefined);
    assert.equal(read("run-progress"), undefined);
    assert.equal(read("run-cleanup-unknown"), undefined);
    assert.match(detail().textContent!, /Run 失败 · 已回收/);
    assert.equal(read("run-snapshot").reclaimedAt, at);
  } finally {
    window.dispatchEvent(new window.Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    globalThis.fetch = originalFetch;
    await dom.restore();
  }
});
