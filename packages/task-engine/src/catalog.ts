import { createHmac, randomBytes } from "node:crypto";
import {
  at,
  type Caller,
  canonical,
  type Facts,
  fail,
  isPending,
  isTimedOut,
  object,
  positive,
  project,
  type TaskPage,
  type TaskQuery,
  type TaskRecord,
  type TaskSummary,
} from "@potential-guide/task-protocol";

export interface CatalogLimits {
  pageSize: number;
  queryScanLimit: number;
  queryPageBytes: number;
  maxQueryViews: number;
  maxQueryBytes: number;
  queryLifetimeMs: number;
}
interface QueryView {
  key: string;
  caller: string;
  tasks: TaskSummary[];
  observedAt: string;
  expiresAt: string;
  expiresMono: number;
  bytes: number;
}
const fields = new Set([
  "type",
  "createdFrom",
  "createdBefore",
  "updatedFrom",
  "updatedBefore",
  "sort",
]);
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
function normalize(query: TaskQuery): TaskQuery {
  const raw = object(query);
  if (Object.keys(raw).some((key) => !fields.has(key)))
    fail("invalid_request", "Unknown Task query field.");
  const result: TaskQuery = { sort: "created-desc" };
  if (raw.type !== undefined) {
    if (typeof raw.type !== "string" || !raw.type || raw.type.length > 256)
      fail("invalid_request", "type must contain 1–256 characters.");
    result.type = raw.type;
  }
  if (raw.sort !== undefined) {
    if (raw.sort !== "created-desc" && raw.sort !== "updated-desc")
      fail("invalid_request", "Unknown Task query order.");
    result.sort = raw.sort;
  }
  for (const field of ["createdFrom", "createdBefore", "updatedFrom", "updatedBefore"] as const)
    if (raw[field] !== undefined) result[field] = queryTime(raw[field]);
  for (const [from, before] of [
    [result.createdFrom, result.createdBefore],
    [result.updatedFrom, result.updatedBefore],
  ])
    if (from && before && from >= before)
      fail("invalid_request", "Time ranges must have an increasing exclusive upper bound.");
  return result;
}
function summary(task: TaskRecord, facts: Facts, now: number): TaskSummary {
  const id = task.snapshot.taskId;
  const executionId = task.snapshot.execution?.executionId;
  const execution = executionId ? facts.executions[executionId] : undefined;
  // Project only this record, without cloning result payloads or rescanning the entire store.
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
function encodedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
export class TaskCatalog {
  private readonly secret = randomBytes(32);
  private readonly views = new Map<string, QueryView>();
  private bytes = 0;
  constructor(private readonly limits: CatalogLimits) {}

  clear(): void {
    this.views.clear();
    this.bytes = 0;
  }
  private remove(id: string, view: QueryView): void {
    this.views.delete(id);
    this.bytes -= view.bytes;
  }
  private cursor(id: string, position: number): string {
    const body = `tasks:${id}:${position}`;
    return `${body}:${createHmac("sha256", this.secret).update(body).digest("base64url")}`;
  }
  read(
    raw: TaskQuery,
    page: { cursor?: string; limit?: number },
    caller: Caller,
    facts: Facts,
    now: number,
    authorize: (task: TaskRecord) => void,
  ): TaskPage {
    const query = normalize(raw);
    const key = canonical(object(query));
    const identity = canonical({ scope: caller.scope, subject: caller.subject });
    const paging = object(page);
    if (Object.keys(paging).some((key) => key !== "limit" && key !== "cursor"))
      fail("invalid_request", "Unknown Task page field.");
    const limit = page.limit === undefined ? this.limits.pageSize : positive(page.limit, "limit");
    if (limit > this.limits.pageSize) fail("invalid_request", "Task page limit exceeds pageSize.");
    for (const [id, view] of this.views)
      if (now >= Date.parse(view.expiresAt) || performance.now() >= view.expiresMono)
        this.remove(id, view);
    let id: string;
    let position = 0;
    let view: QueryView;
    let fresh = false;
    if (page.cursor !== undefined) {
      if (
        typeof page.cursor !== "string" ||
        page.cursor.length > 256 ||
        !/^tasks:[A-Za-z0-9_-]{32}:[0-9]+:[A-Za-z0-9_-]{43}$/.test(page.cursor)
      )
        fail("invalid_cursor", "Expected a Task directory cursor.");
      const parts = page.cursor.split(":");
      id = parts[1] ?? "";
      position = Number(parts[2]);
      const saved = this.views.get(id);
      if (!saved) fail("query_expired", "Task query no longer exists; start a new query.");
      if (this.cursor(id, position) !== page.cursor)
        fail("invalid_cursor", "Task cursor was modified.");
      view = saved;
      if (
        view.key !== key ||
        view.caller !== identity ||
        !Number.isSafeInteger(position) ||
        position <= 0 ||
        position >= view.tasks.length
      )
        fail("invalid_cursor", "Task cursor belongs to a different caller/query/position.");
    } else {
      fresh = true;
      id = randomBytes(24).toString("base64url");
      view = {
        key,
        caller: identity,
        tasks: [],
        observedAt: at(now),
        expiresAt: at(now + this.limits.queryLifetimeMs),
        expiresMono: performance.now() + this.limits.queryLifetimeMs,
        bytes: 512 + 2 * (key.length + identity.length),
      };
      if (this.bytes + view.bytes > this.limits.maxQueryBytes)
        fail("capacity_exceeded", "Task query memory budget exhausted.");
      let scanned = 0;
      for (const taskId in facts.tasks) {
        if (++scanned > this.limits.queryScanLimit)
          fail("capacity_exceeded", "Task directory scan limit exceeded.");
        const task = facts.tasks[taskId];
        if (!task || task.binding.scope !== caller.scope) continue;
        const created = task.snapshot.receivedAt;
        const updated = task.updatedAt;
        if (updated === undefined) fail("history_gap", "Task update history is unavailable.");
        if (
          (query.type !== undefined && task.binding.type !== query.type) ||
          (query.createdFrom && created < query.createdFrom) ||
          (query.createdBefore && created >= query.createdBefore) ||
          (query.updatedFrom && updated < query.updatedFrom) ||
          (query.updatedBefore && updated >= query.updatedBefore)
        )
          continue;
        authorize(task);
        const item = summary(task, facts, now);
        view.bytes += encodedBytes(item) * 2 + 256;
        if (this.bytes + view.bytes > this.limits.maxQueryBytes)
          fail("capacity_exceeded", "Task query memory budget exhausted.");
        view.tasks.push(item);
      }
      const time = query.sort === "updated-desc" ? "updatedAt" : "receivedAt";
      view.tasks.sort((a, b) =>
        a[time] === b[time]
          ? a.taskId < b.taskId
            ? -1
            : a.taskId > b.taskId
              ? 1
              : 0
          : a[time] > b[time]
            ? -1
            : 1,
      );
    }
    // Validate the entire membership, including already delivered pages. Never silently skip.
    for (const item of view.tasks) {
      const task = facts.tasks[item.taskId];
      if (!task) {
        if (!fresh) this.remove(id, view);
        fail("query_expired", "A member was removed; start a new query.");
      }
      authorize(task);
    }
    const result: TaskPage = {
      tasks: [],
      observedAt: view.observedAt,
      expiresAt: view.expiresAt,
    };
    while (position < view.tasks.length && result.tasks.length < limit) {
      const item = view.tasks[position];
      if (!item) break;
      result.tasks.push(item);
      const next = position + 1;
      if (next < view.tasks.length) result.next = this.cursor(id, next);
      else delete result.next;
      if (encodedBytes(result) > this.limits.queryPageBytes) {
        result.tasks.pop();
        if (!result.tasks.length)
          fail("payload_too_large", "Task summary exceeds page byte limit.");
        result.next = this.cursor(id, position);
        break;
      }
      position = next;
    }
    if (encodedBytes(result) > this.limits.queryPageBytes)
      fail("payload_too_large", "Task page envelope exceeds byte limit.");
    if (fresh && result.next) {
      if (this.views.size >= this.limits.maxQueryViews)
        fail("capacity_exceeded", "Task query view count exhausted.");
      if (this.bytes + view.bytes > this.limits.maxQueryBytes)
        fail("capacity_exceeded", "Task query memory budget exhausted.");
      this.views.set(id, view);
      this.bytes += view.bytes;
    }
    return structuredClone(result);
  }
}
