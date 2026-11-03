import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { browserDom } from "./browser-dom.js";

test("bottom error center preserves entity details and clearing logs does not change data", async () => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { document } = dom;
  const { WorkbenchView } = await import("../src/presentation.tsx");
  const view = new WorkbenchView(document.getElementById("app")!);
  try {
    assert.equal(document.querySelector("#task-lookup"), null);
    assert.equal(document.querySelector("#execution-lookup"), null);
    assert.equal(
      document.querySelector(".workspace-navigation")?.getAttribute("data-variant"),
      "line",
    );
    const detail = document.createElement("details");
    detail.open = true;
    detail.append(document.createElement("summary"), document.createTextNode("kept entity data"));
    view.render("task-detail", [detail]);
    view.navigation.open("task-detail");
    await delay(20);
    const sheet = document.querySelector("#task-detail-sheet");
    const disclosure = document.querySelector<HTMLDetailsElement>("#task-detail details");
    view.error("demo / query", "<script>denied</script>");
    view.publish();
    assert.equal(document.querySelector(".error-sheet"), null, "errors must not auto-open");
    document.querySelector<HTMLButtonElement>(".error-launcher")!.click();
    await delay(20);
    assert.ok(document.querySelector(".error-sheet"));
    assert.equal(document.querySelector("#task-detail-sheet"), sheet);
    assert.equal(disclosure?.open, true);
    assert.equal(view.navigation.overlay?.id, "task-detail");
    assert.equal(document.querySelector(".error-sheet script"), null);
    const errorDetails = document.querySelector<HTMLDetailsElement>(".error-entry details")!;
    errorDetails.open = true;
    view.error("demo / query", "");
    view.publish();
    assert.equal(document.querySelector(".error-entry details"), errorDetails);
    assert.equal(errorDetails.open, true);
    assert.match(errorDetails.textContent!, /已恢复/);
    const clear = [...document.querySelectorAll<HTMLButtonElement>(".error-sheet button")].find(
      (button) => button.textContent === "清空日志",
    )!;
    clear.click();
    assert.equal(view.errors.entries.length, 0);
    assert.equal(document.querySelector("#task-detail-sheet"), sheet);
    assert.match(document.querySelector("#task-detail")!.textContent!, /kept entity data/);
    document.querySelector<HTMLButtonElement>(".error-sheet [data-close]")!.click();
    await delay(40);
    assert.equal(view.errorsOpen, false);
    assert.equal(view.navigation.overlay?.id, "task-detail");
    assert.equal(document.querySelector("#task-detail-sheet"), sheet);
    assert.equal(document.activeElement, document.querySelector(".error-launcher"));
  } finally {
    view.dispose();
    await dom.restore();
  }
});
