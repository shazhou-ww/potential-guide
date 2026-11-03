import assert from "node:assert/strict";
import test from "node:test";
import { ErrorLog } from "../src/error-log.js";

test("error states survive recovery, deduplicate renders and count repeated failures", () => {
  const log = new ErrorLog();
  log.observe("demo / tasks", "disconnected", "Demo / 任务目录");
  log.observe("demo / tasks", "disconnected");
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0]!.label, "Demo / 任务目录");
  assert.equal(log.entries[0]!.source, "demo / tasks");
  assert.equal(log.entries[0]!.count, 1);
  log.observe("demo / tasks", "");
  assert.equal(log.entries[0]!.resolved, true);
  log.observe("demo / tasks", "disconnected");
  assert.equal(log.entries[0]!.count, 2);
  assert.equal(log.entries[0]!.resolved, false);
  log.observe("other / tasks", "disconnected");
  assert.equal(log.entries.length, 2);
  log.clear(log.entries[0]!.id);
  assert.equal(log.entries.length, 1);
  log.clear();
  assert.equal(log.entries.length, 0);
  log.observe("demo / tasks", "disconnected");
  assert.equal(log.entries.length, 0, "clearing does not re-log an unchanged failure each render");
  log.observe("demo / tasks", "");
  log.observe("demo / tasks", "disconnected");
  assert.equal(log.entries.length, 1);
});

test("explicit action errors count each attempt and error storage is bounded", () => {
  const log = new ErrorLog();
  log.record("operation", "denied");
  log.record("operation", "denied");
  assert.equal(log.entries[0]!.count, 2);
  for (let index = 0; index < 120; index++) log.record("operation", `error ${index}`);
  assert.equal(log.entries.length, 100);
  assert.equal(log.entries[0]!.message, "error 119");
});
