import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryPage, PublicEvent, TaskSnapshot } from "@potential-guide/task-protocol";
import { parseHTML } from "linkedom";
import { envelopeSchema, resolvedSchema, schemaEditor } from "../src/form.js";
import { assertFiniteJson } from "../src/json.js";
import {
  ApiError,
  Directory,
  EventWindow,
  endpointMatches,
  newIdentity,
  originalParameters,
  Selection,
  SubmissionBar,
} from "../src/model.js";

const endpoint = { id: "one", label: "one", binding: "stable" };
test("nonfinite JSON is rejected rather than serialized as null", () => {
  assert.throws(() => assertFiniteJson(JSON.parse('{"nested":[1e400]}')), /有限/);
  assert.doesNotThrow(() => assertFiniteJson({ false: false, null: null, number: 2 }));
});
test("unknown then 412 remains unknown; batch continues and all retries preserve identity and guard", async () => {
  const calls: { id: string; revision: string }[] = [];
  let attempt = 0;
  const bar = new SubmissionBar(async (entry) => {
    calls.push({ id: entry.id, revision: entry.revision });
    attempt++;
    if (attempt === 1) throw new Error("connection lost");
    if (attempt === 3) throw new ApiError(412, "contract_revision_mismatch", "changed");
    return {
      taskId: newIdentity(),
      requestId: entry.id,
      seriesId: newIdentity(),
      stage: "initial",
      receivedAt: new Date().toISOString(),
      eligibleAt: new Date().toISOString(),
      deadlineAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    } as TaskSnapshot;
  });
  const batch = bar.create(endpoint);
  const unknown = bar.add(
    batch,
    { type: "echo", nested: { digest: "business-only" } },
    "a".repeat(64),
  );
  const second = bar.add(batch, { type: "echo" }, "a".repeat(64));
  await bar.sendBatch(batch);
  assert.equal(unknown.state, "unknown");
  assert.equal(second.state, "accepted");
  await bar.retry(unknown);
  assert.equal(unknown.state, "unknown");
  assert.deepEqual(calls[0], calls[2]);
  assert.match(unknown.message, /412/);
  assert.deepEqual(unknown.parameters, { type: "echo", nested: { digest: "business-only" } });
  await bar.sendBatch(batch);
  assert.equal(calls.length, 3);
});
test("selection invalidates late work without changing original submission endpoint", () => {
  const selection = new Selection();
  selection.select(endpoint);
  const first = selection.capture();
  selection.select({ ...endpoint, id: "two", binding: "other" });
  assert.equal(first.current(), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(endpointMatches(endpoint, selection.endpoint!), false);
});
test("malformed success response is unknown, never an accepted-shaped fallback", async () => {
  const bar = new SubmissionBar(async () => ({}) as TaskSnapshot);
  const entry = await bar.quick(endpoint, { type: "echo" }, "a".repeat(64));
  assert.equal(entry.state, "unknown");
  assert.equal(entry.snapshot, undefined);
});
test("a newer directory query cannot be overwritten by an older in-flight page", async () => {
  const directory = new Directory();
  let release: (page: { tasks: []; observedAt: string; expiresAt: string }) => void = () => {};
  const old = directory.load(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    "type=old",
  );
  await directory.load(
    async () => ({ tasks: [], observedAt: "new", expiresAt: "later" }),
    "type=new",
  );
  release({ tasks: [], observedAt: "old", expiresAt: "later" });
  await old;
  assert.equal(directory.page!.observedAt, "new");
  assert.equal(directory.query, "type=new");
});
test("directory uses original filters and ignores a late page after endpoint switch", async () => {
  const directory = new Directory();
  const page = { tasks: [], observedAt: "now", expiresAt: "later", next: "directory-only" };
  await directory.load(async () => page, "type=old&sort=created-desc");
  await directory.load(
    async (query) => {
      assert.equal(new URLSearchParams(query).get("type"), "old");
      assert.equal(new URLSearchParams(query).get("cursor"), "directory-only");
      return { ...page, observedAt: "foreign" };
    },
    "type=changed",
    true,
    () => false,
  );
  assert.equal(directory.page!.observedAt, "now");
  await assert.rejects(() =>
    directory.load(async () => {
      throw new ApiError(403, "forbidden", "denied");
    }, ""),
  );
  assert.equal(directory.page!.observedAt, "now");
});
test("events deduplicate by sequence, do not infer gaps and independently bound history/stream state", () => {
  const window = new EventWindow();
  const events = Array.from(
    { length: 600 },
    (_, index) =>
      ({
        sequence: index * 3,
        type: "execution.progress",
        occurredAt: "now",
        scope: "one",
        data: { index },
      }) as PublicEvent,
  );
  window.history({
    events: events.slice(0, 5),
    cursor: "history-resume",
    next: "history-next",
    watermark: 20,
  } as HistoryPage);
  window.observation({ events, cursor: "stream-cursor", snapshots: [], watermark: 2000 });
  window.merge(events.slice(-10));
  assert.equal(window.events.length, 500);
  assert.equal(window.truncated, true);
  assert.equal(window.gap, "");
  assert.equal(window.historyNext, "history-next");
  assert.equal(window.streamCursor, "stream-cursor");
});
test("original parameters remove only generated requestId, not user series/eligibility or business locks", () => {
  const original = {
    requestId: newIdentity(),
    type: "any",
    seriesId: newIdentity(),
    eligibleAt: "2026-01-01T00:00:00Z",
    timeoutMs: 20,
    url: "floating",
    digest: "pin",
  };
  const parameters = originalParameters(original);
  assert.equal("requestId" in parameters, false);
  assert.equal(parameters.seriesId, original.seriesId);
  assert.equal(parameters.digest, "pin");
  assert.equal("version" in parameters, false);
});
test("schema fields render scalars, arrays, nested refs, free objects and preserve false/null/extra values", () => {
  const { document, window } = parseHTML("<html><body></body></html>");
  const previous = { document: globalThis.document, Option: globalThis.Option };
  Object.assign(globalThis, {
    document,
    Option: function Option(text: string, value: string) {
      const option = document.createElement("option");
      option.textContent = text;
      option.value = value;
      return option;
    },
  });
  try {
    const schema = {
      type: "object",
      required: ["nested", "values", "free"],
      $defs: {
        child: {
          type: "object",
          properties: { text: { type: "string" }, number: { type: "number" } },
          required: ["text", "number"],
        },
      },
      properties: {
        nested: { $ref: "#/$defs/child" },
        values: { type: "array", items: { type: "integer" } },
        free: { type: "object" },
        absent: { type: "string", default: "must-not-insert" },
      },
    };
    const original = {
      nested: { text: "<img src=x onerror=alert(1)>", number: 2.5 },
      values: [0, -1],
      free: { false: false, null: null },
      extra: "kept",
    };
    const editor = schemaEditor(schema, original);
    document.body.append(editor.node);
    assert.deepEqual(editor.read(), original);
    assert.equal(document.querySelector("img"), null);
    assert.equal(document.querySelectorAll('input[type="text"]').length, 5);
    assert.equal(document.querySelectorAll("textarea").length, 3);
    assert.equal("absent" in (editor.read() as object), false);
    const common = schemaEditor(envelopeSchema, { timeoutMs: 250 });
    assert.deepEqual(common.read(), { timeoutMs: 250 });
    const timeout = common.node.querySelector('input[type="text"]') as HTMLInputElement;
    timeout.value = "0250";
    assert.throws(() => common.read(), /JSON 数字/);
    timeout.value = "250";
    assert.equal((common.read() as { timeoutMs: number }).timeoutMs, 250);
    const resolved = resolvedSchema({ $ref: "#/$defs/child" }, schema) as Record<string, unknown>;
    assert.equal(resolved.type, "object");
    assert.throws(() => resolvedSchema({ $ref: "https://invalid/schema" }, schema), /引用/);
    assert.ok(window);
  } finally {
    Object.assign(globalThis, previous);
  }
});
