import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { browserDom } from "./browser-dom.js";

test("native table rows navigate without taking over child controls or selection", async (t) => {
  const dom = browserDom(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const { window, document } = dom;
  const { WorkbenchView, describeAction, describeRowAction } = await import(
    "../src/presentation.tsx"
  );
  const view = new WorkbenchView(document.getElementById("app")!);
  let opened = 0,
    childActions = 0;
  const render = (
    kind: "task" | "run" = "task",
    open = () => {
      opened++;
    },
  ) => {
    const table = document.createElement("table"),
      body = document.createElement("tbody");
    const row = document.createElement("tr"),
      text = document.createElement("td");
    row.dataset.key = `${kind}:stable`;
    text.textContent = "echo selectable text";
    describeRowAction(row, {
      kind,
      id: "stable",
      label: `查看 ${kind} 详情`,
      run: open,
      error: assert.fail,
    });
    const controls = document.createElement("td");
    controls.dataset.rowControls = "";
    for (const disabled of [false, true]) {
      const button = document.createElement("button");
      button.textContent = disabled ? "disabled" : "redo";
      button.disabled = disabled;
      describeAction(button, {
        run: () => {
          childActions++;
        },
        error: assert.fail,
        minimumInterval: 0,
        glyph: "重做",
      });
      controls.append(button);
    }
    row.append(text, controls);
    body.append(row);
    table.append(body);
    assert.equal(row.onclick, null);
    assert.equal(row.onkeydown, null);
    view.render(kind === "task" ? "directory" : "execution-directory", [table]);
    return document.querySelector<HTMLTableRowElement>(`tr[data-row-action="${kind}"]`)!;
  };
  const mouse = (target: Element, options: MouseEventInit = {}) =>
    target.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ...options }),
    );
  const key = (target: Element, value: string, options: KeyboardEventInit = {}) =>
    target.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: value,
        ...options,
      }),
    );
  try {
    await t.test(
      "rows retain table semantics, metadata separation and stable DOM identity",
      async () => {
        const row = render();
        assert.equal(row.tagName, "TR");
        assert.equal(row.getAttribute("role"), null);
        assert.equal(row.tabIndex, 0);
        assert.equal(row.dataset.entityId, "stable");
        assert.equal(row.cells[0]!.querySelector("button"), null);
        assert.equal(row.querySelectorAll("td").length, 2);
        assert.throws(
          () =>
            describeAction(document.createElement("tr") as unknown as HTMLButtonElement, {
              run() {},
              error: assert.fail,
              minimumInterval: 0,
            }),
          /button description/,
        );
        row.focus();
        render();
        assert.ok(document.querySelector('tr[data-row-action="task"]') === row);
        assert.ok(document.activeElement === row);
        mouse(row.cells[0]!);
        await delay(5);
        assert.equal(opened, 1);
      },
    );

    await t.test(
      "controls, disabled wrappers, empty operation cells and child keys never open rows",
      async () => {
        const row = render(),
          controls = row.cells[1]!;
        const buttons = controls.querySelectorAll("button");
        const before = opened;
        mouse(controls);
        for (const wrapper of controls.querySelectorAll("[data-row-control]")) mouse(wrapper);
        buttons[0]!.click();
        buttons[1]!.click();
        key(buttons[0]!, "Enter");
        key(buttons[0]!, " ");
        await delay(5);
        assert.equal(opened, before);
        assert.equal(childActions, 1);
      },
    );

    await t.test("selection, drag, modifiers and non-primary clicks do not navigate", async () => {
      const row = render(),
        cell = row.cells[0]!;
      const before = opened;
      for (const options of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
        { button: 2 },
      ])
        mouse(cell, options);
      key(row, "Enter", { ctrlKey: true });
      key(row, " ", { shiftKey: true });
      const range = document.createRange();
      range.selectNodeContents(cell);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
      assert.equal(document.getSelection()!.toString(), "echo selectable text");
      mouse(cell);
      key(row, "Enter");
      document.getSelection()!.removeAllRanges();
      for (const [type, x] of [
        ["pointerdown", 10],
        ["pointermove", 40],
        ["pointerup", 10],
      ] as const)
        cell.dispatchEvent(
          new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: 10, button: 0 }),
        );
      mouse(cell);
      await delay(5);
      assert.equal(opened, before);
      mouse(cell);
      await delay(5);
      assert.equal(opened, before + 1, "a fresh click is not blocked by the previous drag");
    });

    await t.test(
      "Enter and Space open the correct Task/Run sheet and restore row focus",
      async () => {
        for (const [kind, value] of [
          ["task", "Enter"],
          ["run", " "],
        ] as const) {
          view.navigation.show(kind === "task" ? "tasks" : "executions", false);
          const id = kind === "task" ? "task-detail" : "execution-detail";
          let finishRead = () => {};
          const row = render(kind, () => {
            opened++;
            view.navigation.open(id);
            return new Promise<void>((resolve) => {
              finishRead = resolve;
            });
          });
          const before = opened;
          row.focus();
          assert.equal(key(row, value), false, "row activation prevents Space page scrolling");
          key(row, value, { repeat: true });
          await delay(10);
          assert.equal(opened, before + 1);
          assert.ok(document.getElementById(`${id}-sheet`));
          view.navigation.close(id);
          await delay(30);
          assert.ok(document.activeElement === row);
          const firstRead = finishRead;
          key(row, value);
          await delay(10);
          assert.equal(opened, before + 2, "an older history read cannot lock a closed row");
          firstRead();
          finishRead();
          view.navigation.close(id);
          await delay(30);
        }
      },
    );
  } finally {
    view.dispose();
    await dom.restore();
  }
});
