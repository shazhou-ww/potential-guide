import { at, fail, timestamp } from "./json.js";
import type { FactEvent, Facts, MatchPolicy, RunRecord, StoreView, TaskSnapshot } from "./types.js";

export function matchesRunTime(
  policy: MatchPolicy,
  eligibleAt: string,
  run: Pick<RunRecord, "startedAt" | "completedAt" | "failedAt">,
): boolean {
  switch (policy) {
    case "started-after-eligible":
      return run.startedAt >= eligibleAt;
    case "terminated-after-eligible": {
      const end = run.completedAt ?? run.failedAt;
      return end !== undefined && end >= eligibleAt;
    }
    default:
      return fail("invalid_request", "Unsupported matchPolicy.");
  }
}

export function emptyFacts(): Facts {
  return { projectionVersion: 3, watermark: 0, tasks: {}, runs: {}, messages: {} };
}

export function assertFactsVersion(facts: Facts): void {
  if (facts?.projectionVersion !== 3 || !facts.messages)
    fail(
      "unsupported_version",
      "Unsupported Task facts. Use new storage; old data is not migrated.",
    );
  for (const record of [...Object.values(facts.tasks), ...Object.values(facts.runs)])
    if (
      record.binding.matchPolicy !== "started-after-eligible" &&
      record.binding.matchPolicy !== "terminated-after-eligible"
    )
      fail("unsupported_version", "Unsupported stored matchPolicy. Use new storage.");
  for (const task of Object.values(facts.tasks))
    if (
      task.request.matchPolicy !== undefined &&
      task.request.matchPolicy !== "started-after-eligible" &&
      task.request.matchPolicy !== "terminated-after-eligible"
    )
      fail("unsupported_version", "Unsupported stored request matchPolicy. Use new storage.");
  for (const task of Object.values(facts.tasks))
    if (task.updatedAt !== undefined) timestamp(task.updatedAt);
}

/** v2 stores protect all events while any recovery references remain. */
export function restoreTaskUpdates(view: StoreView): StoreView {
  if (!Object.values(view.facts.tasks).some((task) => task.updatedAt === undefined)) return view;
  const prefix = emptyFacts();
  prefix.watermark = view.floor;
  const recovered = reduce(prefix, view.events);
  if (recovered.watermark !== view.facts.watermark)
    fail("history_gap", "Cannot recover Task update times from incomplete v2 history.");
  for (const [id, task] of Object.entries(view.facts.tasks)) {
    if (task.updatedAt !== undefined) continue;
    const updatedAt = recovered.tasks[id]?.updatedAt;
    if (updatedAt === undefined)
      fail("history_gap", "Missing creation/update history for retained Task.");
    task.updatedAt = updatedAt;
  }
  return view;
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
    const run = event.runId ? facts.runs[event.runId] : undefined;
    const snapshot = task?.snapshot;
    const previousSnapshot = snapshot ? JSON.stringify(snapshot) : undefined;
    const frozen = snapshot?.canceledAt !== undefined;
    if (event.type.startsWith("task.") && event.type !== "task.created" && !task)
      fail("invalid_fact", "Task fact references a missing Task.");
    if (event.type.startsWith("run.") && event.type !== "run.started" && !run)
      fail("invalid_fact", "Execution fact references a missing Execution.");
    if (task && task.binding.scope !== event.scope)
      fail("invalid_fact", "Task fact scope mismatch.");
    if (run && run.binding.scope !== event.scope)
      fail("invalid_fact", "Execution fact scope mismatch.");
    switch (event.type) {
      case "message.received": {
        const message = event.data.message;
        const key = `${message.taskId}\0${message.messageId}`;
        if (
          !task ||
          facts.messages[key] ||
          message.state !== "queued" ||
          message.taskId !== event.taskId ||
          message.runId !== event.runId ||
          message.caller.scope !== event.scope ||
          snapshot?.canceledAt ||
          snapshot?.termination
        )
          fail("invalid_fact", "消息接收身份或生命周期无效。");
        facts.messages[key] = structuredClone(message);
        break;
      }
      case "message.resolved": {
        const message = facts.messages[`${event.taskId}\0${event.data.messageId}`];
        if (!message || message.runId !== event.runId || message.state !== "queued")
          fail("invalid_fact", "消息确认没有对应的在途消息。");
        message.state = event.data.state;
        message.resolvedAt = event.occurredAt;
        if (event.data.reason !== undefined) message.reason = event.data.reason;
        break;
      }
      case "run.cleanup.unknown":
        if (!run || run.reclaimedAt) fail("invalid_fact", "未知清理不能覆盖已确认回收。");
        run.cleanupUnknown = { reason: event.data.reason, observedAt: event.occurredAt };
        break;
      case "task.created":
        if (
          event.data.task.snapshot.stage !== "initial" ||
          event.data.task.receivedSequence !== event.sequence ||
          event.taskId !== event.data.task.snapshot.taskId ||
          event.scope !== event.data.task.binding.scope
        )
          fail("invalid_fact", "Invalid Task creation fact.");
        if (facts.tasks[event.data.task.snapshot.taskId]) fail("invalid_fact", "Duplicate Task.");
        matchesRunTime(event.data.task.binding.matchPolicy, event.occurredAt, {
          startedAt: event.occurredAt,
        });
        facts.tasks[event.data.task.snapshot.taskId] = {
          ...structuredClone(event.data.task),
          updatedAt: event.data.task.snapshot.receivedAt,
        };
        break;
      case "task.run.bound": {
        const target = facts.runs[event.data.runId];
        if (!target) fail("invalid_fact", "Binding references missing Execution.");
        if (snapshot && !frozen) {
          const boundary =
            task?.binding.matchPolicy === "started-after-eligible"
              ? target.startedSequence
              : target.terminatedSequence;
          const time =
            task?.binding.matchPolicy === "started-after-eligible"
              ? target.startedAt
              : (target.completedAt ?? target.failedAt);
          if (
            !task ||
            snapshot.run ||
            snapshot.termination ||
            snapshot.stage !== "initial" ||
            target.binding.scope !== event.scope ||
            target.binding.type !== task.binding.type ||
            target.binding.version !== task.binding.version ||
            target.binding.environment !== task.binding.environment ||
            (target.sealed && !target.sealedTaskIds?.includes(snapshot.taskId)) ||
            boundary === undefined ||
            boundary <= prefix.watermark ||
            task.receivedSequence >= boundary ||
            time !== event.occurredAt ||
            !matchesRunTime(task.binding.matchPolicy, snapshot.eligibleAt, target)
          )
            fail("invalid_fact", "Illegal run binding.");
          snapshot.stage = "running";

          snapshot.run = {
            runId: target.runId,
            startedAt: target.startedAt,
            matchedAt: event.occurredAt,
          };
        }
        break;
      }
      case "run.started":
        if (
          event.runId !== event.data.run.runId ||
          event.scope !== event.data.run.binding.scope ||
          event.sequence !== event.data.run.startedSequence ||
          event.occurredAt !== event.data.run.startedAt
        )
          fail("invalid_fact", "Invalid run startup identity/time.");
        if (run) fail("invalid_fact", "Duplicate Execution.");
        matchesRunTime(event.data.run.binding.matchPolicy, event.occurredAt, {
          startedAt: event.occurredAt,
        });
        facts.runs[event.data.run.runId] = structuredClone(event.data.run);
        break;
      case "run.dispatched":
        if (!run || run.workerGeneration || run.completedAt || run.failedAt)
          fail("invalid_fact", "Run 投递身份或生命周期无效。");
        run.workerGeneration = event.data.workerGeneration;
        break;
      case "run.evidence":
        if (!run || run.reclaimedAt) fail("invalid_fact", "Run 证据没有活动或清理中的运行边界。");
        run.evidence ??= [];
        run.evidence.push(event.data);
        break;
      case "run.completed":
        if (!run || run.completedAt || run.failedAt)
          fail("invalid_fact", "Execution already ended or missing.");
        run.completedAt = event.occurredAt;
        run.terminatedSequence = event.sequence;
        run.result = event.data.result;
        break;
      case "run.failed":
        if (!run || run.completedAt || run.failedAt)
          fail("invalid_fact", "Execution already ended or missing.");
        run.failedAt = event.occurredAt;
        run.terminatedSequence = event.sequence;
        run.error = event.data.error;
        if (event.data.result !== undefined) run.result = event.data.result;
        break;
      case "run.sealed":
        if (run) {
          if (run.sealed) fail("invalid_fact", "Execution already sealed.");
          run.sealed = true;
          run.sealedTaskIds = [...event.data.taskIds];
        }
        break;
      case "run.reclaimed":
        if (run) {
          run.reclaimedAt = event.occurredAt;
          delete run.cleanupUnknown;
        }
        break;
      case "run.progress":
        break;
      case "task.terminated":
        if (snapshot && !frozen && !snapshot.termination) {
          const target = event.data.runId ? facts.runs[event.data.runId] : undefined;
          if (event.data.runId && snapshot.run?.runId !== event.data.runId)
            fail("invalid_fact", "Termination must use the Task's bound Execution.");
          if (!target && !["preparation_failed", "allocation_failed"].includes(snapshot.stage))
            fail("invalid_fact", "Termination lacks a final process fact.");
          if (target && snapshot.run) {
            if (target.completedAt) {
              snapshot.stage = "completed";
              snapshot.run.completedAt = target.completedAt;
            } else if (target.failedAt) {
              snapshot.stage = "run_failed";
              snapshot.run.failedAt = target.failedAt;
              if (target.error) snapshot.error = target.error;
            } else fail("invalid_fact", "Termination references unfinished Execution.");
          }
          snapshot.termination = { terminatedAt: event.occurredAt };
        }
        break;
      case "task.canceled":
        if (task && snapshot && !snapshot.termination && !frozen) {
          const ids = event.data.runIds ?? [];
          if (ids.some((id) => facts.runs[id]?.binding.scope !== event.scope))
            fail("invalid_fact", "Cancellation release references an unauthorized Execution.");
          snapshot.canceledAt = event.occurredAt;
          task.releaseRunIds = [...ids];
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
        for (const id of event.data.runIds) delete facts.runs[id];
        for (const [key, message] of Object.entries(facts.messages))
          if (event.data.taskIds.includes(message.taskId)) delete facts.messages[key];
        break;
      default:
        fail("invalid_fact", "Unknown event type.");
    }
    if (task && (JSON.stringify(snapshot) !== previousSnapshot || event.type === "task.successor"))
      task.updatedAt = event.occurredAt;
    if (
      event.type === "run.progress" ||
      event.type === "run.completed" ||
      event.type === "run.failed"
    )
      for (const affected of Object.values(facts.tasks))
        if (
          affected.snapshot.run?.runId === event.runId &&
          !affected.snapshot.canceledAt &&
          !affected.snapshot.termination
        )
          affected.updatedAt = event.occurredAt;
    facts.watermark = event.sequence;
  }
  assertFactsVersion(facts);
  return facts;
}

export function project(
  facts: Facts,
  taskId: string,
  now: number,
  includeResult = true,
): TaskSnapshot {
  assertFactsVersion(facts);
  const task = facts.tasks[taskId];
  if (!task) fail("not_found", "Task not found.");
  const snapshot = structuredClone(task.snapshot);
  assertStage(snapshot);
  if (
    (snapshot.stage === "initial" && snapshot.run) ||
    (snapshot.stage === "running" && !snapshot.run) ||
    (snapshot.stage === "completed" &&
      (!snapshot.termination || !snapshot.run?.completedAt || snapshot.canceledAt)) ||
    (snapshot.stage === "run_failed" && (!snapshot.termination || !snapshot.run?.failedAt))
  )
    fail("invalid_fact", "Illegal stage/fact combination.");
  snapshot.timestamp = at(now);
  if (!snapshot.canceledAt && !snapshot.termination && snapshot.run) {
    const run = facts.runs[snapshot.run.runId];
    if (!run) fail("history_gap", "Missing bound Execution.");
    if (run.failedAt) snapshot.run.failedAt = run.failedAt;
    if (run.completedAt && matchesRunTime(task.binding.matchPolicy, snapshot.eligibleAt, run))
      snapshot.run.completedAt = run.completedAt;
  }
  if (
    (snapshot.stage === "completed" || snapshot.stage === "run_failed") &&
    !snapshot.canceledAt &&
    snapshot.run
  ) {
    const run = facts.runs[snapshot.run.runId];
    if (!run || (snapshot.stage === "completed" && run.result === undefined))
      fail("history_gap", "Missing result.");
    if (includeResult && run.result !== undefined) snapshot.result = structuredClone(run.result);
  }
  return snapshot;
}

export function effectiveEnd(snapshot: TaskSnapshot): string | undefined {
  assertStage(snapshot);
  return (
    snapshot.canceledAt ??
    snapshot.run?.completedAt ??
    snapshot.run?.failedAt ??
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
export function isRunFailed(snapshot: TaskSnapshot): boolean {
  assertStage(snapshot);
  return snapshot.stage === "run_failed";
}

function assertStage(snapshot: TaskSnapshot): void {
  if (!["initial", "running", "completed", "run_failed"].includes(snapshot.stage))
    fail("invalid_fact", "Unknown Task stage.");
}
