import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BehaviorCoordinator,
  CoordinatorModel,
  coordinator,
  type RequestModel,
} from "@potential-guide/regulation-coordinator";

test("package exports expose timed requests, replay cursors and structured exhaustion", () => {
  const schedule: RequestModel.RequestSchedule = {
    eligibleAt: "2026-10-27T00:00:00Z",
    recurrence: { intervalMs: 100 },
    replacesRequestRef: "previous",
  };
  const outcome: CoordinatorModel.RunOutcome = {
    kind: "exhausted",
    reason: "agent-runs",
    message: "Quota consumed.",
    usage: { agentRuns: 3 },
  };
  const methods: (keyof BehaviorCoordinator)[] = [
    "cancel",
    "eventsSince",
    "snapshot",
    "flush",
    "changes",
  ];
  const state = CoordinatorModel.createCoordinatorState("public-consumer");
  assert.equal(typeof coordinator, "function");
  assert.equal(schedule.recurrence?.intervalMs, 100);
  assert.equal(outcome.reason, "agent-runs");
  assert.ok(methods.includes("eventsSince"));
  assert.deepEqual(CoordinatorModel.eventsSince(state, 0), []);
  assert.deepEqual(CoordinatorModel.exhaustionEvents(state, 0), []);
  assert.throws(() => CoordinatorModel.eventsSince(state, 1), /cursor/);
});
