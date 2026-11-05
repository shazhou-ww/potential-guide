import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { browserDom } from "./browser-dom.js";

test("Task and Run grids integrate column filters, sorting and pagination without losing directory state", async (t) => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { window, document } = dom;
  const { WorkbenchView, describeAction, describeRowAction } = await import(
    "../src/presentation.tsx"
  );
  const view = new WorkbenchView(document.getElementById("app")!);
  let opened = "",
    redone = 0,
    loadedMore = 0;
  const element = <T extends HTMLElement = HTMLElement>(selector: string) => {
    const result = document.querySelector<T>(selector);
    assert.ok(result, selector);
    return result;
  };
  const button = (label: string, root = "#directory") => {
    const result = [...element(root).querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    assert.ok(result, label);
    return result;
  };
  const visible = (root = "#directory") =>
    [...element(root).querySelectorAll<HTMLTableRowElement>("tbody tr[data-entity-id]")].map(
      (row) => row.dataset.entityId!,
    );
  const render = (
    count: number,
    {
      kind = "tasks",
      scope = "one",
      query = "sort=created-desc",
      complete = true,
    }: { kind?: "tasks" | "runs"; scope?: string; query?: string; complete?: boolean } = {},
  ) => {
    const more = document.createElement("button");
    more.textContent = "加载服务端下一批";
    describeAction(more, {
      run: () => {
        loadedMore++;
      },
      error: assert.fail,
      minimumInterval: 0,
    });
    const rows = Array.from({ length: count }, (_, index) => {
      const id = `id-${index}`;
      const title = `task ${index}`;
      const status = index % 2 ? "已完成" : "执行中";
      const time = Date.UTC(2026, 0, index + 1);
      const row = document.createElement("tr");
      row.dataset.key = `${kind}:${id}`;
      describeRowAction(row, {
        kind: kind === "tasks" ? "task" : "run",
        id,
        label: `查看 ${id}`,
        run: () => {
          opened = id;
        },
        error: assert.fail,
      });
      for (const text of [
        ...(kind === "tasks" ? ["☆"] : []),
        title,
        status,
        new Date(time).toLocaleString(),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
      if (kind === "tasks") {
        const cell = document.createElement("td");
        cell.dataset.rowControls = "";
        const redo = document.createElement("button");
        redo.textContent = "重做";
        describeAction(redo, {
          run: () => {
            redone++;
          },
          error: assert.fail,
          minimumInterval: 0,
          glyph: "重做",
        });
        cell.append(redo);
        row.append(cell);
      }
      return { id, title: `${title} ${id}`, status, time, node: row };
    });
    const notice = document.createElement("p");
    notice.textContent = `已加载 ${count} 条 · 水位 domain:${count}`;
    view.directory(kind, { rows, scope, query, complete, more }, [notice]);
  };
  const select = async (selector: string, value: string) => {
    const control = element<HTMLSelectElement>(selector);
    control.value = value;
    control.dispatchEvent(new window.Event("change", { bubbles: true }));
    await delay(10);
  };
  try {
    await t.test("all query controls live inside table headers or the table footer", () => {
      render(60, { complete: false });
      for (const id of ["history-type", "created-from", "created-before", "only-favorites"])
        assert.ok(element(`#${id}`).closest("[popover]"));
      for (const id of ["execution-type", "started-from", "started-before"])
        assert.ok(element(`#${id}`).closest("[popover]"));
      for (const id of ["history-type", "execution-type"])
        assert.equal(element<HTMLInputElement>(`#${id}`).placeholder, "完整根 CID（可选）");
      assert.equal(document.querySelectorAll("#directory .column-filter-trigger").length, 4);
      assert.equal(
        document.querySelectorAll("#execution-directory .column-filter-trigger").length,
        3,
      );
      for (const popup of document.querySelectorAll(".column-filter-popup"))
        assert.equal(popup.getAttribute("popover"), "auto");
      assert.equal(document.querySelector("#directory th details"), null);
      assert.ok(element("#history-actions").closest("footer"));
      assert.ok(element("#execution-actions").closest("footer"));
      assert.ok(element("#directory .directory-notices").closest("footer"));
      assert.ok(element("#execution-directory .directory-notices").closest("footer"));
      assert.ok(element("#association-filter").closest("[popover]"));
      assert.ok(element("#directory > .directory-grid"));
      assert.equal(document.querySelector(".filters"), null);
      assert.equal(visible().length, 25);
      assert.match(element("#directory footer").textContent!, /仅针对已加载记录/);
      assert.match(element("#directory footer").textContent!, /1–25 \/ 60/);
    });

    await t.test("changing snapshot information updates only the footer, not header nodes", () => {
      const header = element("#directory thead");
      const sorting = element<HTMLButtonElement>('#directory th button[aria-label="任务排序"]');
      sorting.focus();
      const notice = document.createElement("p");
      notice.textContent = "查询错误：保留旧快照。\n下一行状态。\n更多诊断信息。";
      view.render("directory", [notice]);
      assert.ok(element("#directory thead") === header);
      assert.ok(document.activeElement === sorting);
      assert.match(element("#directory footer").textContent!, /更多诊断信息/);
      assert.equal(element("#directory thead").textContent!.includes("更多诊断信息"), false);
    });

    await t.test(
      "paging and page size operate over loaded rows; continuation stays independent",
      async () => {
        button("下一页").click();
        await delay(10);
        assert.equal(visible()[0], "id-25");
        assert.match(element("#directory footer").textContent!, /26–50 \/ 60/);
        button("加载服务端下一批").click();
        await delay(10);
        assert.equal(loadedMore, 1);
        assert.equal(visible()[0], "id-25");
        await select('#directory select[aria-label="任务每页条数"]', "10");
        assert.equal(visible().length, 10);
        assert.equal(visible()[0], "id-0");
        button("下一页").click();
        await delay(10);
        render(65);
        assert.equal(visible()[0], "id-10", "live updates must not reset pagination");
        assert.match(element("#directory footer").textContent!, /完整集合/);
      },
    );

    await t.test(
      "sorting uses raw dates across the whole loaded collection, not formatted cells or one page",
      async () => {
        const control = element<HTMLButtonElement>('#directory th button[aria-label^="接收时间"]');
        control.click();
        await delay(10);
        assert.equal(element('#directory th[aria-sort="descending"]').contains(control), true);
        assert.equal(visible()[0], "id-64");
        control.click();
        await delay(10);
        assert.equal(element('#directory th[aria-sort="ascending"]').contains(control), true);
        assert.equal(visible()[0], "id-0");
        assert.equal(visible()[9], "id-9");
      },
    );

    await t.test(
      "status and title filters compose and reset paging with accessible empty state",
      async () => {
        await select("#directory .column-filter-popup select", "已完成");
        assert.equal(visible()[0], "id-1");
        assert.equal(visible()[9], "id-19");
        const search = element<HTMLInputElement>("#tasks-title-filter");
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!
          .set!;
        setter.call(search, "ID-61");
        search.dispatchEvent(new window.Event("input", { bubbles: true }));
        await delay(10);
        assert.deepEqual(visible(), ["id-61"]);
        setter.call(search, "missing");
        search.dispatchEvent(new window.Event("input", { bubbles: true }));
        await delay(10);
        assert.deepEqual(visible(), []);
        assert.match(element("#directory tbody").textContent!, /没有符合列筛选的记录/);
        assert.match(element("#directory footer").textContent!, /0–0 \/ 0/);
        button("清除列筛选与排序").click();
        await delay(10);
        assert.equal(visible()[0], "id-0");
        assert.equal(element<HTMLInputElement>("#tasks-title-filter").value, "");
      },
    );

    await t.test(
      "keyed updates preserve popup identity, focus and unapplied server fields",
      async () => {
        const digest = element<HTMLInputElement>("#history-type");
        const popup = element("#tasks-title-filter-popup");
        const trigger = element('button[data-filter="tasks-title-filter-popup"]');
        const toggle = (newState: "open" | "closed") => {
          const event = new window.Event("toggle");
          Object.defineProperty(event, "newState", { value: newState });
          popup.dispatchEvent(event);
        };
        toggle("open");
        await delay(10);
        assert.equal(trigger.getAttribute("aria-expanded"), "true");
        assert.ok(document.activeElement === element("#tasks-title-filter"));
        digest.value = "unapplied bundle";
        digest.focus();
        render(65);
        assert.ok(element("#history-type") === digest);
        assert.ok(document.activeElement === digest);
        assert.ok(element("#tasks-title-filter-popup") === popup);
        assert.equal(trigger.getAttribute("aria-expanded"), "true");
        assert.equal(digest.value, "unapplied bundle");
        Object.defineProperty(popup, "hidePopover", {
          configurable: true,
          value: () => toggle("closed"),
        });
        const escapeEvent = new window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });
        digest.dispatchEvent(escapeEvent);
        await delay(10);
        assert.equal(trigger.getAttribute("aria-expanded"), "false");
        assert.equal(escapeEvent.defaultPrevented, true);
        assert.ok(document.activeElement === trigger);
        Reflect.deleteProperty(popup, "hidePopover");
      },
    );

    await t.test(
      "sorted rows retain navigation, separate child actions and native table semantics",
      async () => {
        element<HTMLButtonElement>('#directory th button[aria-label="任务排序"]').click();
        await delay(10);
        const row = element<HTMLTableRowElement>("#directory tbody tr");
        assert.equal(row.cells.length, 5);
        assert.equal(row.getAttribute("role"), null);
        row.querySelector<HTMLButtonElement>("button")!.click();
        await delay(10);
        assert.equal(redone, 1);
        assert.equal(opened, "");
        row.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await delay(10);
        assert.equal(opened, row.dataset.entityId);
      },
    );

    await t.test(
      "shrinking data clamps pages, query changes reset pages and Endpoint changes clear local state",
      async () => {
        button("下一页").click();
        await delay(10);
        render(1);
        await delay(10);
        assert.deepEqual(visible(), ["id-0"]);
        render(60);
        button("下一页").click();
        await delay(10);
        render(60, { query: "bundleCid=new" });
        await delay(10);
        assert.equal(visible()[0], "id-0");
        await select("#directory .column-filter-popup select", "已完成");
        render(5, { scope: "two" });
        await delay(10);
        assert.equal(
          element<HTMLSelectElement>("#directory .column-filter-popup select").value,
          "",
        );
        assert.deepEqual(visible(), ["id-0", "id-1", "id-2", "id-3", "id-4"]);
      },
    );

    await t.test(
      "Run has the same behavior and independent table state; rows beyond the former cap are reachable",
      async () => {
        render(1005, { kind: "runs" });
        assert.equal(visible("#execution-directory").length, 25);
        assert.equal(element("#execution-directory thead tr").children.length, 3);
        element<HTMLButtonElement>(
          '#execution-directory th button[aria-label^="开始时间"]',
        ).click();
        await delay(10);
        assert.equal(visible("#execution-directory")[0], "id-1004");
        assert.equal(visible().length, 5);
        await select("#execution-directory .column-filter-popup select", "已完成");
        assert.equal(visible("#execution-directory")[0], "id-1003");
        assert.equal(visible().length, 5);
        render(0, { kind: "runs" });
        await delay(10);
        assert.match(element("#execution-directory tbody").textContent!, /暂无记录/);
      },
    );
  } finally {
    view.dispose();
    await dom.restore();
  }
});
