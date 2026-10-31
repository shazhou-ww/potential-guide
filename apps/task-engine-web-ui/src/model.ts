import type {
  RunPage,
  HistoryPage,
  Observation,
  PublicEvent,
  TaskPage,
  TaskSnapshot,
  TaskTypeDiscovery,
} from "@potential-guide/task-protocol";
import type { Endpoint } from "./server.js";

export type Parameters = Record<string, unknown> & { type: string };
export function validSnapshot(value: unknown): value is TaskSnapshot {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  return (
    ["taskId", "requestId", "seriesId"].every((key) =>
      /^[0-9A-HJKMNP-TV-Z]{26}$/.test(String(task[key] ?? "")),
    ) &&
    ["receivedAt", "eligibleAt", "deadlineAt", "timestamp"].every(
      (key) => typeof task[key] === "string" && Number.isFinite(Date.parse(task[key] as string)),
    ) &&
    [
      "initial",
      "preparing",
      "queued",
      "running",
      "completed",
      "preparation_failed",
      "allocation_failed",
      "run_failed",
    ].includes(String(task.stage))
  );
}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
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
  const times = field === "tasks" ? ["receivedAt", "updatedAt"] : ["startedAt"];
  if (
    times.some(
      (key) => typeof row[key] !== "string" || !Number.isFinite(Date.parse(row[key] as string)),
    )
  )
    return false;
  const flags =
    field === "tasks"
      ? ["pending", "timedOut", "canceled", "completed", "runFailed"]
      : ["running", "completed", "failed", "reclaimed", "sealed"];
  if (flags.some((key) => typeof state[key] !== "boolean")) return false;
  if (field === "tasks") return typeof state.stage === "string";
  for (const [flag, key] of [
    ["completed", "completedAt"],
    ["failed", "failedAt"],
    ["reclaimed", "reclaimedAt"],
  ] as const) {
    if (state[flag] !== (row[key] !== undefined)) return false;
    if (
      row[key] !== undefined &&
      (typeof row[key] !== "string" || !Number.isFinite(Date.parse(row[key] as string)))
    )
      return false;
  }
  return state.running === (!state.completed && !state.failed && !state.reclaimed);
}
export class Directory<P extends TaskPage | RunPage = TaskPage> {
  constructor(readonly field: "tasks" | "runs" = "tasks") {}
  query = "";
  page: P | undefined;
  expired = false;
  private generation = 0;
  dropped = 0;
  error = "";
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
      if (!Array.isArray(rows(next)) || !next.observedAt || !next.expiresAt)
        throw new Error("目录协议无效。");
      if (rows(next).some((row) => !validDirectoryRow(row, this.field)))
        throw new Error("目录摘要协议无效，未替换已有快照。");
      if (
        append &&
        (next.observedAt !== this.page?.observedAt || next.expiresAt !== this.page.expiresAt)
      )
        throw new Error("目录快照变化；拒绝拼接。请重新查询。");
      this.page = append ? { ...next, [this.field]: [...rows(this.page!), ...rows(next)] } : next;
      if (!append) this.dropped = 0;
      if (rows(this.page).length > 1000) {
        this.dropped += rows(this.page).length - 1000;
        this.page = { ...this.page, [this.field]: rows(this.page).slice(-1000) };
      }
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
    if (!this.versions.has(snapshot.taskId)) {
      this.version(snapshot.taskId);
      this.store(snapshot);
    }
  }
  begin(id: string): (snapshot: TaskSnapshot) => boolean {
    const version = this.version(id);
    const generation = ++version.generation;
    return (snapshot) => {
      if (snapshot.taskId !== id) return false;
      // Cancellation is an irreversible fact, even in a late GET response.
      if (snapshot.canceledAt !== undefined) return this.confirmCancellation(id, snapshot);
      if (
        this.versions.get(id) !== version ||
        version.generation !== generation ||
        this.values.get(id)?.canceledAt !== undefined
      )
        return false;
      version.generation++;
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
      snapshot.taskId !== id ||
      typeof snapshot.canceledAt !== "string" ||
      !Number.isFinite(Date.parse(snapshot.canceledAt))
    )
      throw new Error("取消回执未确认目标 Task 的取消；结果未知，请核对原 Task。");
    const previous = this.values.get(id);
    if (previous?.canceledAt !== undefined && previous.canceledAt !== snapshot.canceledAt)
      throw new Error("取消事实冲突；保留已确认快照，不猜测事实顺序。");
    this.version(id).generation++;
    // Public cancellation freezes the Task, not its Run. Only observation time varies.
    this.store(
      previous?.canceledAt !== undefined
        ? { ...previous, timestamp: snapshot.timestamp }
        : snapshot,
    );
    return true;
  }
  observe(snapshot: TaskSnapshot, watermark: number): boolean {
    if (!Number.isSafeInteger(watermark) || watermark < 0)
      throw new Error("事件观察缺少有效的公开 watermark。");
    const version = this.version(snapshot.taskId);
    if (watermark < version.watermark) return false;
    const previous = this.values.get(snapshot.taskId);
    if (previous?.canceledAt !== undefined && snapshot.canceledAt === undefined) return false;
    version.watermark = watermark;
    if (snapshot.canceledAt !== undefined)
      return this.confirmCancellation(snapshot.taskId, snapshot);
    version.generation++;
    this.store(snapshot);
    return true;
  }
  private store(snapshot: TaskSnapshot): void {
    this.values.set(snapshot.taskId, snapshot);
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
    const values = new Map(this.events.map((event) => [event.sequence, event]));
    for (const event of events) values.set(event.sequence, event);
    const sorted = [...values.values()].sort((a, b) => a.sequence - b.sequence);
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
export function discoveryRevision(types: TaskTypeDiscovery[], parameters: Parameters): string {
  const type = types.find((entry) => entry.type === parameters.type);
  if (!type) throw new Error(`当前发现没有可提交类型 ${parameters.type}，保留原参数。`);
  if (!/^[a-f0-9]{64}$/.test(type.revision)) throw new Error("发现 revision 无效。");
  return type.revision;
}
