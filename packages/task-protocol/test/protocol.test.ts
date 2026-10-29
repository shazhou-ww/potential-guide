import assert from "node:assert/strict";
import test from "node:test";
import { at, emptyFacts, isTimedOut, json, reduce, type TaskSnapshot } from "../src/index.js";

test("finite JSON never invokes accessors/toJSON and rejects non-JSON structures", () => {
  let invoked = 0;
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      invoked++;
      return 1;
    },
  });
  const toJSON = {
    toJSON() {
      invoked++;
      return 1;
    },
  };
  const sparse = new Array(2);
  const decorated: unknown[] & { extra?: number } = [1];
  decorated.extra = 2;
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  for (const value of [
    accessor,
    toJSON,
    sparse,
    decorated,
    cyclic,
    new Date(),
    Object.create(null),
    Infinity,
    NaN,
    undefined,
    1n,
    { a: undefined },
    Object.assign({}, { [Symbol()]: 1 }),
  ])
    assert.throws(() => json(value));
  assert.equal(invoked, 0);
  assert.deepEqual(json({ x: [1, null, false, "text"] }), { x: [1, null, false, "text"] });
  assert.throws(() => json("💡".repeat(100), 20), { code: "payload_too_large" });
});

test("time projection freezes effective end and deadline equality", () => {
  const snapshot: TaskSnapshot = {
    taskId: "t",
    requestId: "r",
    seriesId: "s",
    stage: "initial",
    receivedAt: at(0),
    eligibleAt: at(0),
    deadlineAt: at(10),
    timestamp: at(10),
  };
  assert.equal(isTimedOut(snapshot), false);
  assert.equal(isTimedOut({ ...snapshot, timestamp: at(11) }), true);
  assert.equal(isTimedOut({ ...snapshot, timestamp: at(100), canceledAt: at(10) }), false);
  assert.equal(isTimedOut({ ...snapshot, timestamp: at(100), canceledAt: at(11) }), true);
  assert.throws(() => at(Number.MAX_SAFE_INTEGER));
});

test("pure reducer rejects gaps and derived notifications", () => {
  assert.throws(() => reduce(emptyFacts(), [{ sequence: 2, type: "task.updated" } as never]), {
    code: "history_gap",
  });
  assert.throws(
    () => reduce(emptyFacts(), [{ sequence: 1, type: "task.updated", occurredAt: at(0) } as never]),
    {
      code: "invalid_fact",
    },
  );
});
