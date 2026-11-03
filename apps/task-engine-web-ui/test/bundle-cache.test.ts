import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { BundleCacheDetail, BundleCachePage } from "@potential-guide/task-protocol";
import { allowedRoute } from "../src/server.js";
import { browserDom } from "./browser-dom.js";

test("cache proxy permits only bounded catalog/detail/single removal routes", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  assert.equal(allowedRoute("/bundle-cache", "GET", new URLSearchParams("limit=50")), true);
  assert.equal(allowedRoute(`/bundle-cache/${digest}`, "GET", new URLSearchParams()), true);
  assert.equal(allowedRoute(`/bundle-cache/${digest}`, "DELETE", new URLSearchParams()), true);
  assert.equal(allowedRoute("/bundle-cache", "DELETE", new URLSearchParams()), false);
  assert.equal(allowedRoute(`/bundle-cache/${digest}`, "POST", new URLSearchParams()), false);
  assert.equal(allowedRoute("/bundle-cache/../outside", "DELETE", new URLSearchParams()), false);
  assert.equal(allowedRoute("/bundle-cache", "GET", new URLSearchParams("path=outside")), false);
  assert.equal(allowedRoute("/bundle-cache", "GET", new URLSearchParams("limit=1&limit=2")), false);
});

async function until(check: () => boolean, message: string): Promise<void> {
  const end = performance.now() + 3000;
  while (performance.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}
test("parallel cache page requires deliberate single deletion, keeps in-use content and ignores old endpoint responses", async () => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { window, document } = dom;
  const previous = globalThis.fetch;
  const digest = `sha256:${"a".repeat(64)}`,
    busyDigest = `sha256:${"b".repeat(64)}`;
  const at = new Date().toISOString();
  let removed = false,
    deletes = 0,
    conflict = false;
  let delayed: ((value: Response) => void) | undefined;
  let delayNext = false;
  const detail: BundleCacheDetail = {
    digest,
    cached: true,
    preparing: false,
    leases: 0,
    name: "Cached fixture",
    bytes: 1234,
    files: 2,
  };
  const listing = (): BundleCachePage => ({
    observedAt: at,
    items: removed
      ? []
      : [
          detail,
          {
            digest: busyDigest,
            cached: true,
            preparing: false,
            leases: 1,
            name: "Busy fixture",
            bytes: 100,
            files: 2,
          },
        ],
  });
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const calls: string[] = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), "http://ui.fixture"),
      method = options?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/bootstrap")
      return json({
        csrf: "session",
        endpoints: [
          { id: "one", label: "One", binding: "one" },
          { id: "two", label: "Two", binding: "two" },
        ],
      });
    if (url.pathname === "/api/favorites") return json([]);
    if (url.pathname.startsWith("/api/endpoints/two/"))
      return json(
        { error: { code: "forbidden", message: "Cache operator permission required" } },
        403,
      );
    const path = url.pathname.replace("/api/endpoints/one", "");
    if (path === "/bundle-cache") {
      if (delayNext)
        return new Promise((resolve) => {
          delayed = resolve;
        });
      return json(listing());
    }
    if (path === `/bundle-cache/${digest}`) {
      if (method === "DELETE") {
        deletes++;
        if (conflict)
          return json({ error: { code: "bundle_in_use", message: "Bundle is busy" } }, 409);
        removed = true;
        return json({ removed: true, digest });
      }
      return json(detail);
    }
    return json({ error: { code: "forbidden", message: "No business access" } }, 403);
  };
  const dialog = () => document.getElementById("cache");
  const button = (text: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === text,
    )!;
  try {
    await import("../src/browser.js");
    await until(
      () => !!document.getElementById("notice")?.textContent?.includes("当前目标：One"),
      "UI should start",
    );
    document.getElementById("tab-cache")!.focus();
    document.getElementById("tab-cache")!.click();
    await until(
      () => !!dialog()?.textContent?.includes("Cached fixture"),
      "cache should load without task grants",
    );
    assert.match(dialog()!.textContent!, /One/);
    assert.equal(document.querySelectorAll('main [role="tabpanel"]:not([hidden])').length, 1);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.getElementById("tab-cache")!.getAttribute("aria-selected"), "true");
    assert.equal(deletes, 0);
    const busy = dialog()!.querySelector(`tr[data-key="${busyDigest}"]`)!;
    assert.equal(
      [...busy.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === "清理此缓存",
      )!.disabled,
      true,
    );
    button("查看契约").click();
    await until(
      () => !!dialog()?.querySelector('details[data-key^="cache-detail"]'),
      "detail should render",
    );
    button("清理此缓存").click();
    await until(
      () => !!dialog()?.textContent?.includes("确认清理"),
      "confirmation should be explicit",
    );
    assert.equal(deletes, 0);
    button("保留缓存").click();
    assert.equal(deletes, 0);
    conflict = true;
    button("清理此缓存").click();
    button("确认清理").click();
    await until(
      () => !!dialog()?.textContent?.includes("bundle_in_use"),
      "busy failure must be explicit",
    );
    assert.equal(deletes, 1);
    assert.match(dialog()!.textContent!, /Cached fixture/);
    conflict = false;
    button("确认清理").click();
    await until(
      () => !!dialog()?.textContent?.includes("当前页没有缓存"),
      "successful removal should refresh",
    );
    assert.equal(deletes, 2);
    removed = false;
    delayNext = true;
    button("刷新缓存").click();
    await until(() => !!delayed, "old read should be pending");
    const endpoint = document.getElementById("endpoint") as HTMLSelectElement;
    endpoint.value = "two";
    endpoint.dispatchEvent(new window.Event("change", { bubbles: true }));
    await until(
      () => !!dialog()?.textContent?.includes("Cache operator permission required"),
      "endpoint change loads the new cache page without leaving it",
    );
    delayed!(json(listing()));
    await until(
      () => !!dialog()?.textContent?.includes("Cache operator permission required"),
      "new endpoint denial must not be hidden",
    );
    assert.doesNotMatch(dialog()!.textContent!, /Cached fixture/);
    document.getElementById("tab-tasks")!.focus();
    document.getElementById("tab-tasks")!.click();
    assert.equal(dialog()!.hidden, true);
    document.getElementById("tab-cache")!.focus();
    document.getElementById("tab-cache")!.click();
    await until(() => !dialog()!.hidden, "cache should remain a peer workspace tab");
    assert.equal(calls.filter((item) => item.includes("/cancel")).length, 0);
    assert.equal(deletes, 2);
  } finally {
    window.dispatchEvent(new window.Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    globalThis.fetch = previous;
    await dom.restore();
  }
});
