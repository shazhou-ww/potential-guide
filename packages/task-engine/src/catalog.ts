import {
  at,
  type Caller,
  type ExecutionPage,
  type ExecutionQuery,
  type ExecutionRecord,
  type ExecutionSummary,
  type Facts,
  fail,
  isPending,
  isTimedOut,
  object,
  project,
  type TaskPage,
  type TaskQuery,
  type TaskRecord,
  type TaskSummary,
  ulid,
} from "@potential-guide/task-protocol";
import { type CatalogLimits, FrozenCatalog } from "./frozen-catalog.js";

export type { CatalogLimits } from "./frozen-catalog.js";

function queryTime(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    fail("invalid_request", "Query times require an explicit RFC 3339 timezone.");
  const date = value.slice(0, 10);
  const local = `${value.slice(0, 19)}Z`;
  if (
    !Number.isFinite(Date.parse(value)) ||
    !Number.isFinite(Date.parse(local)) ||
    new Date(local).toISOString().slice(0, 10) !== date ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59 ||
    (value.at(-1) !== "Z" && (Number(value.slice(-5, -3)) > 23 || Number(value.slice(-2)) > 59))
  )
    fail("invalid_request", "Invalid query time.");
  return at(Date.parse(value));
}
function typeFilter(raw: Record<string, unknown>): string | undefined {
  if (raw.type === undefined) return undefined;
  if (typeof raw.type !== "string" || !raw.type || raw.type.length > 256)
    fail("invalid_request", "type must contain 1–256 characters.");
  return raw.type;
}
function range(from?: string, before?: string) {
  if (from && before && from >= before)
    fail("invalid_request", "Time ranges must have an increasing exclusive upper bound.");
}
function normalize(query: TaskQuery): TaskQuery {
  const raw = object(query);
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          "type",
          "executionId",
          "createdFrom",
          "createdBefore",
          "updatedFrom",
          "updatedBefore",
          "sort",
        ].includes(key),
    )
  )
    fail("invalid_request", "Unknown Task query field.");
  const result: TaskQuery = { sort: "created-desc" };
  const type = typeFilter(raw);
  if (type !== undefined) result.type = type;
  if (raw.executionId !== undefined) result.executionId = ulid(raw.executionId);
  if (raw.sort !== undefined) {
    if (raw.sort !== "created-desc" && raw.sort !== "updated-desc")
      fail("invalid_request", "Unknown Task query order.");
    result.sort = raw.sort;
  }
  for (const field of ["createdFrom", "createdBefore", "updatedFrom", "updatedBefore"] as const)
    if (raw[field] !== undefined) result[field] = queryTime(raw[field]);
  range(result.createdFrom, result.createdBefore);
  range(result.updatedFrom, result.updatedBefore);
  return result;
}
function summary(task: TaskRecord, facts: Facts, now: number): TaskSummary {
  const id = task.snapshot.taskId;
  const execution = task.snapshot.execution
    ? facts.executions[task.snapshot.execution.executionId]
    : undefined;
  const snapshot = project(
    {
      projectionVersion: 2,
      watermark: facts.watermark,
      tasks: { [id]: task },
      executions: execution ? { [execution.executionId]: execution } : {},
    },
    id,
    now,
    false,
  );
  if (task.updatedAt === undefined) fail("history_gap", "Task update history is unavailable.");
  return {
    taskId: id,
    requestId: snapshot.requestId,
    seriesId: snapshot.seriesId,
    type: task.binding.type,
    version: task.binding.version,
    receivedAt: snapshot.receivedAt,
    updatedAt: task.updatedAt,
    state: {
      stage: snapshot.stage,
      pending: isPending(snapshot),
      timedOut: isTimedOut(snapshot),
      canceled: snapshot.canceledAt !== undefined,
      completed: snapshot.stage === "completed",
      executionFailed: snapshot.stage === "execution_failed",
    },
  };
}
function descending(timeA: string, timeB: string, idA: string, idB: string): number {
  return timeA === timeB ? (idA < idB ? -1 : idA > idB ? 1 : 0) : timeA > timeB ? -1 : 1;
}
export class TaskCatalog {
  private readonly catalog: FrozenCatalog<TaskRecord, TaskSummary, TaskQuery>;
  constructor(limits: CatalogLimits) {
    this.catalog = new FrozenCatalog(limits, {
      namespace: "tasks",
      normalize,
      records: (facts) => facts.tasks,
      summary,
      id: (item) => item.taskId,
      matches(task, query) {
        const created = task.snapshot.receivedAt;
        const updated = task.updatedAt;
        if (updated === undefined) fail("history_gap", "Task update history is unavailable.");
        return !(
          (query.type !== undefined && task.binding.type !== query.type) ||
          (query.executionId !== undefined &&
            task.snapshot.execution?.executionId !== query.executionId) ||
          (query.createdFrom && created < query.createdFrom) ||
          (query.createdBefore && created >= query.createdBefore) ||
          (query.updatedFrom && updated < query.updatedFrom) ||
          (query.updatedBefore && updated >= query.updatedBefore)
        );
      },
      compare(a, b, query) {
        const time = query.sort === "updated-desc" ? "updatedAt" : "receivedAt";
        return descending(a[time], b[time], a.taskId, b.taskId);
      },
    });
  }
  clear(): void {
    this.catalog.clear();
  }
  read(
    raw: TaskQuery,
    page: { cursor?: string; limit?: number },
    caller: Caller,
    facts: Facts,
    now: number,
    authorize: (task: TaskRecord) => void,
  ): TaskPage {
    const { items, ...metadata } = this.catalog.read(raw, page, caller, facts, now, authorize);
    return { tasks: items, ...metadata };
  }
}
function executionQuery(query: ExecutionQuery): ExecutionQuery {
  const raw = object(query);
  if (
    Object.keys(raw).some((key) => !["type", "startedFrom", "startedBefore", "sort"].includes(key))
  )
    fail("invalid_request", "Unknown Execution query field.");
  const result: ExecutionQuery = { sort: "started-desc" };
  const type = typeFilter(raw);
  if (type !== undefined) result.type = type;
  if (raw.sort !== undefined && raw.sort !== "started-desc")
    fail("invalid_request", "Unknown Execution query order.");
  for (const field of ["startedFrom", "startedBefore"] as const)
    if (raw[field] !== undefined) result[field] = queryTime(raw[field]);
  range(result.startedFrom, result.startedBefore);
  return result;
}
export class ExecutionCatalog {
  private readonly catalog: FrozenCatalog<ExecutionRecord, ExecutionSummary, ExecutionQuery>;
  constructor(limits: CatalogLimits) {
    this.catalog = new FrozenCatalog(limits, {
      namespace: "executions",
      normalize: executionQuery,
      records: (facts) => facts.executions,
      id: (item) => item.executionId,
      matches: (record, query) =>
        !(
          (query.type !== undefined && record.binding.type !== query.type) ||
          (query.startedFrom && record.startedAt < query.startedFrom) ||
          (query.startedBefore && record.startedAt >= query.startedBefore)
        ),
      compare: (a, b) => descending(a.startedAt, b.startedAt, a.executionId, b.executionId),
      summary: (record) => ({
        executionId: record.executionId,
        type: record.binding.type,
        version: record.binding.version,
        startedAt: record.startedAt,
        ...(record.completedAt ? { completedAt: record.completedAt } : {}),
        ...(record.failedAt ? { failedAt: record.failedAt } : {}),
        ...(record.reclaimedAt ? { reclaimedAt: record.reclaimedAt } : {}),
        state: {
          running: !record.completedAt && !record.failedAt && !record.reclaimedAt,
          completed: !!record.completedAt,
          failed: !!record.failedAt,
          reclaimed: !!record.reclaimedAt,
          sealed: !!record.sealed,
        },
      }),
    });
  }
  clear(): void {
    this.catalog.clear();
  }
  read(
    raw: ExecutionQuery,
    page: { cursor?: string; limit?: number },
    caller: Caller,
    facts: Facts,
    now: number,
    authorize: (execution: ExecutionRecord) => void,
  ): ExecutionPage {
    const { items, ...metadata } = this.catalog.read(raw, page, caller, facts, now, authorize);
    return { executions: items, ...metadata };
  }
}
