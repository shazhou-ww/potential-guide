import type { Json, JsonObject } from "./json.js";
import type { TypeWorkerRegistration } from "./run.js";
import type { InputSchema } from "./schema.js";

export type Stage = "initial" | "running" | "completed" | "run_failed";
export type MatchPolicy = "started-after-eligible" | "terminated-after-eligible";
export interface Recurrence {
  periodMs: number;
  anchor: "eligible" | "terminated";
}
export type TaskRequest = JsonObject & {
  requestId: string;
  type: string;
  timeoutMs: number;
  eligibleAt?: string;
  seriesId?: string;
  matchPolicy?: MatchPolicy;
  recurrence?: Recurrence & JsonObject;
};
export interface ErrorFact {
  code: string;
  message: string;
}
export interface TaskSnapshot {
  requestId: string;
  taskId: string;
  seriesId: string;
  stage: Stage;
  receivedAt: string;
  eligibleAt: string;
  deadlineAt: string;
  timestamp: string;
  canceledAt?: string;
  run?: {
    runId: string;
    startedAt: string;
    matchedAt?: string;
    completedAt?: string;
    failedAt?: string;
  };
  termination?: { terminatedAt: string };
  error?: ErrorFact;
  result?: Json;
}
export interface Binding {
  type: string;
  version: string;
  contractRevision: string;
  environment: string;
  scope: string;
  subject: string;
  matchPolicy: MatchPolicy;
}
export interface TaskRecord {
  receivedSequence: number;
  /** Absent only in historical v2 checkpoints; recover from retained events, never guess. */
  updatedAt?: string;
  request: TaskRequest;
  binding: Binding;
  input: Json;
  releaseRunIds?: string[];
  snapshot: TaskSnapshot;
  successor?: { requestId: string; taskId: string };
}
export interface RunRecord {
  runId: string;
  generation: string;
  binding: Binding;
  input: Json;
  startedAt: string;
  startedSequence: number;
  terminatedSequence?: number;
  sealed?: boolean;
  sealedTaskIds?: string[];
  completedAt?: string;
  failedAt?: string;
  result?: Json;
  error?: ErrorFact;
  reclaimedAt?: string;
  workerGeneration?: string;
  evidence?: { kind: "checkpoint" | "late-completed" | "late-failed"; value: Json }[];
  cleanupUnknown?: { reason: string; observedAt: string };
}
export interface Facts {
  projectionVersion: 3;
  watermark: number;
  tasks: Record<string, TaskRecord>;
  runs: Record<string, RunRecord>;
  messages: Record<string, TaskMessageRecord>;
}
export interface TaskMessageRecord {
  taskId: string;
  messageId: string;
  runId: string;
  generation: string;
  caller: Caller;
  payload: Json;
  receivedAt: string;
  state: "queued" | "accepted" | "rejected" | "unknown";
  resolvedAt?: string;
  reason?: string;
}
export interface EventData {
  "task.created": { task: TaskRecord };
  "task.run.bound": { runId: string };
  "task.terminated": { runId?: string; error?: ErrorFact };
  "task.canceled": { runIds?: string[] };
  "task.successor": { requestId: string; taskId: string };
  "run.started": { run: RunRecord };
  "run.dispatched": { workerGeneration: string };
  "run.evidence": { kind: "checkpoint" | "late-completed" | "late-failed"; value: Json };
  "run.progress": { progress: Json };
  "run.completed": { result: Json };
  "run.failed": { error: ErrorFact; result?: Json };
  "run.sealed": { taskIds: string[] };
  "run.reclaimed": Record<string, never>;
  "run.cleanup.unknown": { reason: string };
  "message.received": { message: TaskMessageRecord };
  "message.resolved": {
    messageId: string;
    state: "accepted" | "rejected" | "unknown";
    reason?: string;
  };
  "records.forgotten": { taskIds: string[]; runIds: string[] };
}
export type EventKind = keyof EventData;
export type FactEvent = {
  [K in EventKind]: {
    sequence: number;
    type: K;
    occurredAt: string;
    scope: string;
    taskId?: string;
    runId?: string;
    data: EventData[K];
  };
}[EventKind];
export type NewEvent = FactEvent extends infer E
  ? E extends FactEvent
    ? Omit<E, "sequence">
    : never
  : never;
export type PublicEvent = Omit<FactEvent, "data"> & { data: Json };
export interface StoreView {
  storeId: string;
  floor: number;
  facts: Facts;
  events: FactEvent[];
}
export interface Store {
  claim(owner: string): void;
  release(owner: string): void;
  read(): StoreView;
  append(owner: string, expectedWatermark: number, events: NewEvent[]): StoreView;
  compact(owner: string, through: number): void;
  close(): void;
}
export interface Clock {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}
export interface Caller {
  scope: string;
  subject: string;
}
export type Operation =
  | "submit"
  | "request"
  | "task"
  | "cancel"
  | "history"
  | "subscribe"
  | "list"
  | "list-runs"
  | "message";
export type Authorize = (caller: Caller, operation: Operation, scope: string) => boolean;
export interface PreparationOptions {
  signal: AbortSignal;
  deadlineAt: string;
  /** Trusted Engine binding; absent only for older direct adapters. */
  context?: Readonly<Pick<Binding, "type" | "version" | "environment" | "scope">>;
}
export interface StartPermit {
  runId: string;
  generation: string;
  startedAt: string;
  progress(value: unknown): void;
  complete(value: unknown): void;
  fail(error: ErrorFact): void;
}
export interface ExecuteOptions {
  context: Readonly<Pick<Binding, "type" | "version" | "environment" | "scope">>;
  signal: AbortSignal;
  replaceRunId?: string;
  start(): StartPermit;
  authorizeReplacement(runId: string, generation: string): boolean | Promise<boolean>;
}
export interface RunTracking {
  runId: string;
  generation: string;
  startedAt: string;
  finished: Promise<void>;
  reclaim(reason: string): Promise<void>;
}
export interface RegisteredType extends TypeWorkerRegistration {}
export type HistoryFilter = { taskId: string } | { runId: string } | { seriesId: string };
export interface HistoryPage {
  events: PublicEvent[];
  watermark: number;
  cursor: string;
  next?: string;
}
export interface Observation {
  snapshots: TaskSnapshot[];
  events: PublicEvent[];
  watermark: number;
  cursor: string;
}
export interface Subscription {
  initial: Observation;
  pull(): Observation;
  close(): void;
}
export interface TaskQuery {
  type?: string;
  runId?: string;
  createdFrom?: string;
  createdBefore?: string;
  updatedFrom?: string;
  updatedBefore?: string;
  sort?: "created-desc" | "updated-desc";
}
export interface TaskSummary {
  taskId: string;
  requestId: string;
  seriesId: string;
  type: string;
  version: string;
  receivedAt: string;
  updatedAt: string;
  state: {
    stage: Stage;
    pending: boolean;
    timedOut: boolean;
    canceled: boolean;
    completed: boolean;
    runFailed: boolean;
  };
}
export interface TaskPage {
  tasks: TaskSummary[];
  /** Fixed observation time for this query's summaries, not a Task update. */
  observedAt: string;
  expiresAt: string;
  next?: string;
}
export interface RunQuery {
  type?: string;
  startedFrom?: string;
  startedBefore?: string;
  sort?: "started-desc";
}
export interface RunSummary {
  runId: string;
  type: string;
  version: string;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  reclaimedAt?: string;
  state: {
    running: boolean;
    completed: boolean;
    failed: boolean;
    reclaimed: boolean;
    sealed: boolean;
  };
}
export interface RunPage {
  runs: RunSummary[];
  observedAt: string;
  expiresAt: string;
  next?: string;
}
export interface TaskService {
  sendTaskMessage(
    taskId: string,
    messageId: string,
    payload: unknown,
    caller: Caller,
  ): TaskMessageRecord;
  getTaskMessage(taskId: string, messageId: string, caller: Caller): TaskMessageRecord;
  discoverTypes(caller: Caller): readonly TaskTypeDiscovery[];
  submit(request: unknown, caller: Caller, options?: SubmitOptions): TaskSnapshot;
  getRequest(requestId: string, caller: Caller): TaskRequest;
  getTask(taskId: string, caller: Caller): TaskSnapshot;
  cancelTask(taskId: string, caller: Caller): TaskSnapshot;
  listTasks(query: TaskQuery, page: { cursor?: string; limit?: number }, caller: Caller): TaskPage;
  listRuns(query: RunQuery, page: { cursor?: string; limit?: number }, caller: Caller): RunPage;
  readHistory(
    filter: HistoryFilter,
    page: { cursor?: string; limit?: number },
    caller: Caller,
  ): HistoryPage;
  subscribe(filter: HistoryFilter, resume: string | undefined, caller: Caller): Subscription;
  start(): Promise<void>;
  close(): Promise<void>;
}
export interface TaskTypeDiscovery {
  readonly type: string;
  readonly version: string;
  readonly inputSchema: InputSchema;
  readonly revision: string;
}
export interface SubmitOptions {
  expectedRevision?: string;
}
