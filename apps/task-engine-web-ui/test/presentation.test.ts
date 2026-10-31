import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { browserDom } from "./browser-dom.js";

test("React/shadcn owns rendering and isolates the persistent schema editor", async (t) => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { document } = dom;
  const { WorkbenchView, describeAction } = await import("../src/presentation.tsx");
  const view = new WorkbenchView(document.getElementById("app")!);
  const nav = view.navigation;
  const element = <T extends HTMLElement = HTMLElement>(selector: string) => {
    const node = document.querySelector<T>(selector);
    assert.ok(node, selector);
    return node;
  };
  const detail = (count: number) => {
    const root = document.createElement("div");
    root.dataset.key = "task:stable";
    const details = document.createElement("details");
    details.dataset.key = "all-events";
    const summary = document.createElement("summary");
    summary.textContent = `公开事件（${count}）`;
    details.append(summary);
    root.append(details);
    return root;
  };
  try {
    await t.test(
      "real components consume detached descriptions without sharing controlled DOM",
      () => {
        const table = document.createElement("table");
        const body = document.createElement("tbody");
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.textContent = "<img src=x onerror=alert(1)>";
        row.append(cell);
        body.append(row);
        table.append(body);
        view.render("directory", [table]);
        for (const slot of [
          "tabs",
          "tabs-list",
          "tabs-trigger",
          "tabs-content",
          "input",
          "button",
          "table",
          "table-row",
          "table-cell",
        ])
          assert.ok(document.querySelector(`[data-slot="${slot}"]`), slot);
        assert.equal(document.querySelectorAll("header [role=tab]").length, 2);
        assert.equal(document.querySelectorAll('main [role="tabpanel"]:not([hidden])').length, 1);
        assert.equal(document.querySelectorAll("#directory img").length, 0);
        cell.textContent = "mutating a consumed description is not a DOM update";
        assert.match(element("#directory").textContent!, /<img src=x onerror=alert\(1\)>/);
        assert.throws(
          () => view.render("directory", [element("#directory table")]),
          /live DOM tree/,
        );
      },
    );

    await t.test(
      "updated detail counts preserve summary focus, disclosure and list state",
      async () => {
        const list = element("#directory");
        list.scrollTop = 73;
        element<HTMLInputElement>("#history-type").value = "unapplied";
        view.render("task-detail", [detail(1)]);
        element("#new-task").focus();
        nav.open("task-detail");
        await delay(10);
        const disclosure = element<HTMLDetailsElement>("#task-detail details");
        const summary = element("#task-detail summary");
        disclosure.open = true;
        summary.focus();
        view.render("task-detail", [detail(2)]);
        assert.ok(element("#task-detail summary") === summary);
        assert.ok(document.activeElement === summary);
        assert.equal(disclosure.open, true);
        assert.match(summary.textContent!, /2/);
        assert.ok(element("#directory") === list);
        assert.equal(list.scrollTop, 73);
        assert.equal(element<HTMLInputElement>("#history-type").value, "unapplied");
      },
    );

    await t.test(
      "one overlay owns focus and delayed close cannot steal a user's next focus",
      async () => {
        nav.close("task-detail");
        const next = element("#bar-toggle");
        next.focus();
        await delay(30);
        assert.ok(document.activeElement === next);
        nav.open("task-detail");
        nav.show("executions", false);
        nav.open("execution-detail");
        await delay(30);
        assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
        assert.equal(element("#tasks").hidden, true);
        assert.ok(document.activeElement?.closest("#execution-detail-sheet"));
        nav.close("execution-detail");
        await delay(30);
        assert.ok(document.activeElement === element("#tab-executions"));
        assert.equal(document.activeElement?.closest("[hidden]"), null);
      },
    );

    await t.test(
      "unmounted popup preserves raw invalid schema text without competing DOM owners",
      async () => {
        const raw = document.createElement("textarea");
        raw.id = "raw-schema-value";
        raw.value = "{ unfinished JSON";
        view.form.append(raw);
        view.options([{ label: "echo", value: "echo" }]);
        view.type("echo");
        nav.show("tasks", false);
        nav.open("create-dialog");
        await delay(10);
        assert.ok(element("#raw-schema-value") === raw);
        assert.ok(document.querySelector('[data-slot="dialog-content"]'));
        nav.close("create-dialog");
        assert.equal(raw.isConnected, false);
        nav.show("executions");
        nav.show("tasks");
        nav.open("create-dialog");
        await delay(10);
        assert.ok(element("#raw-schema-value") === raw);
        assert.equal(raw.value, "{ unfinished JSON");
        assert.equal(element<HTMLSelectElement>("#type").value, "echo");
        nav.close("create-dialog");
        await delay(30);
      },
    );

    await t.test(
      "inline glyphs retain labels, identity and callbacks without changing primary or entity buttons",
      async () => {
        const names = [
          "详情",
          "重做",
          "编辑重做",
          "重新观察",
          "暂停观察",
          "原参数直接重做（新身份）",
          "编辑后重做",
          "重新读取事件历史",
          "上移",
          "下移",
          "编辑保存参数",
          "编辑后新建",
          "查看来源 / 模板",
        ] as const;
        const called: string[] = [];
        const buttons = names.map((name) => {
          const button = document.createElement("button");
          button.textContent = name;
          button.dataset.key = `original:${name}`;
          button.dataset.action = name === "重新观察" ? "refresh" : name;
          describeAction(button, {
            run: () => {
              called.push(name);
            },
            error: assert.fail,
            minimumInterval: 0,
            glyph: name,
          });
          return button;
        });
        for (const [index, name] of [
          "提交任务",
          "取消选中的 Task",
          "原身份重试（保留 guard）",
          "重做",
        ].entries()) {
          const button = document.createElement("button");
          button.textContent = name;
          button.dataset.key = `text:${index}`;
          describeAction(button, { run: () => {}, error: assert.fail, minimumInterval: 0 });
          buttons.push(button);
        }
        view.render("history-actions", buttons);
        for (const name of names) {
          const button = element<HTMLButtonElement>(`[data-key="original:${name}"]`);
          assert.equal(button.querySelectorAll("svg").length, 1);
          assert.equal(button.querySelector("svg")?.getAttribute("aria-hidden"), "true");
          assert.equal(button.querySelector("svg")?.getAttribute("focusable"), "false");
          assert.equal(button.querySelector(".sr-only")?.textContent, name);
          assert.ok(button.getAttribute("aria-label"));
          assert.equal(button.dataset.variant, "ghost");
          assert.equal(button.dataset.size, "icon");
          assert.equal(button.dataset.action, name === "重新观察" ? "refresh" : name);
          button.click();
        }
        await delay(10);
        assert.deepEqual(called, names);
        for (let index = 0; index < 4; index++) {
          const button = element(`[data-key="text:${index}"]`);
          assert.equal(button.querySelector("svg"), null);
          assert.equal(button.querySelector(".sr-only"), null);
          assert.ok(button.textContent);
        }
        assert.match(element("#new-task").textContent!, /新建任务/);
        view.render("history-actions", []);
      },
    );

    await t.test(
      "glyph action keeps its busy and rapid-click guard through keyed updates",
      async () => {
        let count = 0;
        let release = () => {};
        const pending = new Promise<void>((resolve) => {
          release = resolve;
        });
        const description = () => {
          const button = document.createElement("button");
          button.textContent = "submit";
          button.dataset.key = "guarded";
          describeAction(button, {
            glyph: "重做",
            run: async () => {
              count++;
              await pending;
            },
            error: assert.fail,
            minimumInterval: 300,
          });
          return button;
        };
        view.render("history-actions", [description()]);
        const button = element<HTMLButtonElement>("#history-actions button");
        button.click();
        button.click();
        await delay(5);
        view.render("history-actions", [description()]);
        assert.ok(element("#history-actions button") === button);
        button.click();
        assert.equal(count, 1);
        assert.equal(button.disabled, true);
        release();
        await delay(10);
        button.click();
        await delay(5);
        assert.equal(count, 1);
        await delay(310);
        button.click();
        await delay(10);
        assert.equal(count, 2);
      },
    );
  } finally {
    view.dispose();
    await dom.restore();
  }
});
