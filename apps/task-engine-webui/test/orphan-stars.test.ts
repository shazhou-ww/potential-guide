import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { newIdentity } from "../src/model.js";
import { browserDom } from "./browser-dom.js";

test("removing all configured Endpoints preserves readable local starred recipes without retargeting", async () => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { window, document } = dom;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  const calls: string[] = [];
  Object.assign(globalThis, {
    window,
    document,
    fetch: async (path: string) => {
      calls.push(path);
      if (path === "/api/bootstrap")
        return new Response(JSON.stringify({ csrf: "fixture", endpoints: [] }));
      if (path === "/api/favorites")
        return new Response(
          JSON.stringify([
            {
              id: "00000000-0000-0000-0000-000000000001",
              name: "saved",
              endpoint: { id: "removed", label: "原服务", binding: "old" },
              parameters: {
                type: "echo",
                timeoutMs: 1000,
                text: "saved original",
                metadata: { digest: "kept" },
              },
              source: {
                taskId: newIdentity(),
                requestId: newIdentity(),
                receivedAt: "2026-10-31T00:00:00Z",
              },
            },
          ]),
        );
      throw new Error("An unavailable target must never receive a request");
    },
  });
  try {
    await import("../src/browser.js");
    const deadline = Date.now() + 2000;
    while (
      !document.getElementById("directory")!.textContent!.includes("原目标缺失") &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    const text = document.getElementById("directory")!.textContent!;
    assert.match(text, /原目标缺失/);
    assert.match(text, /saved original/);
    const submit = [...document.querySelectorAll<HTMLButtonElement>("#directory button")].find(
      (item) => item.textContent === "用保存参数新建",
    );
    assert.equal(submit?.disabled, true);
    assert.deepEqual(calls, ["/api/bootstrap", "/api/favorites"]);
    assert.match(document.getElementById("execution-directory")!.textContent!, /未配置服务/);
  } finally {
    window.dispatchEvent(new window.Event("pagehide"));
    Object.assign(globalThis, previous);
    await dom.restore();
  }
});
