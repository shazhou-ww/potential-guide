import type {
  CollectionEnvelope,
  HistoryPage,
  Observation,
  PublicEvent,
  RunPage,
  RunSnapshot,
  RunSummary,
  TaskPage,
  TaskSnapshot,
  TaskSummary,
  TaskTypeDiscovery,
} from "@potential-guide/task-protocol";
import type { Endpoint } from "./server.js";

export type Parameters = Record<string, unknown> & { type: string };
const stageValues = ["initial", "running", "stopping", "stopped", "completed", "failed"];
export function sourcePosition(value: string): { domain: string; position: number } {
  if (typeof value !== "string" || value.length > 1024) throw new Error("源 revision 无效。");
  const split = value.lastIndexOf(":"),
    raw = value.slice(split + 1),
    position = Number(raw);
  if (split <= 0 || !/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(position))
    throw new Error("源 revision 无效。");
  return { domain: value.slice(0, split), position };
}
export function validSnapshot(value: unknown): value is TaskSnapshot {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  try {
    if (sourcePosition(String(task.revision)).domain !== task.dataDomain) return false;
  } catch {
    return false;
  }
  if (
    task.canceledAt !== undefined &&
    (typeof task.canceledAt !== "string" || !Number.isFinite(Date.parse(task.canceledAt)))
  )
    return false;
  const run = task.run as Record<string, unknown> | undefined;
  if (
    run !== undefined &&
    (!run ||
      typeof run !== "object" ||
      !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(String(run.runId)) ||
      typeof run.startedAt !== "string" ||
      !Number.isFinite(Date.parse(run.startedAt)))
  )
    return false;
  if ((task.stage === "initial") !== (run === undefined)) return false;
  if (["completed", "failed", "stopped"].includes(String(task.stage))) {
    const termination = task.termination as Record<string, unknown> | undefined;
    const end =
      run?.[
        task.stage === "completed"
          ? "completedAt"
          : task.stage === "failed"
            ? "failedAt"
            : "stoppedAt"
      ];
    if (
      !termination ||
      typeof termination.terminatedAt !== "string" ||
      !Number.isFinite(Date.parse(termination.terminatedAt)) ||
      typeof end !== "string" ||
      !Number.isFinite(Date.parse(end))
    )
      return false;
    if (task.stage === "completed" && !Object.hasOwn(task, "result")) return false;
  }
  return (
    ["taskId", "requestId", "seriesId"].every((key) =>
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(String(task[key] ?? "")),
    ) &&
    ["receivedAt", "eligibleAt", "deadlineAt", "timestamp", "updatedAt"].every(
      (key) => typeof task[key] === "string" && Number.isFinite(Date.parse(task[key] as string)),
    ) &&
    stageValues.includes(String(task.stage)) &&
    typeof task.canceled === "boolean" &&
    task.canceled === (task.canceledAt !== undefined) &&
    typeof task.dataDomain === "string" &&
    typeof task.revision === "string" &&
    task.revision.startsWith(`${task.dataDomain}:`) &&
    /^[0-9]+$/.test(task.revision.slice(String(task.dataDomain).length + 1))
  );
}
export function validRunSnapshot(value: unknown): value is RunSnapshot {
  if (!value || typeof value !== "object") return false;
  const run = value as Record<string, unknown>;
  try {
    if (sourcePosition(String(run.revision)).domain !== run.dataDomain) return false;
  } catch {
    return false;
  }
  return (
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(String(run.runId)) &&
    stageValues.includes(String(run.stage)) &&
    run.stage !== "initial" &&
    typeof run.dataDomain === "string" &&
    typeof run.revision === "string" &&
    run.revision.startsWith(`${run.dataDomain}:`) &&
    typeof run.startedAt === "string" &&
    Number.isFinite(Date.parse(run.startedAt)) &&
    typeof run.updatedAt === "string" &&
    Number.isFinite(Date.parse(run.updatedAt))
  );
}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(`${status} ${code}：${message}`);
  }
}
export function newIdentity(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = BigInt(Date.now());
  let result = "";
  for (let index = 0; index < 10; index++) {
    result = alphabet[Number(time & 31n)] + result;
    time >>= 5n;
  }
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) result += alphabet[byte & 31];
  return result;
}
export function originalParameters(request: Record<string, unknown>): Parameters {
  const { requestId: _generated, ...parameters } = structuredClone(request);
  if (typeof parameters.type !== "string") throw new Error("原请求缺少类型，不能重做。");
  return parameters as Parameters;
}
export function endpointMatches(left: Endpoint, right: Endpoint): boolean {
  return left.id === right.id && left.binding === right.binding;
}
export class Api {
  constructor(readonly csrf: string) {}
  async local<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(path, {
      method,
      headers: {
        "X-UI-Token": this.csrf,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return this.decode<T>(response);
  }
  async decode<T>(response: Response): Promise<T> {
    const value = await response.json();
    if (!response.ok)
      throw new ApiError(
        response.status,
        value.error?.code ?? "invalid_response",
        value.error?.message ?? "后端错误",
        value.error?.details,
      );
    return value as T;
  }
  headers(endpoint: Endpoint, extra: Record<string, string> = {}): Record<string, string> {
    return { "X-UI-Token": this.csrf, "X-Endpoint-Binding": endpoint.binding, ...extra };
  }
  path(endpoint: Endpoint, path: string): string {
    return `/api/endpoints/${encodeURIComponent(endpoint.id)}${path}`;
  }
  async request<T>(
    endpoint: Endpoint,
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const response = await fetch(this.path(endpoint, path), {
      method: options.method ?? "GET",
      headers: this.headers(endpoint, {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      }),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return this.decode<T>(response);
  }
}
export type ReceiptState = "draft" | "sending" | "accepted" | "failed" | "unknown";
export interface Entry {
  id: string;
  endpoint: Endpoint;
  parameters: Parameters;
  revision: string;
  state: ReceiptState;
  everUnknown: boolean;
  message: string;
  snapshot?: TaskSnapshot;
}
export interface Batch {
  id: string;
  endpoint: Endpoint;
  entries: Entry[];
  sending: boolean;
}
export class SubmissionBar {
  readonly batches: Batch[] = [];
  constructor(
    readonly send: (entry: Entry) => Promise<TaskSnapshot>,
    readonly changed: () => void = () => {},
    readonly accepted: (entry: Entry) => void = () => {},
  ) {}
  create(endpoint: Endpoint): Batch {
    if (this.batches.length >= 100) throw new Error("本页批次上限 100；请移除已结束批次。");
    const batch = {
      id: newIdentity(),
      endpoint: structuredClone(endpoint),
      entries: [],
      sending: false,
    };
    this.batches.push(batch);
    return batch;
  }
  add(batch: Batch, parameters: Parameters, revision: string): Entry {
    if (batch.sending || batch.entries.some((item) => item.state !== "draft"))
      throw new Error("已发送批次不能再加入草稿。");
    if (batch.entries.length >= 50) throw new Error("每批最多 50 项。");
    if (this.batches.reduce((count, item) => count + item.entries.length, 0) >= 200)
      throw new Error("本页最多保留 200 项回执/草稿；请移除已结束批次。");
    if (new TextEncoder().encode(JSON.stringify(parameters)).byteLength > 65_536)
      throw new Error("参数超过 UI 64 KiB 上限。");
    const entry: Entry = {
      id: newIdentity(),
      endpoint: structuredClone(batch.endpoint),
      parameters: structuredClone(parameters),
      revision,
      state: "draft",
      everUnknown: false,
      message: "",
    };
    batch.entries.push(entry);
    this.changed();
    return entry;
  }
  move(batch: Batch, index: number, direction: number): void {
    if (batch.sending || batch.entries.some((entry) => entry.state !== "draft")) return;
    const next = index + direction;
    if (next < 0 || next >= batch.entries.length) return;
    [batch.entries[index], batch.entries[next]] = [batch.entries[next]!, batch.entries[index]!];
    this.changed();
  }
  async retry(entry: Entry): Promise<void> {
    if (entry.state === "sending" || entry.state === "accepted") return;
    entry.state = "sending";
    this.changed();
    try {
      const snapshot = await this.send(entry);
      if (!validSnapshot(snapshot) || snapshot.requestId !== entry.id)
        throw new Error("后端提交回执无效，不能确认创建结果。");
      entry.snapshot = snapshot;
      entry.state = "accepted";
      entry.message = "已创建 / 已确认原提交";
      this.accepted(entry);
    } catch (error) {
      const definitive = error instanceof ApiError && error.status >= 400 && error.status < 500;
      entry.everUnknown ||= !definitive;
      entry.state = entry.everUnknown ? "unknown" : "failed";
      entry.message = `${entry.state === "unknown" ? "提交结果未知；原身份与 guard 保留。后续 412 也不能排除原任务存在。" : "本次提交被拒绝。"} ${error instanceof Error ? error.message : String(error)}`;
    }
    this.changed();
  }
  async sendBatch(batch: Batch): Promise<void> {
    if (batch.sending) return;
    batch.sending = true;
    this.changed();
    try {
      for (const entry of batch.entries) if (entry.state === "draft") await this.retry(entry);
    } finally {
      batch.sending = false;
      this.changed();
    }
  }
  async quick(endpoint: Endpoint, parameters: Parameters, revision: string): Promise<Entry> {
    const batch = this.create(endpoint);
    const entry = this.add(batch, parameters, revision);
    await this.sendBatch(batch);
    return entry;
  }
}
export class Selection {
  private generation = 0;
  private controller = new AbortController();
  endpoint: Endpoint | undefined;
  select(endpoint: Endpoint) {
    this.controller.abort();
    this.controller = new AbortController();
    this.endpoint = endpoint;
    this.generation++;
  }
  capture() {
    const generation = this.generation;
    return { signal: this.controller.signal, current: () => generation === this.generation };
  }
}
function validDirectoryRow(value: unknown, field: "tasks" | "runs"): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>,
    state = row.state as Record<string, unknown> | undefined;
  if (
    !state ||
    typeof state !== "object" ||
    typeof row.type !== "string" ||
    typeof row.version !== "string"
  )
    return false;
  const ids = field === "tasks" ? ["taskId", "requestId", "seriesId"] : ["runId"];
  if (ids.some((key) => !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(String(row[key] ?? "")))) return false;
  const times =
    field === "tasks"
      ? ["receivedAt", "updatedAt", "eligibleAt", "deadlineAt"]
      : ["startedAt", "updatedAt"];
  if (
    times.some(
      (key) => typeof row[key] !== "string" || !Number.isFinite(Date.parse(row[key] as string)),
    )
  )
    return false;
  const flags =
    field === "tasks"
      ? ["pending", "timedOut", "canceled", "completed", "runFailed"]
      : ["running", "completed", "failed", "stopping", "stopped", "reclaimed", "sealed"];
  if (flags.some((key) => typeof state[key] !== "boolean")) return false;
  if (field === "tasks")
    return (
      stageValues.includes(String(row.stage)) &&
      row.stage === state.stage &&
      row.canceled === state.canceled &&
      typeof row.scope === "string"
    );
  for (const [flag, key] of [
    ["completed", "completedAt"],
    ["failed", "failedAt"],
    ["reclaimed", "reclaimedAt"],
    ["stopped", "stoppedAt"],
  ] as const) {
    if (state[flag] !== (row[key] !== undefined)) return false;
    if (
      row[key] !== undefined &&
      (typeof row[key] !== "string" || !Number.isFinite(Date.parse(row[key] as string)))
    )
      return false;
  }
  return (
    stageValues.includes(String(row.stage)) &&
    row.stage !== "initial" &&
    (["running", "completed", "failed", "stopping", "stopped"] as const).every(
      (stage) => state[stage] === (row.stage === stage),
    )
  );
}
export class CollectionReplica {
  private values: Map<string, TaskSummary | RunSummary>;
  revision: string;
  constructor(
    readonly field: "tasks" | "runs",
    items: (TaskSummary | RunSummary)[],
    revision: string,
    readonly maxItems = 10_000,
    readonly maxBytes = 8_388_608,
  ) {
    sourcePosition(revision);
    this.revision = revision;
    this.values = new Map(items.map((item) => [this.id(item), item]));
    if (this.values.size !== items.length || items.some((item) => !validDirectoryRow(item, field)))
      throw new Error("完整基线有重复成员或无效摘要。");
    this.budget(this.values);
  }
  private id(item: TaskSummary | RunSummary): string {
    return this.field === "tasks" ? (item as TaskSummary).taskId : (item as RunSummary).runId;
  }
  private budget(values: Map<string, TaskSummary | RunSummary>): void {
    if (
      values.size > this.maxItems ||
      new TextEncoder().encode(JSON.stringify([...values.values()])).byteLength > this.maxBytes
    )
      throw new Error("完整集合超过本机预算；不截断基线或推进续读位置。");
  }
  apply(envelope: CollectionEnvelope<TaskSummary | RunSummary>): boolean {
    const previous = sourcePosition(this.revision),
      next = sourcePosition(envelope.revision);
    if (next.domain !== previous.domain) throw new Error("集合增量属于另一个数据域。");
    if (next.position <= previous.position) return false;
    if (!Array.isArray(envelope.changes) || envelope.changes.length > 1000)
      throw new Error("集合源封装无效或超限。");
    const draft = new Map(this.values),
      seen = new Set<string>();
    for (const change of envelope.changes) {
      if (seen.has(change.id)) throw new Error("同一源封装重复成员。");
      seen.add(change.id);
      if (change.kind === "removed") {
        if (!draft.delete(change.id)) throw new Error("集合移出没有对应完整基线成员。");
      } else {
        if (
          !["joined", "updated"].includes(change.kind) ||
          !change.summary ||
          !validDirectoryRow(change.summary, this.field) ||
          this.id(change.summary) !== change.id ||
          (change.kind === "updated" && !draft.has(change.id)) ||
          (change.kind === "joined" && draft.has(change.id))
        )
          throw new Error("集合增量不匹配完整基线。");
        draft.set(change.id, structuredClone(change.summary));
      }
    }
    this.budget(draft);
    this.values = draft;
    this.revision = envelope.revision;
    return true;
  }
  items(): (TaskSummary | RunSummary)[] {
    return [...this.values.values()];
  }
}
export class Directory<P extends TaskPage | RunPage = TaskPage> {
  constructor(readonly field: "tasks" | "runs" = "tasks") {}
  query = "";
  page: P | undefined;
  expired = false;
  private generation = 0;
  dropped = 0;
  error = "";
  live = false;
  private replica: CollectionReplica | undefined;
  rejectQuery(error: unknown): void {
    this.generation++;
    this.error = String(error);
  }
  async load(
    fetchPage: (query: string) => Promise<P>,
    query: string,
    append = false,
    current: () => boolean = () => true,
  ): Promise<boolean> {
    const generation = ++this.generation;
    const isCurrent = () => current() && generation === this.generation;
    try {
      if (append && (this.expired || !this.page?.next)) throw new Error("请重新查询目录。");
      const original = append ? this.query : query;
      const params = new URLSearchParams(original);
      if (append) params.set("cursor", this.page!.next!);
      const next = await fetchPage(params.toString());
      if (!isCurrent()) return false;
      const rows = (page: P) => (page as unknown as Record<string, unknown[]>)[this.field]!;
      if (!Array.isArray(rows(next)) || !next.observedAt || !next.expiresAt || !next.revision)
        throw new Error("目录协议无效。");
      sourcePosition(next.revision);
      if (rows(next).some((row) => !validDirectoryRow(row, this.field)))
        throw new Error("目录摘要协议无效，未替换已有快照。");
      if (
        append &&
        (next.revision !== this.page?.revision ||
          next.observedAt !== this.page?.observedAt ||
          next.expiresAt !== this.page.expiresAt)
      )
        throw new Error("目录快照变化；拒绝拼接。请重新查询。");
      const merged = append ? [...rows(this.page!), ...rows(next)] : rows(next);
      if (
        merged.length > 10_000 ||
        new TextEncoder().encode(JSON.stringify(merged)).byteLength > 8_388_608
      )
        throw new Error("完整目录超过本机预算；未丢弃成员或推进游标。");
      this.page = { ...next, [this.field]: merged, items: merged };
      this.replica = undefined;
      this.live = false;
      if (!append) this.dropped = 0;
      this.query = original;
      this.expired = false;
      this.error = "";
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      this.error = String(error);
      if (error instanceof ApiError && error.code === "query_expired") this.expired = true;
      throw error;
    }
  }
  apply(envelope: CollectionEnvelope<TaskSummary | RunSummary>): boolean {
    if (!this.page || this.page.next || this.dropped)
      throw new Error("分页基线未完整，不能应用集合增量。");
    this.replica ??= new CollectionReplica(
      this.field,
      (this.page as unknown as Record<string, (TaskSummary | RunSummary)[]>)[this.field]!,
      this.page.revision,
    );
    const accepted = this.replica.apply(envelope);
    if (accepted) {
      const items = this.replica.items();
      const sort = new URLSearchParams(this.query).get("sort");
      const key =
        sort === "updated-desc" ? "updatedAt" : this.field === "tasks" ? "receivedAt" : "startedAt";
      items.sort((a, b) => {
        const left = (a as unknown as Record<string, string>)[key] ?? "";
        const right = (b as unknown as Record<string, string>)[key] ?? "";
        const ai = this.field === "tasks" ? (a as TaskSummary).taskId : (a as RunSummary).runId;
        const bi = this.field === "tasks" ? (b as TaskSummary).taskId : (b as RunSummary).runId;
        return left === right ? (ai < bi ? -1 : ai > bi ? 1 : 0) : left > right ? -1 : 1;
      });
      this.page = { ...this.page, [this.field]: items, items, revision: this.replica.revision };
    }
    this.live = true;
    return accepted;
  }
  prepareLive(): string {
    if (!this.page || this.page.next || this.dropped)
      throw new Error("必须先取得完整分页基线，才可订阅集合。");
    this.replica = new CollectionReplica(
      this.field,
      (this.page as unknown as Record<string, (TaskSummary | RunSummary)[]>)[this.field]!,
      this.page.revision,
    );
    return this.page.revision;
  }
}
export class TaskSnapshots {
  readonly values = new Map<string, TaskSnapshot>();
  private readonly versions = new Map<string, { generation: number; watermark: number }>();
  private version(id: string) {
    let value = this.versions.get(id);
    if (!value) {
      value = { generation: 0, watermark: 0 };
      this.versions.set(id, value);
      this.trimVersions();
    }
    return value;
  }
  seed(snapshot: TaskSnapshot): void {
    if (!validSnapshot(snapshot)) throw new Error("Task 快照协议无效。");
    if (!this.versions.has(snapshot.taskId)) {
      this.version(snapshot.taskId).watermark = sourcePosition(snapshot.revision).position;
      this.store(snapshot);
    }
  }
  begin(id: string): (snapshot: TaskSnapshot) => boolean {
    const version = this.version(id);
    const generation = ++version.generation;
    return (snapshot) => {
      if (!validSnapshot(snapshot) || snapshot.taskId !== id || this.versions.get(id) !== version)
        return false;
      const position = sourcePosition(snapshot.revision).position;
      if (snapshot.canceled) return this.confirmCancellation(id, snapshot);
      if (
        position < version.watermark ||
        (version.generation !== generation && position <= version.watermark)
      )
        return false;
      version.generation++;
      version.watermark = position;
      this.store(snapshot);
      return true;
    };
  }
  beginCancellation(id: string): (snapshot: TaskSnapshot) => boolean {
    // A successful modification receipt is not invalidated by intervening reads or SSE.
    return (snapshot) => this.confirmCancellation(id, snapshot);
  }
  confirmCancellation(id: string, snapshot: TaskSnapshot): boolean {
    if (
      !validSnapshot(snapshot) ||
      snapshot.taskId !== id ||
      typeof snapshot.canceledAt !== "string" ||
      !Number.isFinite(Date.parse(snapshot.canceledAt))
    )
      throw new Error("取消回执未确认目标 Task 的取消；结果未知，请核对原 Task。");
    const previous = this.values.get(id);
    if (previous?.canceledAt !== undefined && previous.canceledAt !== snapshot.canceledAt)
      throw new Error("取消事实冲突；保留已确认快照，不猜测事实顺序。");
    const version = this.version(id),
      position = sourcePosition(snapshot.revision).position;
    version.generation++;
    const latest =
      previous && sourcePosition(previous.revision).position > position ? previous : snapshot;
    version.watermark = Math.max(version.watermark, position);
    this.store({ ...latest, canceled: true, canceledAt: snapshot.canceledAt });
    return true;
  }
  observe(snapshot: TaskSnapshot, watermark: number): boolean {
    if (!Number.isSafeInteger(watermark) || watermark < 0)
      throw new Error("事件观察缺少有效的公开 watermark。");
    const version = this.version(snapshot.taskId);
    if (!validSnapshot(snapshot) || sourcePosition(snapshot.revision).position !== watermark)
      throw new Error("快照 revision 与观察水位不一致。");
    if (watermark < version.watermark) return false;
    version.watermark = watermark;
    if (snapshot.canceledAt !== undefined)
      return this.confirmCancellation(snapshot.taskId, snapshot);
    version.generation++;
    this.store(snapshot);
    return true;
  }
  private store(snapshot: TaskSnapshot): void {
    const previous = this.values.get(snapshot.taskId);
    if (previous && previous.dataDomain !== snapshot.dataDomain)
      throw new Error("不能合并不同数据域的 Task 快照。");
    const value = previous?.canceledAt
      ? { ...snapshot, canceled: true, canceledAt: previous.canceledAt }
      : snapshot;
    this.values.set(snapshot.taskId, value);
    let bytes = 0;
    const keep = [...this.values.values()].reverse();
    for (const [index, value] of keep.entries()) {
      bytes += new TextEncoder().encode(JSON.stringify(value)).byteLength;
      if (index >= 200 || bytes > 8_388_608) {
        this.values.delete(value.taskId);
        this.versions.delete(value.taskId);
      }
    }
    this.trimVersions();
  }
  private trimVersions(): void {
    while (this.versions.size > 256) {
      const oldest = this.versions.keys().next().value;
      if (oldest) {
        this.versions.delete(oldest);
        this.values.delete(oldest);
      }
    }
  }
}
export function eventKey(event: PublicEvent): string {
  return `${event.revision}:${event.taskId ?? ""}:${event.runId ?? ""}:${event.type}`;
}
export class EventWindow {
  events: PublicEvent[] = [];
  historyNext: string | undefined;
  streamCursor: string | undefined;
  historyLoaded = false;
  truncated = false;
  stale = true;
  gap = "";
  lastReceived = "";
  merge(events: PublicEvent[]): void {
    const values = new Map(this.events.map((event) => [eventKey(event), event]));
    for (const event of events) {
      if (!event.revision || sourcePosition(event.revision).position !== event.sequence)
        throw new Error("事件 revision 与源序位置不一致。");
      values.set(eventKey(event), event);
    }
    const sorted = [...values.values()].sort(
      (a, b) => a.sequence - b.sequence || eventKey(a).localeCompare(eventKey(b)),
    );
    let bytes = 0;
    const kept: PublicEvent[] = [];
    for (const event of sorted.reverse()) {
      bytes += new TextEncoder().encode(JSON.stringify(event)).byteLength;
      if (kept.length >= 500 || bytes > 2_097_152) {
        this.truncated = true;
        break;
      }
      kept.push(event);
    }
    this.events = kept.reverse();
  }
  history(page: HistoryPage): void {
    if (
      !Array.isArray(page.events) ||
      typeof page.cursor !== "string" ||
      !page.revision ||
      !Number.isSafeInteger(page.watermark)
    )
      throw new Error("事件历史协议无效。");
    this.merge(page.events);
    this.historyNext = page.next;
    this.historyLoaded = true;
  }
  observation(value: Observation): void {
    this.merge(value.events);
    this.streamCursor = value.cursor;
    this.stale = false;
    this.lastReceived = new Date().toISOString();
  }
}
export async function consumeSse(
  response: Response,
  receive: (observation: Observation) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("事件流为空。");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      if (buffer.length > 2_097_152) throw new Error("单个事件帧超过 UI 上限。");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = frame.split("\n");
        if (lines.includes("event: task.error")) {
          const value = JSON.parse(
            lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n"),
          );
          throw streamError(value);
        }
        if (lines.includes("event: task.observation")) {
          const data = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          const value = JSON.parse(data) as Observation;
          if (
            !Array.isArray(value.events) ||
            !Array.isArray(value.snapshots) ||
            value.snapshots.some((snapshot) => !validSnapshot(snapshot)) ||
            typeof value.cursor !== "string"
          )
            throw new Error("事件流协议不兼容。");
          receive(value);
        }
        end = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) throw new Error("事件帧不完整，保留最后确认游标。");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function streamError(value: {
  error?: { code?: string; message?: string; details?: unknown };
}): ApiError {
  const code = value.error?.code ?? "stream_error";
  const status =
    code === "forbidden"
      ? 403
      : code === "unauthenticated"
        ? 401
        : ["history_expired", "query_expired"].includes(code)
          ? 410
          : code === "capacity_exceeded"
            ? 429
            : code.startsWith("invalid_")
              ? 400
              : 503;
  return new ApiError(status, code, value.error?.message ?? "订阅中断。", value.error?.details);
}
export async function consumeCollectionSse(
  response: Response,
  receive: (envelope: CollectionEnvelope<TaskSummary | RunSummary>) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("集合事件流为空。");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      if (new TextEncoder().encode(buffer).byteLength > 1_048_576)
        throw new Error("集合源封装超出本机预算。");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const lines = buffer.slice(0, end).split("\n");
        buffer = buffer.slice(end + 2);
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (lines.includes("event: task.error")) throw streamError(JSON.parse(data));
        if (
          lines.some(
            (line) => line === "event: task.collection" || line === "event: run.collection",
          )
        ) {
          const envelope = JSON.parse(data) as CollectionEnvelope<TaskSummary | RunSummary>;
          if (
            !envelope.revision ||
            lines
              .find((line) => line.startsWith("id:"))
              ?.slice(3)
              .trim() !== envelope.revision ||
            !Array.isArray(envelope.changes)
          )
            throw new Error("集合事件源封装无效。");
          receive(envelope);
        }
        end = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) throw new Error("集合源封装中途断线；保留最后完整应用的 revision。");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function discoveryRevision(types: TaskTypeDiscovery[], parameters: Parameters): string {
  const type = types.find((entry) => entry.type === parameters.type);
  if (!type) throw new Error(`当前发现没有可提交类型 ${parameters.type}，保留原参数。`);
  if (!/^[a-f0-9]{64}$/.test(type.revision)) throw new Error("发现 revision 无效。");
  return type.revision;
}
