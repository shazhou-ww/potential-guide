import { at, fail, timestamp } from "./json.js";
import type { ExecutionMatch, ExecutionRecord, FactEvent, Facts, TaskSnapshot } from "./types.js";

export function matchesExecutionTime(
  policy: ExecutionMatch,
  eligibleAt: string,
  execution: Pick<ExecutionRecord, "startedAt" | "completedAt" | "failedAt">,
): boolean {
  switch (policy) {
    case "started-after-eligible":
      return execution.startedAt >= eligibleAt;
    case "terminated-after-eligible": {
      const end = execution.completedAt ?? execution.failedAt;
      return end !== undefined && end >= eligibleAt;
    }
    default:
      return fail("invalid_request", "Unsupported executionMatch.");
  }
}

export function emptyFacts(): Facts {
  return { projectionVersion: 2, watermark: 0, tasks: {}, executions: {} };
}

export function assertFactsVersion(facts: Facts): void {
  if (facts?.projectionVersion !== 2)
    fail(
      "unsupported_version",
      "Unsupported Task facts. Use new storage; old data is not migrated.",
    );
  for (const record of [...Object.values(facts.tasks), ...Object.values(facts.executions)])
    if (
      record.binding.executionMatch !== "started-after-eligible" &&
      record.binding.executionMatch !== "terminated-after-eligible"
    )
      fail("unsupported_version", "Unsupported stored executionMatch. Use new storage.");
  for (const task of Object.values(facts.tasks))
    if (
      task.request.executionMatch !== undefined &&
      task.request.executionMatch !== "started-after-eligible" &&
      task.request.executionMatch !== "terminated-after-eligible"
    )
      fail("unsupported_version", "Unsupported stored request executionMatch. Use new storage.");
}

export function authorizeSync(authorize: () => unknown): void {
  const result = authorize();
  if (result !== undefined) {
    // Drain rejected async callbacks without treating an unresolved grant as authorization.
    if (result && typeof (result as PromiseLike<unknown>).then === "function")
      void Promise.resolve(result).catch(() => {});
    fail("invalid_type", "Authorization must return synchronously without a value.");
  }
}

export function reduce(prefix: Facts, events: readonly FactEvent[]): Facts {
  assertFactsVersion(prefix);
  const facts = structuredClone(prefix);
  for (const event of events) {
    if (event.sequence <= facts.watermark) continue;
    if (event.sequence !== facts.watermark + 1) fail("history_gap", "Non-contiguous event prefix.");
    timestamp(event.occurredAt);
    const task = event.taskId ? facts.tasks[event.taskId] : undefined;
    const execution = event.executionId ? facts.executions[event.executionId] : undefined;
    const snapshot = task?.snapshot;
    const frozen = snapshot?.canceledAt !== undefined;
    if (event.type.startsWith("task.") && event.type !== "task.created" && !task)
      fail("invalid_fact", "Task fact references a missing Task.");
    if (event.type.startsWith("execution.") && event.type !== "execution.started" && !execution)
      fail("invalid_fact", "Execution fact references a missing Execution.");
    if (task && task.binding.scope !== event.scope)
      fail("invalid_fact", "Task fact scope mismatch.");
    if (execution && execution.binding.scope !== event.scope)
      fail("invalid_fact", "Execution fact scope mismatch.");
    switch (event.type) {
      case "task.created":
        if (
          event.data.task.snapshot.stage !== "initial" ||
          event.data.task.receivedSequence !== event.sequence ||
          event.taskId !== event.data.task.snapshot.taskId ||
          event.scope !== event.data.task.binding.scope
        )
          fail("invalid_fact", "Invalid Task creation fact.");
        if (facts.tasks[event.data.task.snapshot.taskId]) fail("invalid_fact", "Duplicate Task.");
        matchesExecutionTime(event.data.task.binding.executionMatch, event.occurredAt, {
          startedAt: event.occurredAt,
        });
        facts.tasks[event.data.task.snapshot.taskId] = structuredClone(event.data.task);
        break;
      case "task.preparation.started":
        if (snapshot && !frozen) {
          if (!["initial", "preparing"].includes(snapshot.stage))
            fail("invalid_fact", "Preparation already completed.");
          snapshot.stage = "preparing";
          snapshot.preparation = { startedAt: event.occurredAt };
        }
        break;
      case "task.preparation.completed":
        if (task && snapshot && !frozen) {
          if (snapshot.stage !== "preparing") fail("invalid_fact", "Preparation was not started.");
          task.prepared = event.data.prepared;
          snapshot.stage = "queued";
          if (snapshot.preparation) snapshot.preparation.completedAt = event.occurredAt;
        }
        break;
      case "task.preparation.failed":
        if (snapshot && !frozen) {
          snapshot.stage = "preparation_failed";
          snapshot.error = event.data.error;
          if (snapshot.preparation) snapshot.preparation.failedAt = event.occurredAt;
        }
        break;
      case "task.allocation.failed":
        if (snapshot && !frozen) {
          snapshot.stage = "allocation_failed";
          snapshot.allocation = { failedAt: event.occurredAt };
          snapshot.error = event.data.error;
        }
        break;
      case "task.allocation.bound": {
        const target = facts.executions[event.data.executionId];
        if (!target) fail("invalid_fact", "Binding references missing Execution.");
        if (snapshot && !frozen) {
          const boundary =
            task?.binding.executionMatch === "started-after-eligible"
              ? target.startedSequence
              : target.terminatedSequence;
          const time =
            task?.binding.executionMatch === "started-after-eligible"
              ? target.startedAt
              : (target.completedAt ?? target.failedAt);
          if (
            !task ||
            snapshot.execution ||
            snapshot.termination ||
            !["initial", "preparing", "queued"].includes(snapshot.stage) ||
            target.binding.scope !== event.scope ||
            target.binding.type !== task.binding.type ||
            target.binding.version !== task.binding.version ||
            target.binding.environment !== task.binding.environment ||
            (target.sealed && !target.sealedTaskIds?.includes(snapshot.taskId)) ||
            boundary === undefined ||
            boundary <= prefix.watermark ||
            task.receivedSequence >= boundary ||
            time !== event.occurredAt ||
            !matchesExecutionTime(task.binding.executionMatch, snapshot.eligibleAt, target)
          )
            fail("invalid_fact", "Illegal execution binding.");
          snapshot.stage = "running";
          snapshot.allocation = { boundAt: event.occurredAt };
          snapshot.execution = { executionId: target.executionId, startedAt: target.startedAt };
        }
        break;
      }
      case "execution.started":
        if (
          event.executionId !== event.data.execution.executionId ||
          event.scope !== event.data.execution.binding.scope ||
          event.sequence !== event.data.execution.startedSequence ||
          event.occurredAt !== event.data.execution.startedAt
        )
          fail("invalid_fact", "Invalid execution startup identity/time.");
        if (execution) fail("invalid_fact", "Duplicate Execution.");
        matchesExecutionTime(event.data.execution.binding.executionMatch, event.occurredAt, {
          startedAt: event.occurredAt,
        });
        facts.executions[event.data.execution.executionId] = structuredClone(event.data.execution);
        break;
      case "execution.completed":
        if (!execution || execution.completedAt || execution.failedAt)
          fail("invalid_fact", "Execution already ended or missing.");
        execution.completedAt = event.occurredAt;
        execution.terminatedSequence = event.sequence;
        execution.result = event.data.result;
        break;
      case "execution.failed":
        if (!execution || execution.completedAt || execution.failedAt)
          fail("invalid_fact", "Execution already ended or missing.");
        execution.failedAt = event.occurredAt;
        execution.terminatedSequence = event.sequence;
        execution.error = event.data.error;
        break;
      case "execution.sealed":
        if (execution) {
          if (execution.sealed) fail("invalid_fact", "Execution already sealed.");
          execution.sealed = true;
          execution.sealedTaskIds = [...event.data.taskIds];
        }
        break;
      case "execution.reclaimed":
        if (execution) execution.reclaimedAt = event.occurredAt;
        break;
      case "execution.progress":
        break;
      case "task.terminated":
        if (snapshot && !frozen && !snapshot.termination) {
          const target = event.data.executionId
            ? facts.executions[event.data.executionId]
            : undefined;
          if (event.data.executionId && snapshot.execution?.executionId !== event.data.executionId)
            fail("invalid_fact", "Termination must use the Task's bound Execution.");
          if (!target && !["preparation_failed", "allocation_failed"].includes(snapshot.stage))
            fail("invalid_fact", "Termination lacks a final process fact.");
          if (target && snapshot.execution) {
            if (target.completedAt) {
              snapshot.stage = "completed";
              snapshot.execution.completedAt = target.completedAt;
            } else if (target.failedAt) {
              snapshot.stage = "execution_failed";
              snapshot.execution.failedAt = target.failedAt;
              if (target.error) snapshot.error = target.error;
            } else fail("invalid_fact", "Termination references unfinished Execution.");
          }
          snapshot.termination = { terminatedAt: event.occurredAt };
        }
        break;
      case "task.canceled":
        if (task && snapshot && !snapshot.termination && !frozen) {
          const ids = event.data.executionIds ?? [];
          if (ids.some((id) => facts.executions[id]?.binding.scope !== event.scope))
            fail("invalid_fact", "Cancellation release references an unauthorized Execution.");
          snapshot.canceledAt = event.occurredAt;
          task.releaseExecutionIds = [...ids];
        }
        break;
      case "task.successor":
        if (task) {
          if (task.successor) fail("invalid_fact", "Duplicate successor.");
          task.successor = event.data;
        }
        break;
      case "records.forgotten":
        for (const id of event.data.taskIds) delete facts.tasks[id];
        for (const id of event.data.executionIds) delete facts.executions[id];
        break;
      default:
        fail("invalid_fact", "Unknown event type.");
    }
    facts.watermark = event.sequence;
  }
  assertFactsVersion(facts);
  return facts;
}

export function project(facts: Facts, taskId: string, now: number): TaskSnapshot {
  assertFactsVersion(facts);
  const task = facts.tasks[taskId];
  if (!task) fail("not_found", "Task not found.");
  const snapshot = structuredClone(task.snapshot);
  assertStage(snapshot);
  if (
    (snapshot.stage === "initial" &&
      (snapshot.preparation || snapshot.execution || snapshot.allocation)) ||
    (snapshot.stage === "preparing" && !snapshot.preparation) ||
    (snapshot.stage === "queued" && !snapshot.preparation?.completedAt) ||
    (snapshot.stage === "running" && (!snapshot.execution || !snapshot.allocation?.boundAt)) ||
    (snapshot.stage === "completed" &&
      (!snapshot.termination || !snapshot.execution?.completedAt || snapshot.canceledAt)) ||
    (snapshot.stage === "execution_failed" &&
      (!snapshot.termination || !snapshot.execution?.failedAt))
  )
    fail("invalid_fact", "Illegal stage/fact combination.");
  snapshot.timestamp = at(now);
  if (!snapshot.canceledAt && !snapshot.termination && snapshot.execution) {
    const execution = facts.executions[snapshot.execution.executionId];
    if (!execution) fail("history_gap", "Missing bound Execution.");
    if (execution.failedAt) snapshot.execution.failedAt = execution.failedAt;
    if (
      execution.completedAt &&
      matchesExecutionTime(task.binding.executionMatch, snapshot.eligibleAt, execution)
    )
      snapshot.execution.completedAt = execution.completedAt;
  }
  if (snapshot.stage === "completed" && !snapshot.canceledAt && snapshot.execution) {
    const execution = facts.executions[snapshot.execution.executionId];
    if (!execution || execution.result === undefined) fail("history_gap", "Missing result.");
    snapshot.result = structuredClone(execution.result);
  }
  return snapshot;
}

export function effectiveEnd(snapshot: TaskSnapshot): string | undefined {
  assertStage(snapshot);
  return (
    snapshot.canceledAt ??
    snapshot.execution?.completedAt ??
    snapshot.execution?.failedAt ??
    snapshot.preparation?.failedAt ??
    snapshot.allocation?.failedAt ??
    snapshot.termination?.terminatedAt
  );
}
export function isPending(snapshot: TaskSnapshot): boolean {
  return effectiveEnd(snapshot) === undefined && snapshot.timestamp < snapshot.eligibleAt;
}
export function isTimedOut(snapshot: TaskSnapshot): boolean {
  return (effectiveEnd(snapshot) ?? snapshot.timestamp) > snapshot.deadlineAt;
}
export function isCanceled(snapshot: TaskSnapshot): boolean {
  assertStage(snapshot);
  return snapshot.canceledAt !== undefined;
}
export function isCompleted(snapshot: TaskSnapshot): boolean {
  assertStage(snapshot);
  return snapshot.stage === "completed";
}
export function isExecutionFailed(snapshot: TaskSnapshot): boolean {
  assertStage(snapshot);
  return snapshot.stage === "execution_failed";
}

function assertStage(snapshot: TaskSnapshot): void {
  if (
    ![
      "initial",
      "preparing",
      "queued",
      "running",
      "completed",
      "preparation_failed",
      "allocation_failed",
      "execution_failed",
    ].includes(snapshot.stage)
  )
    fail("invalid_fact", "Unknown Task stage.");
}
