import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allowedRoute } from "../src/server.js";
import { browserDom } from "./browser-dom.js";

test("UI proxy rejects retired Bundle cache routes while preserving task and Run routes", () => {
  const cid = "bafybeigdyrzt5sfp7udm7hu76u7ydwfmksn3y3sc57x4taoj7c3x2m3yuy";
  for (const path of ["/bundle-cache", `/bundle-cache/${cid}`])
    for (const method of ["GET", "DELETE", "POST"])
      assert.equal(allowedRoute(path, method, new URLSearchParams()), false);
  assert.equal(allowedRoute("/tasks", "GET", new URLSearchParams()), true);
  assert.equal(allowedRoute("/runs", "GET", new URLSearchParams()), true);
});

test("workbench exposes only Task and Run workspaces and never requests Bundle cache APIs", async () => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { window, document } = dom;
  const previous = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://ui.fixture");
    calls.push(url.pathname);
    if (url.pathname === "/api/bootstrap")
      return Response.json({
        csrf: "session",
        endpoints: [{ id: "local", label: "Local", binding: "local" }],
      });
    if (url.pathname === "/api/favorites") return Response.json([]);
    return Response.json(
      { error: { code: "forbidden", message: "No business access" } },
      { status: 403 },
    );
  };
  try {
    await import("../src/browser.js");
    const deadline = performance.now() + 3000;
    while (!document.getElementById("notice")?.textContent?.includes("当前目标：Local")) {
      assert.ok(performance.now() < deadline, "Workbench did not start.");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(
      [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.id),
      ["tab-tasks", "tab-executions"],
    );
    assert.equal(document.getElementById("tab-cache"), null);
    assert.equal(document.getElementById("bundle-cache"), null);
    document.getElementById("tab-executions")!.focus();
    document.getElementById("tab-executions")!.click();
    assert.equal(document.getElementById("tab-executions")!.getAttribute("aria-selected"), "true");
    document.getElementById("tab-tasks")!.focus();
    document.getElementById("tab-tasks")!.click();
    assert.equal(document.querySelectorAll('main [role="tabpanel"]:not([hidden])').length, 1);
    assert.equal(
      calls.some((path) => path.includes("/bundle-cache")),
      false,
    );
  } finally {
    window.dispatchEvent(new window.Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    globalThis.fetch = previous;
    await dom.restore();
  }
});
