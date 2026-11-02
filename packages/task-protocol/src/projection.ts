import { at, canonical, fail, timestamp, ulid } from "./json.js";
import { compileInputSchema, type InputContract } from "./schema.js";
import type {
  FactEvent,
  Facts,
  MatchPolicy,
  RunRecord,
  RunSnapshot,
  RunStage,
  StoreView,
  TaskRecord,
  TaskSnapshot,
} from "./types.js";

export function requestTime(id: string): number {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return [...ulid(id).slice(0, 10)].reduce(
    (value, digit) => value * 32 + alphabet.indexOf(digit),
    0,
  );
}
export function revision(facts: Pick<Facts, "dataDomain" | "watermark">): string {
  return `${facts.dataDomain}:${facts.watermark}`;
}
export function emptyFacts(dataDomain = "test-domain"): Facts {
  return {
    projectionVersion: 4,
    dataDomain,
    watermark: 0,
    admissionLowerBound: null,
    observations: [],
    tasks: {},
    runs: {},
    messages: {},
    requests: {},
  };
}
export function assertFactsVersion(facts: Facts): void {
  if (
    facts?.projectionVersion !== 4 ||
    !facts.dataDomain ||
    !facts.tasks ||
    !facts.runs ||
    !facts.messages ||
    !facts.requests ||
    !Array.isArray(facts.observations) ||
    !Number.isSafeInteger(facts.watermark) ||
    facts.watermark < 0 ||
    (facts.admissionLowerBound !== null && !Number.isSafeInteger(facts.admissionLowerBound))
  )
    fail(
      "unsupported_version",
      "Unsupported Task facts. Explicitly select a new domain; old data is not migrated or deleted.",
    );
  for (const task of Object.values(facts.tasks))
    if (
      "snapshot" in task ||
      !task.taskId ||
      task.request.recurrence !== undefined ||
      (task.request.matchPolicy !== undefined &&
        !["starts-after-eligible", "terminates-after-eligible"].includes(
          task.request.matchPolicy,
        )) ||
      !["starts-after-eligible", "terminates-after-eligible"].includes(task.binding.matchPolicy)
    )
      fail("unsupported_version", "Unsupported stored Task representation or policy.");
  for (const run of Object.values(facts.runs))
    if (!["starts-after-eligible", "terminates-after-eligible"].includes(run.binding.matchPolicy))
      fail("unsupported_version", "Unsupported stored Run policy.");
}
export function restoreTaskUpdates(view: StoreView): StoreView {
  assertFactsVersion(view.facts);
  return view;
}
export function authorizeSync(authorize: () => unknown): void {
  const value = authorize();
  if (value !== undefined) {
    void Promise.resolve(value).catch(() => {});
    fail("invalid_type", "Authorization must be synchronous and return no value.");
  }
}
export function runStage(run: RunRecord): RunStage {
  if (run.exit?.basis === "recovery") return "stopped";
  if (run.exit) return run.outcome?.kind ?? (run.stopRequested ? "stopped" : "failed");
  return run.stoppingAt ? "stopping" : "running";
}
export function matchesRunTime(
  policy: MatchPolicy,
  eligibleAt: string,
  run: Pick<RunRecord, "startedAt" | "exit">,
): boolean {
  if (policy === "starts-after-eligible") return run.startedAt >= eligibleAt;
  if (policy === "terminates-after-eligible") return !run.exit || run.exit.occurredAt >= eligibleAt;
  return fail("invalid_request", "Unsupported matchPolicy.");
}
interface Match {
  run: RunRecord;
  sequence: number;
  observedAt: string;
}
interface Index {
  watermark: number;
  groups: Map<string, RunRecord[]>;
  matches: Map<string, Match | null>;
}
const indices = new WeakMap<Facts, Index>();
const comparisonContracts = new Map<string, InputContract>();
function group(record: Pick<TaskRecord, "binding" | "input">): string {
  const b = record.binding;
  if (!b.inputSchema) fail("unsupported_contract", "Original bound inputSchema is missing.");
  const schema = canonical(b.inputSchema);
  let contract = comparisonContracts.get(schema);
  if (!contract) {
    contract = compileInputSchema(b.inputSchema);
    if (comparisonContracts.size >= 64)
      comparisonContracts.delete(comparisonContracts.keys().next().value!);
    comparisonContracts.set(schema, contract);
  }
  return canonical([
    b.type,
    b.version,
    b.contractRevision,
    b.environment,
    b.scope,
    schema,
    contract.equivalenceKey(record.input),
  ]);
}
function index(facts: Facts): Index {
  const existing = indices.get(facts);
  if (existing?.watermark === facts.watermark) return existing;
  const value: Index = { watermark: facts.watermark, groups: new Map(), matches: new Map() };
  for (const run of Object.values(facts.runs).sort(
    (a, b) => a.startedSequence - b.startedSequence,
  )) {
    const key = group(run);
    const runs = value.groups.get(key) ?? [];
    runs.push(run);
    value.groups.set(key, runs);
  }
  indices.set(facts, value);
  return value;
}
function qualification(facts: Facts, task: TaskRecord): Match | undefined {
  const cache = index(facts);
  const saved = cache.matches.get(task.taskId);
  if (saved !== undefined) return saved ?? undefined;
  for (const run of cache.groups.get(group(task)) ?? []) {
    if (task.binding.matchPolicy === "starts-after-eligible" && run.startedAt < task.eligibleAt)
      continue;
    const lower = Math.max(task.receivedSequence, run.startedSequence);
    const upper = Math.min(
      task.canceledSequence ?? Infinity,
      run.stopRequested?.sequence ?? Infinity,
      run.exit?.basis === "recovery" ? run.exit.sequence : Infinity,
    );
    let left = 0,
      right = facts.observations.length;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if ((facts.observations[middle]?.sequence ?? Infinity) < lower) left = middle + 1;
      else right = middle;
    }
    for (let i = left; i < facts.observations.length; i++) {
      const observation = facts.observations[i];
      if (!observation || observation.sequence >= upper) break;
      if (observation.observedAt < task.eligibleAt || observation.observedAt > task.deadlineAt)
        continue;
      if (
        task.binding.matchPolicy === "terminates-after-eligible" &&
        run.exit &&
        run.exit.sequence <= observation.sequence &&
        run.exit.occurredAt < task.eligibleAt
      )
        continue;
      const match = { run, ...observation };
      cache.matches.set(task.taskId, match);
      return match;
    }
  }
  cache.matches.set(task.taskId, null);
  return undefined;
}
export function matchedRun(facts: Facts, task: TaskRecord): RunRecord | undefined {
  return qualification(facts, task)?.run;
}
export function project(
  facts: Facts,
  taskId: string,
  now: number,
  includeResult = true,
): TaskSnapshot {
  const task = facts.tasks[taskId];
  if (!task) fail("not_found", "Task not found.");
  const match = qualification(facts, task);
  const run = match?.run;
  const stage = run ? runStage(run) : "initial";
  const updates: [number, string][] = [[task.receivedSequence, task.receivedAt]];
  if (task.canceledSequence !== undefined && task.canceledAt)
    updates.push([task.canceledSequence, task.canceledAt]);
  if (match) updates.push([match.sequence, match.observedAt]);
  if (run?.stoppingSequence !== undefined && run.stoppingAt)
    updates.push([run.stoppingSequence, run.stoppingAt]);
  if (run?.exit && match && run.exit.sequence >= match.sequence)
    updates.push([run.exit.sequence, run.exit.occurredAt]);
  if (stage === "completed" && run?.result === undefined)
    fail("history_gap", "Completed Run result is missing.");
  const snapshot: TaskSnapshot = {
    requestId: task.request.requestId,
    taskId,
    seriesId: task.seriesId,
    stage,
    receivedAt: task.receivedAt,
    eligibleAt: task.eligibleAt,
    deadlineAt: task.deadlineAt,
    timestamp: at(now),
    updatedAt: updates.sort((a, b) => a[0] - b[0]).at(-1)![1],
    revision: revision(facts),
    dataDomain: facts.dataDomain,
    canceled: !!task.canceledAt,
    ...(task.canceledAt ? { canceledAt: task.canceledAt } : {}),
  };
  if (run && match) {
    snapshot.run = { runId: run.runId, startedAt: run.startedAt, matchedAt: match.observedAt };
    if (run.exit) {
      snapshot.termination = { terminatedAt: run.exit.occurredAt };
      if (stage === "completed") snapshot.run.completedAt = run.exit.occurredAt;
      if (stage === "failed") snapshot.run.failedAt = run.exit.occurredAt;
      if (stage === "stopped") snapshot.run.stoppedAt = run.exit.occurredAt;
    }
    if (stage === "failed")
      snapshot.error = structuredClone(
        run.error ?? { code: "worker_exit", message: "Worker exited without a reliable result." },
      );
    if (includeResult && (stage === "completed" || stage === "failed") && run.result !== undefined)
      snapshot.result = structuredClone(run.result);
  }
  return snapshot;
}
export function projectRun(facts: Facts, runId: string, now: number): RunSnapshot {
  const run = facts.runs[runId];
  if (!run) fail("not_found", "Run not found.");
  if (runStage(run) === "completed" && run.result === undefined)
    fail("history_gap", "Completed Run result is missing.");
  const snapshot: RunSnapshot = {
    runId,
    dataDomain: facts.dataDomain,
    revision: revision(facts),
    timestamp: at(now),
    type: run.binding.type,
    version: run.binding.version,
    environment: run.binding.environment,
    scope: run.binding.scope,
    startedAt: run.startedAt,
    startedSequence: run.startedSequence,
    updatedAt: run.updatedAt,
    stage: runStage(run),
    ...(run.stopRequested ? { stopRequested: structuredClone(run.stopRequested) } : {}),
    ...(run.stoppingAt ? { stoppingAt: run.stoppingAt } : {}),
    ...(run.outcome && !run.exit ? { outcome: structuredClone(run.outcome) } : {}),
    ...(run.exit ? { exit: structuredClone(run.exit) } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.failedAt ? { failedAt: run.failedAt } : {}),
    ...(run.exit && runStage(run) === "stopped" ? { stoppedAt: run.exit.occurredAt } : {}),
    ...(run.result === undefined ? {} : { result: structuredClone(run.result) }),
    ...(run.error ? { error: structuredClone(run.error) } : {}),
    ...(run.progress === undefined ? {} : { progress: structuredClone(run.progress) }),
    ...(run.reclaimedAt ? { reclaimedAt: run.reclaimedAt } : {}),
    ...(run.cleanupUnknown ? { cleanupUnknown: structuredClone(run.cleanupUnknown) } : {}),
  };
  return snapshot;
}
export function wouldQualify(facts: Facts, observedAt: string): boolean {
  timestamp(observedAt);
  const after = structuredClone(facts);
  after.watermark++;
  after.observations.push({ sequence: after.watermark, observedAt });
  return Object.values(facts.tasks).some(
    (task) =>
      !task.canceledAt &&
      !matchedRun(facts, task) &&
      task.eligibleAt <= observedAt &&
      observedAt <= task.deadlineAt &&
      matchedRun(after, task) !== undefined,
  );
}
export function reduce(prefix: Facts, events: readonly FactEvent[]): Facts {
  assertFactsVersion(prefix);
  const facts = structuredClone(prefix);
  for (const event of events) {
    if (event.sequence <= facts.watermark) continue;
    if (event.sequence !== facts.watermark + 1) fail("history_gap", "Incomplete source prefix.");
    timestamp(event.occurredAt);
    const task = event.taskId ? facts.tasks[event.taskId] : undefined;
    const run = event.runId ? facts.runs[event.runId] : undefined;
    if (event.type.startsWith("task.") && event.type !== "task.created" && !task)
      fail("invalid_fact", "Task fact has no Task.");
    if (event.type.startsWith("run.") && event.type !== "run.started" && !run)
      fail("invalid_fact", "Run fact has no Run.");
    if ((task && task.binding.scope !== event.scope) || (run && run.binding.scope !== event.scope))
      fail("invalid_fact", "Source scope mismatch.");
    switch (event.type) {
      case "qualification-time-observed":
        if (
          event.scope !== "" ||
          event.taskId ||
          event.runId ||
          Object.keys(event.data).join(",") !== "observedAt" ||
          event.data.observedAt !== event.occurredAt ||
          !wouldQualify(facts, event.data.observedAt)
        )
          fail("invalid_fact", "Qualification witness must establish new processable eligibility.");
        break;
      case "window.advanced":
        if (
          !Number.isSafeInteger(event.data.lowerBound) ||
          (facts.admissionLowerBound !== null && event.data.lowerBound < facts.admissionLowerBound)
        )
          fail("invalid_fact", "Admission lower bound cannot retreat.");
        facts.admissionLowerBound = event.data.lowerBound;
        for (const [id, credential] of Object.entries(facts.requests))
          if (!facts.tasks[credential.taskId] && requestTime(id) < event.data.lowerBound)
            delete facts.requests[id];
        break;
      case "task.created": {
        const created = event.data.task;
        if (
          created.taskId !== event.taskId ||
          created.binding.scope !== event.scope ||
          created.receivedSequence !== event.sequence ||
          created.receivedAt !== event.occurredAt ||
          created.canceledAt ||
          created.canceledSequence !== undefined ||
          facts.tasks[created.taskId] ||
          facts.requests[created.request.requestId]
        )
          fail("invalid_fact", "Invalid Task acceptance.");
        timestamp(created.receivedAt);
        timestamp(created.eligibleAt);
        timestamp(created.deadlineAt);
        if (
          created.eligibleAt < created.receivedAt ||
          created.deadlineAt < created.eligibleAt ||
          created.request.type !== created.binding.type ||
          !Number.isSafeInteger(created.request.timeoutMs) ||
          created.request.timeoutMs <= 0 ||
          Date.parse(created.deadlineAt) - Date.parse(created.eligibleAt) !==
            created.request.timeoutMs ||
          (facts.admissionLowerBound !== null &&
            requestTime(created.request.requestId) < facts.admissionLowerBound)
        )
          fail("invalid_fact", "Invalid accepted time anchors.");
        facts.tasks[created.taskId] = structuredClone(created);
        facts.requests[created.request.requestId] = {
          taskId: created.taskId,
          scope: created.binding.scope,
          intent: structuredClone(created.request),
        };
        break;
      }
      case "task.canceled":
        if (!task || task.canceledAt) fail("invalid_fact", "Duplicate cancellation.");
        task.canceledAt = event.occurredAt;
        task.canceledSequence = event.sequence;
        for (const message of Object.values(facts.messages))
          if (message.taskId === task.taskId && message.state === "queued") {
            message.state = "rejected";
            message.resolvedAt = event.occurredAt;
            message.reason = "Task canceled before business acceptance.";
          }
        break;
      case "run.started": {
        const created = event.data.run;
        if (
          run ||
          created.runId !== event.runId ||
          created.binding.scope !== event.scope ||
          created.startedSequence !== event.sequence ||
          created.startedAt !== event.occurredAt ||
          created.exit ||
          created.outcome ||
          created.stopRequested ||
          created.stoppingAt ||
          created.completedAt ||
          created.failedAt ||
          created.result !== undefined ||
          created.error ||
          created.reclaimedAt ||
          created.cleanupUnknown ||
          created.progress !== undefined ||
          created.evidence ||
          created.workerGeneration ||
          created.updatedAt !== created.startedAt
        )
          fail("invalid_fact", "Invalid Run start.");
        facts.runs[created.runId] = structuredClone(created);
        break;
      }
      case "run.dispatched":
        if (!run || run.exit || run.workerGeneration) fail("invalid_fact", "Invalid dispatch.");
        run.workerGeneration = event.data.workerGeneration;
        break;
      case "run.stop.requested":
        if (!run || run.exit || run.stopRequested) fail("invalid_fact", "Invalid stop request.");
        run.stopRequested = {
          occurredAt: event.occurredAt,
          sequence: event.sequence,
          reason: event.data.reason,
        };
        break;
      case "run.stopping":
        if (!run || run.exit || !run.stopRequested || run.stoppingAt)
          fail("invalid_fact", "Invalid stop acceptance.");
        run.stoppingAt = event.occurredAt;
        run.stoppingSequence = event.sequence;
        break;
      case "run.outcome":
        if (!run || run.exit || run.outcome)
          fail("invalid_fact", "Run no longer accepts a result.");
        if (event.data.outcome.occurredAt !== event.occurredAt)
          fail("invalid_fact", "Outcome time mismatch.");
        run.outcome = structuredClone(event.data.outcome);
        break;
      case "run.exited":
        if (!run || run.exit) fail("invalid_fact", "Duplicate exit.");
        run.exit = { ...event.data, sequence: event.sequence, occurredAt: event.occurredAt };
        if (event.data.basis === "recovery")
          run.cleanupUnknown = {
            reason: "Recovery does not prove physical exit or cleanup.",
            observedAt: event.occurredAt,
          };
        else if (run.outcome?.kind === "completed") {
          run.completedAt = event.occurredAt;
          run.result = structuredClone(run.outcome.result);
        } else if (run.outcome?.kind === "failed") {
          run.failedAt = event.occurredAt;
          run.error = structuredClone(run.outcome.error);
          if (run.outcome.result !== undefined) run.result = structuredClone(run.outcome.result);
        } else if (!run.stopRequested) {
          run.failedAt = event.occurredAt;
          run.error = { code: "worker_exit", message: "Worker exited without a reliable result." };
        }
        for (const message of Object.values(facts.messages))
          if (message.runId === run.runId && message.state === "queued") {
            message.state = "unknown";
            message.resolvedAt = event.occurredAt;
            message.reason = "Run exited without a business acceptance receipt.";
          }
        break;
      case "run.progress":
        if (!run || run.exit) fail("invalid_fact", "Progress after exit.");
        run.progress = structuredClone(event.data.progress);
        break;
      case "run.evidence":
        if (!run || run.exit) fail("invalid_fact", "Evidence after exit.");
        run.evidence ??= [];
        run.evidence.push(structuredClone(event.data));
        break;
      case "run.reclaimed":
        if (!run || !run.exit || run.reclaimedAt)
          fail("invalid_fact", "Reclamation needs an actual terminal boundary.");
        run.reclaimedAt = event.occurredAt;
        delete run.cleanupUnknown;
        break;
      case "run.cleanup.unknown":
        if (!run || run.reclaimedAt) fail("invalid_fact", "Cannot replace known reclamation.");
        run.cleanupUnknown = { reason: event.data.reason, observedAt: event.occurredAt };
        break;
      case "message.received": {
        const message = event.data.message,
          key = `${message.taskId}\0${message.messageId}`;
        if (
          !task ||
          !run ||
          run.exit ||
          run.stopRequested ||
          task.canceledAt ||
          message.taskId !== task.taskId ||
          message.runId !== run.runId ||
          message.caller.scope !== event.scope ||
          message.generation !== run.generation ||
          matchedRun(facts, task)?.runId !== run.runId ||
          facts.messages[key] ||
          message.state !== "queued"
        )
          fail("invalid_fact", "Invalid message route.");
        facts.messages[key] = structuredClone(message);
        break;
      }
      case "message.resolved": {
        const message = facts.messages[`${event.taskId}\0${event.data.messageId}`];
        if (!message || message.state !== "queued" || message.runId !== event.runId)
          fail("invalid_fact", "Receipt has no pending message.");
        message.state = event.data.state;
        message.resolvedAt = event.occurredAt;
        if (event.data.reason !== undefined) message.reason = event.data.reason;
        break;
      }
      case "records.forgotten":
        if (
          event.data.runIds.length &&
          Object.keys(facts.tasks).some((id) => !event.data.taskIds.includes(id))
        )
          fail("protected_history", "Retained Tasks need matching facts.");
        for (const id of event.data.taskIds) delete facts.tasks[id];
        for (const id of event.data.runIds) delete facts.runs[id];
        for (const [key, message] of Object.entries(facts.messages))
          if (event.data.taskIds.includes(message.taskId)) delete facts.messages[key];
        break;
      default:
        fail("invalid_fact", "Unsupported source event.");
    }
    if (run && event.type.startsWith("run.") && event.type !== "run.dispatched")
      run.updatedAt = event.occurredAt;
    facts.observations.push({
      sequence: event.sequence,
      observedAt:
        event.type === "qualification-time-observed" ? event.data.observedAt : event.occurredAt,
    });
    facts.watermark = event.sequence;
  }
  assertFactsVersion(facts);
  return facts;
}
export function effectiveEnd(snapshot: TaskSnapshot): string | undefined {
  return snapshot.termination?.terminatedAt ?? snapshot.canceledAt;
}
export function isPending(snapshot: TaskSnapshot): boolean {
  return snapshot.timestamp < snapshot.eligibleAt;
}
export function isTimedOut(snapshot: TaskSnapshot): boolean {
  return snapshot.timestamp > snapshot.deadlineAt;
}
export function isCanceled(snapshot: TaskSnapshot): boolean {
  return snapshot.canceled;
}
export function isCompleted(snapshot: TaskSnapshot): boolean {
  return snapshot.stage === "completed";
}
export function isRunFailed(snapshot: TaskSnapshot): boolean {
  return snapshot.stage === "failed";
}
