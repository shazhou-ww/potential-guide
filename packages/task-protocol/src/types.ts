import type { Json, JsonObject } from "./json.js";

export type Stage =
  | "initial"
  | "preparing"
  | "queued"
  | "running"
  | "completed"
  | "preparation_failed"
  | "allocation_failed"
  | "execution_failed";
export type ExecutionMatch = "started-after-eligible" | "completed-after-eligible";
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
  executionMatch?: ExecutionMatch;
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
  preparation?: { startedAt: string; completedAt?: string; failedAt?: string };
  allocation?: { boundAt?: string; failedAt?: string };
  execution?: { executionId: string; startedAt: string; completedAt?: string; failedAt?: string };
  termination?: { terminatedAt: string };
  error?: ErrorFact;
  result?: Json;
}
export interface Binding {
  type: string;
  version: string;
  environment: string;
  scope: string;
  subject: string;
  executionMatch: ExecutionMatch;
}
export interface TaskRecord {
  request: TaskRequest;
  binding: Binding;
  input: Json;
  prepared?: Json;
  snapshot: TaskSnapshot;
  successor?: { requestId: string; taskId: string };
}
export interface ExecutionRecord {
  executionId: string;
  generation: string;
  binding: Binding;
  input: Json;
  prepared: Json;
  startedAt: string;
  sealed?: boolean;
  completedAt?: string;
  failedAt?: string;
  result?: Json;
  error?: ErrorFact;
  reclaimedAt?: string;
}
export interface Facts {
  projectionVersion: 1;
  watermark: number;
  tasks: Record<string, TaskRecord>;
  executions: Record<string, ExecutionRecord>;
}
export interface EventData {
  "task.created": { task: TaskRecord };
  "task.preparation.started": Record<string, never>;
  "task.preparation.completed": { prepared: Json };
  "task.preparation.failed": { error: ErrorFact };
  "task.allocation.bound": { executionId: string };
  "task.allocation.failed": { error: ErrorFact };
  "task.terminated": { executionId?: string; error?: ErrorFact };
  "task.canceled": Record<string, never>;
  "task.successor": { requestId: string; taskId: string };
  "execution.started": { execution: ExecutionRecord };
  "execution.progress": { progress: Json };
  "execution.completed": { result: Json };
  "execution.failed": { error: ErrorFact };
  "execution.sealed": Record<string, never>;
  "execution.reclaimed": Record<string, never>;
  "records.forgotten": { taskIds: string[]; executionIds: string[] };
}
export type EventKind = keyof EventData;
export type FactEvent = {
  [K in EventKind]: {
    sequence: number;
    type: K;
    occurredAt: string;
    scope: string;
    taskId?: string;
    executionId?: string;
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
export type Operation = "submit" | "request" | "task" | "cancel" | "history" | "subscribe";
export type Authorize = (caller: Caller, operation: Operation, scope: string) => boolean;
export interface PreparationOptions {
  signal: AbortSignal;
  deadlineAt: string;
}
export interface StartPermit {
  executionId: string;
  generation: string;
  startedAt: string;
  progress(value: unknown): void;
  complete(value: unknown): void;
  fail(error: ErrorFact): void;
}
export interface ExecuteOptions {
  context: Readonly<Pick<Binding, "type" | "version" | "environment" | "scope">>;
  signal: AbortSignal;
  replaceExecutionId?: string;
  start(): StartPermit;
  authorizeReplacement(executionId: string, generation: string): boolean;
}
export interface ExecutionTracking {
  executionId: string;
  generation: string;
  startedAt: string;
  finished: Promise<void>;
  reclaim(reason: string): Promise<void>;
}
export interface TaskType<Input = Json, Prepared = Input> {
  type: string;
  version: string;
  environment: string;
  validate(input: unknown): Input;
  equals(input: Input, other: unknown): boolean;
  prepare(input: Input, options: PreparationOptions): Promise<Prepared>;
  validatePrepared(prepared: unknown): Prepared;
  validateResult(result: unknown): Json;
  validateProgress(progress: unknown): Json;
  execute(prepared: Prepared, options: ExecuteOptions): Promise<ExecutionTracking>;
}
export interface RegisteredType {
  type: string;
  version: string;
  environment: string;
  validate(input: unknown): unknown;
  equals(input: never, other: unknown): boolean;
  prepare(input: never, options: PreparationOptions): Promise<unknown>;
  validatePrepared(prepared: unknown): unknown;
  validateResult(result: unknown): Json;
  validateProgress(progress: unknown): Json;
  execute(prepared: never, options: ExecuteOptions): Promise<ExecutionTracking>;
}
export type HistoryFilter = { taskId: string } | { executionId: string } | { seriesId: string };
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
export interface TaskService {
  submit(request: unknown, caller: Caller): TaskSnapshot;
  getRequest(requestId: string, caller: Caller): TaskRequest;
  getTask(taskId: string, caller: Caller): TaskSnapshot;
  cancelTask(taskId: string, caller: Caller): TaskSnapshot;
  readHistory(
    filter: HistoryFilter,
    page: { cursor?: string; limit?: number },
    caller: Caller,
  ): HistoryPage;
  subscribe(filter: HistoryFilter, resume: string | undefined, caller: Caller): Subscription;
  start(): void;
  close(): Promise<void>;
}
