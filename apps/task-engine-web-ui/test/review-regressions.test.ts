import assert from "node:assert/strict";
import test from "node:test";
import { compileInputSchema, type TaskSnapshot } from "@potential-guide/task-protocol";
import { parseHTML } from "linkedom";
import { claimActivation, reconcile } from "../src/dom.js";
import { schemaEditor } from "../src/form.js";
import { ApiError, Directory, newIdentity, SubmissionBar, TaskSnapshots } from "../src/model.js";

function dom(action: (document: Document) => void) {
  const { document } = parseHTML("<html><body></body></html>");
  const previous = globalThis.document;
  Object.assign(globalThis, { document });
  try {
    action(document as unknown as Document);
  } finally {
    Object.assign(globalThis, { document: previous });
  }
}
test("the shortcut coalesces a 100ms double activation even after a fast receipt", () =>
  dom((document) => {
    const control = document.createElement("button");
    assert.equal(claimActivation(control, 300, 1000), true);
    assert.equal(claimActivation(control, 300, 1100), false);
    assert.equal(claimActivation(control, 300, 1300), true);
    assert.equal(claimActivation(document.createElement("button"), 300, 1100), true);
  }));
test("$ref and siblings retain conjunctive constraints through an explicit local JSON editor", () =>
  dom((document) => {
    const schema = {
      type: "object",
      $defs: {
        base: {
          type: "object",
          additionalProperties: false,
          properties: { requiredText: { type: "string" } },
          required: ["requiredText"],
        },
      },
      $ref: "#/$defs/base",
      properties: { unusedOptional: { type: "number" } },
    };
    const contract = compileInputSchema(schema);
    const legal = { requiredText: "valid" };
    contract.validate(legal);
    const editor = schemaEditor(schema, {});
    document.body.append(editor.node);
    assert.match(editor.node.textContent ?? "", /联合生效/);
    const json = editor.node.querySelector("textarea");
    assert.ok(json);
    json.value = JSON.stringify(legal);
    assert.deepEqual(editor.read(), legal);
    assert.deepEqual(contract.validate(editor.read()), legal);
    json.value = "{}";
    assert.throws(() => contract.validate(editor.read()));
    json.value = "[]";
    assert.throws(() => editor.read(), /对象 JSON/);
    const retained = schemaEditor(schema, legal);
    assert.deepEqual(retained.read(), legal);
  }));

test("schema fields read only own constructor and __proto__ values", () =>
  dom((document) => {
    const schema = JSON.parse(
      '{"type":"object","additionalProperties":false,"required":["constructor","__proto__"],"properties":{"constructor":{"type":"string"},"__proto__":{"type":"string"}}}',
    );
    const empty = schemaEditor(schema, {});
    document.body.append(empty.node);
    assert.equal(empty.node.querySelectorAll('input[type="text"]').length, 2);
    assert.deepEqual(
      [...empty.node.querySelectorAll<HTMLInputElement>('input[type="text"]')].map(
        (input) => input.value,
      ),
      ["", ""],
    );
    const own = JSON.parse('{"constructor":"own constructor","__proto__":"own proto"}');
    const editor = schemaEditor(schema, own);
    assert.deepEqual(editor.read(), own);
    assert.equal(Object.getPrototypeOf(editor.read()), Object.prototype);
    compileInputSchema(schema).validate(editor.read());
  }));

test("continuous keyed rendering retains disclosures, summaries, task buttons and event nodes as counts change", () =>
  dom((document) => {
    const root = document.createElement("div");
    document.body.append(root);
    const view = (count: number) => {
      const box = document.createElement("div");
      box.dataset.key = "endpoint:task:1";
      const task = document.createElement("button");
      task.dataset.key = "task:1";
      task.textContent = `Task 1 · 更新 ${count}`;
      const details = document.createElement("details");
      details.dataset.key = "all-events";
      const summary = document.createElement("summary");
      summary.textContent = `全部公开事件（${count}）`;
      details.append(summary);
      for (let index = 0; index < count; index++) {
        const event = document.createElement("details");
        event.dataset.key = `event:${index}`;
        const title = document.createElement("summary");
        title.textContent = `progress ${index}`;
        event.append(title);
        details.append(event);
      }
      box.append(task, details);
      return box;
    };
    reconcile(root, [view(1)]);
    const details = root.querySelector<HTMLDetailsElement>('[data-key="all-events"]')!;
    const summary = details.querySelector("summary");
    const event = details.querySelector('[data-key="event:0"]');
    const task = root.querySelector("button");
    details.open = true;
    for (let count = 2; count < 20; count++) {
      reconcile(root, [view(count)]);
      assert.equal(root.querySelector('[data-key="all-events"]'), details);
      assert.equal(details.querySelector("summary"), summary);
      assert.equal(root.querySelector("button"), task);
      assert.equal(details.querySelector('[data-key="event:0"]'), event);
      assert.equal(details.open, true);
      assert.equal(summary?.textContent, `全部公开事件（${count}）`);
    }
  }));

const initial: TaskSnapshot = {
  taskId: newIdentity(),
  requestId: newIdentity(),
  seriesId: newIdentity(),
  stage: "initial",
  receivedAt: "2026-10-31T02:00:00.000Z",
  eligibleAt: "2026-10-31T02:00:00.000Z",
  deadlineAt: "2026-10-31T03:00:00.000Z",
  timestamp: "2026-10-31T02:00:00.000Z",
};
test("causally newer snapshots survive clock rollback and receipt replay", () => {
  const tasks = new TaskSnapshots();
  tasks.seed(initial);
  const running: TaskSnapshot = {
    ...initial,
    stage: "running",
    timestamp: "2026-10-31T01:00:00.000Z",
    execution: { executionId: newIdentity(), startedAt: "2026-10-31T01:00:00.000Z" },
  };
  assert.equal(tasks.observe(running, 12), true);
  tasks.seed(initial);
  assert.equal(tasks.values.get(initial.taskId), running);
  const oldRead = tasks.begin(initial.taskId);
  const canceled = {
    ...running,
    canceledAt: "2026-10-31T00:50:00.000Z",
    timestamp: "2026-10-31T00:50:00.000Z",
  };
  assert.equal(tasks.observe(canceled, 15), true);
  assert.equal(oldRead(initial), false);
  assert.equal(tasks.observe(running, 12), false);
  assert.equal(tasks.values.get(initial.taskId), canceled);
});
test("confirmed cancellation cannot be withdrawn by buffered SSE with a larger global watermark", () => {
  const tasks = new TaskSnapshots();
  const running: TaskSnapshot = { ...initial, stage: "running" };
  tasks.observe(running, 10);
  const oldRead = tasks.begin(initial.taskId);
  const latest = tasks.begin(initial.taskId);
  const canceled = {
    ...running,
    canceledAt: "2026-10-31T01:00:00.000Z",
    timestamp: "2026-10-31T01:00:00.000Z",
  };
  assert.equal(latest(canceled), true);
  assert.equal(oldRead(initial), false);
  assert.equal(tasks.observe(running, 20), false);
  assert.equal(tasks.values.get(initial.taskId), canceled);
  assert.equal(tasks.observe({ ...canceled, timestamp: "2026-10-31T00:59:00.000Z" }, 21), true);
});
test("in-flight cancellation receipts survive an intervening running observation and stream failure", () => {
  for (const begin of ["beginCancellation", "begin"] as const) {
    const tasks = new TaskSnapshots();
    const running: TaskSnapshot = { ...initial, stage: "running" };
    tasks.observe(running, 10);
    const acceptCancel = tasks[begin](initial.taskId);
    tasks.observe({ ...running, timestamp: "2026-10-31T01:59:00.000Z" }, 11);
    const canceled = {
      ...running,
      canceledAt: "2026-10-31T01:50:00.000Z",
      timestamp: "2026-10-31T01:50:00.000Z",
    };
    assert.equal(acceptCancel(canceled), true);
    assert.equal(tasks.values.get(initial.taskId)?.canceledAt, canceled.canceledAt);
    tasks.seed(initial);
    assert.equal(tasks.observe(running, 99), false);
    assert.equal(tasks.values.get(initial.taskId)?.canceledAt, canceled.canceledAt);
  }
});
test("ordinary late GETs remain discardable; cancellation requires a real receipt and freezes Task facts", () => {
  const tasks = new TaskSnapshots();
  tasks.observe(initial, 10);
  const lateRead = tasks.begin(initial.taskId);
  const running: TaskSnapshot = {
    ...initial,
    stage: "running",
    timestamp: "2026-10-31T01:00:00.000Z",
  };
  tasks.observe(running, 11);
  assert.equal(lateRead(initial), false);
  assert.throws(() => tasks.beginCancellation(initial.taskId)(running), /未确认/);
  const canceled = { ...running, canceledAt: "2026-10-31T00:59:00.000Z" };
  tasks.beginCancellation(initial.taskId)(canceled);
  assert.equal(
    tasks.observe({ ...canceled, stage: "completed", timestamp: "2026-10-31T00:58:00.000Z" }, 21),
    true,
  );
  assert.equal(tasks.values.get(initial.taskId)?.stage, "running");
  assert.equal(tasks.values.get(initial.taskId)?.timestamp, "2026-10-31T00:58:00.000Z");
  assert.throws(() => tasks.observe(running, Number.NaN), /watermark/);
});
test("submission change notifications never replay accepted snapshots", async () => {
  const tasks = new TaskSnapshots();
  let seeds = 0;
  const bar = new SubmissionBar(
    async (entry) => ({ ...initial, requestId: entry.id }),
    () => {},
    (entry) => {
      seeds++;
      tasks.seed(entry.snapshot!);
    },
  );
  const endpoint = { id: "one", label: "one", binding: "one" };
  await bar.quick(endpoint, { type: "echo" }, "a".repeat(64));
  const canceled = {
    ...initial,
    canceledAt: "2026-10-31T01:00:00.000Z",
    timestamp: "2026-10-31T01:00:00.000Z",
  };
  tasks.observe(canceled, 12);
  const batch = bar.create(endpoint);
  bar.add(batch, { type: "echo" }, "a".repeat(64));
  bar.changed();
  assert.equal(seeds, 1);
  assert.equal(tasks.values.get(initial.taskId), canceled);
});
test("late directory errors cannot replace a newer success", async () => {
  const directory = new Directory();
  let rejectOld: (error: Error) => void = () => {};
  const old = directory.load(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
    "type=old",
  );
  await directory.load(
    async () => ({ tasks: [], observedAt: "new", expiresAt: "later" }),
    "type=new",
  );
  rejectOld(new ApiError(410, "query_expired", "old query expired"));
  assert.equal(await old, false);
  assert.equal(directory.error, "");
  assert.equal(directory.expired, false);
  assert.equal(directory.page!.observedAt, "new");
});
test("late directory successes cannot clear a newer error and invalid queries supersede pending pages", async () => {
  const directory = new Directory();
  let resolveOld: (value: { tasks: []; observedAt: string; expiresAt: string }) => void = () => {};
  const old = directory.load(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    "type=old",
  );
  await assert.rejects(() =>
    directory.load(async () => {
      throw new ApiError(403, "forbidden", "new denial");
    }, "type=new"),
  );
  resolveOld({ tasks: [], observedAt: "old", expiresAt: "later" });
  assert.equal(await old, false);
  assert.match(directory.error, /new denial/);
  const pending = directory.load(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    "type=another",
  );
  directory.rejectQuery(new Error("invalid date"));
  resolveOld({ tasks: [], observedAt: "another", expiresAt: "later" });
  assert.equal(await pending, false);
  assert.match(directory.error, /invalid date/);
});
