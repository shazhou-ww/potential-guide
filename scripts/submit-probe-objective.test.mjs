import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { TaskError } from "../packages/task-protocol/dist/index.js";
import { submitProbeObjective } from "./submit-probe-objective.mjs";

const requestId = "01M6WN0Z05FRRE22VYJ3C90JV7";
function fixture(overrides = {}, budgets = {}) {
  const calls = [];
  const events = [];
  const accepted = { status: "accepted", requestId, taskId: "child-task" };
  const completed = { taskId: "child-task", stage: "completed", result: { level: "terminal" } };
  const client = {
    async submit(request) {
      calls.push(["submit", request]);
      return accepted;
    },
    async getRequestStatus(id) {
      calls.push(["status", id]);
      return accepted;
    },
    async getTask(id) {
      calls.push(["task", id]);
      return completed;
    },
    async cancelTask(id) {
      calls.push(["cancel", id]);
      return { taskId: id, canceled: true };
    },
    ...overrides,
  };
  return {
    calls,
    events,
    completed,
    run: () =>
      submitProbeObjective({
        client,
        requestId,
        cid: "prebuilt-probe-cid",
        input: { subject: "business" },
        report: (event) => events.push(event),
        ...budgets,
      }),
  };
}
test("successful submission returns the existing Engine result without reconciliation", async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), f.completed);
  assert.deepEqual(
    f.calls.map(([action]) => action),
    ["submit", "task"],
  );
  assert.equal(f.calls[0][1].requestId, requestId);
  assert.equal(f.calls[0][1].bundle, "prebuilt-probe-cid");
});
test("known admission rejection retains its code and does not reconcile", async () => {
  let statusReads = 0;
  const f = fixture({
    async submit() {
      return {
        status: "rejected",
        requestId,
        error: { code: "invalid_input", message: "Bad business input" },
      };
    },
    async getRequestStatus() {
      statusReads++;
    },
  });
  await assert.rejects(
    f.run(),
    (error) =>
      error.code === "invalid_input" &&
      error.message === "Bad business input" &&
      error.details.requestId === requestId,
  );
  assert.equal(statusReads, 0);
});
for (const primary of [
  new TaskError("forbidden", "Access denied"),
  new TaskError("invalid_bundle", "Wrong root"),
  new TaskError("transport_error", "HTTP 403"),
  new TypeError("Invalid author input"),
  new SyntaxError("Unexpected end of JSON input"),
  new TypeError("fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } }),
])
  test(`nontransport ${primary.message} is propagated unchanged`, async () => {
    let statusReads = 0;
    const f = fixture({
      async submit() {
        throw primary;
      },
      async getRequestStatus() {
        statusReads++;
      },
    });
    await assert.rejects(f.run(), (error) => error === primary);
    assert.equal(statusReads, 0);
    assert.equal(
      f.events.some((event) => event.event === "submission_reconciliation"),
      false,
    );
  });
test("lost response reconciles only by the original ID and retains primary diagnostics", async () => {
  const primary = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
  let submissions = 0;
  const f = fixture({
    async submit(request) {
      submissions++;
      assert.equal(request.requestId, requestId);
      throw primary;
    },
  });
  assert.deepEqual(await f.run(), f.completed);
  assert.equal(submissions, 1);
  assert.deepEqual(f.calls[0], ["status", requestId]);
  assert.equal(
    f.events.find((event) => event.event === "submission_reconciliation").original.message,
    primary.message,
  );
  assert.ok(
    f.events.some(
      (event) => event.event === "submission_reconciled" && event.requestId === requestId,
    ),
  );
});
test("failed reconciliation preserves both errors, original cause and request identity", async () => {
  const primary = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
  const lookup = new TaskError("not_found", "No durable decision found");
  const f = fixture({
    async submit() {
      throw primary;
    },
    async getRequestStatus(id) {
      assert.equal(id, requestId);
      throw lookup;
    },
  });
  await assert.rejects(
    f.run(),
    (error) =>
      error instanceof AggregateError &&
      error.cause === primary &&
      error.errors[0] === primary &&
      error.errors[1] === lookup &&
      error.message.includes(requestId) &&
      error.message.includes(lookup.message),
  );
  assert.ok(f.events.some((event) => event.event === "submission_uncertain"));
});
test("observation deadline cancels known demand without claiming physical release", async () => {
  let clock = 0;
  const f = fixture(
    {
      async getTask() {
        return { stage: "running" };
      },
    },
    {
      observationMs: 10,
      now: () => clock,
      sleep: async () => {
        clock = 10;
      },
    },
  );
  await assert.rejects(
    f.run(),
    (error) => error.code === "observation_timeout" && error.message.includes(requestId),
  );
  assert.deepEqual(f.calls.at(-1), ["cancel", "child-task"]);
  assert.equal(
    f.events.find((event) => event.event === "cancellation_acknowledged").physicalReleaseConfirmed,
    false,
  );
});
test("a stalled submit is bounded and cleanup reconciles its same request ID", async () => {
  const f = fixture({ submit: () => new Promise(() => {}) }, { observationMs: 10, cleanupMs: 100 });
  await assert.rejects(f.run(), { code: "observation_timeout" });
  assert.deepEqual(f.calls, [
    ["status", requestId],
    ["cancel", "child-task"],
  ]);
});
test("cleanup failure keeps deadline context and explicitly reports uncertainty", async () => {
  let clock = 0;
  const cleanupError = new TaskError("forbidden", "Cancellation denied");
  const f = fixture(
    {
      async getTask() {
        return { stage: "running" };
      },
      async cancelTask() {
        throw cleanupError;
      },
    },
    {
      observationMs: 10,
      now: () => clock,
      sleep: async () => {
        clock = 10;
      },
    },
  );
  await assert.rejects(
    f.run(),
    (error) =>
      error instanceof AggregateError &&
      error.cause.code === "observation_timeout" &&
      error.errors[1] === cleanupError &&
      error.message.includes(requestId),
  );
  assert.ok(
    f.events.some(
      (event) => event.event === "cleanup_uncertain" && event.physicalReleaseConfirmed === false,
    ),
  );
});
test("cleanup itself has an independent finite budget", async () => {
  let clock = 0;
  const f = fixture(
    {
      async getTask() {
        return { stage: "running" };
      },
      cancelTask: () => new Promise(() => {}),
    },
    {
      observationMs: 10,
      cleanupMs: 10,
      now: () => clock,
      sleep: async () => {
        clock = 10;
      },
    },
  );
  await assert.rejects(
    f.run(),
    (error) =>
      error instanceof AggregateError &&
      error.cause.code === "observation_timeout" &&
      error.errors[1].code === "cleanup_timeout",
  );
  assert.ok(
    f.events.some(
      (event) => event.event === "cleanup_uncertain" && !event.physicalReleaseConfirmed,
    ),
  );
});
test("import is inert; the runner neither starts an Engine nor builds a Bundle", async () => {
  const module = new URL("./submit-probe-objective.mjs", import.meta.url);
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    `await import(${JSON.stringify(module.href)})`,
  ]);
  assert.equal(stdout, "");
  assert.equal(stderr, "");
  const source = await readFile(module, "utf8");
  assert.doesNotMatch(source, /createTaskEngine|startTaskServer|buildTask|buildAll|child_process/);
});
