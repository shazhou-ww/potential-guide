import { createHash } from "node:crypto";
import {
  type Authorize,
  assertFactsVersion,
  at,
  type Binding,
  type Caller,
  type Clock,
  canonical,
  compileInputSchema,
  compileJsonSchema,
  type ErrorFact,
  type RunPage,
  type RunQuery,
  effectiveEnd,
  type FactEvent,
  fail,
  freeze,
  type HistoryFilter,
  type HistoryPage,
  type InputContract,
  isPending,
  type Json,
  type JsonContract,
  json,
  matchesRunTime,
  type NewEvent,
  type Observation,
  type Operation,
  object,
  type PublicEvent,
  positive,
  project,
  type RegisteredType,
  type RunRecord,
  type RunTracking,
  restoreTaskUpdates,
  type StartPermit,
  type Store,
  type StoreView,
  type SubmitOptions,
  type Subscription,
  TaskError,
  type TaskMessageRecord,
  type TaskPage,
  type TaskQuery,
  type TaskRecord,
  type TaskRequest,
  type TaskService,
  type TaskSnapshot,
  type TaskTypeDiscovery,
  timestamp,
  ulid,
  validateRunProgress,
} from "@potential-guide/task-protocol";
import { type CatalogLimits, RunCatalog, TaskCatalog } from "./catalog.js";
import { newId } from "./identity.js";
import { TypeSupervisor } from "./type-supervisor.js";

type CompiledType = RegisteredType & InputContract & { resultContract: JsonContract };

export interface EngineLimits extends CatalogLimits {
  maxTasks: number;
  maxEvents: number;
  maxPayloadBytes: number;
  maxConcurrent: number;
  maxSubscriptions: number;
  pageSize: number;
  executionWallMs: number;
  tickMs: number;
  retentionMs: number;
}
export interface EngineOptions {
  store: Store;
  types: readonly RegisteredType[];
  currentVersions: Readonly<Record<string, string>>;
  authorize: Authorize;
  clock?: Clock;
  limits?: Partial<EngineLimits>;
  /** Trusted isolated allocation lanes; unlisted types share maxConcurrent. */
  allocationLimits?: Readonly<Record<string, number>>;
  onError?: (error: ErrorFact) => void;
}
interface Group {
  exemplar: TaskRecord;
  owners: Set<string>;
  controller: AbortController;
  runId?: string;
}
interface Cursor {
  storeId: string;
  filter: string;
  watermark: number;
  position: number;
  mode: "page" | "stream";
}
const defaults: EngineLimits = {
  maxTasks: 10_000,
  maxEvents: 100_000,
  maxPayloadBytes: 65_536,
  maxConcurrent: 64,
  maxSubscriptions: 128,
  pageSize: 100,
  executionWallMs: 60_000,
  tickMs: 10,
  retentionMs: 86_400_000,
  queryScanLimit: 10_000,
  queryPageBytes: 65_536,
  maxQueryViews: 64,
  maxQueryBytes: 8_388_608,
  queryLifetimeMs: 60_000,
};
const common = new Set([
  "requestId",
  "type",
  "timeoutMs",
  "eligibleAt",
  "seriesId",
  "matchPolicy",
  "recurrence",
]);
const systemClock: Clock = {
  now: () => Date.now(),
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
function errorFact(error: unknown, code: string): ErrorFact {
  return {
    code: error instanceof TaskError ? error.code : code,
    message: error instanceof Error ? error.message.slice(0, 512) : "Operation failed.",
  };
}

export class TaskEngine implements TaskService {
  private readonly owner = newId();
  private readonly clock: Clock;
  readonly limits: EngineLimits;
  private readonly types = new Map<string, CompiledType>();
  private readonly supervisors = new Map<string, TypeSupervisor>();
  private readonly releases = new Map<string, { resolve(): void; reject(error: unknown): void }>();
  private readonly withdrawals = new Set<string>();
  private readonly physicalReleases = new Set<string>();
  private readonly currentVersions: Readonly<Record<string, string>>;
  private readonly discovery: readonly TaskTypeDiscovery[];
  private readonly allocationLimits = new Map<string, number>();
  private view: StoreView;
  private started = false;
  private closing = false;
  private ticking = false;
  private timer: (() => void) | undefined;
  private groups = new Set<Group>();
  private tracking = new Map<string, RunTracking>();
  private wallTimers = new Map<string, () => void>();
  private wallExpired = new Set<string>();
  private reclaiming = new Set<string>();
  private subscriptions = new Set<Subscription>();
  private allocations = new Set<Promise<void>>();
  private closeAttempt: Promise<void> | undefined;
  private readonly catalog: TaskCatalog;
  private readonly executionCatalog: RunCatalog;
  readonly errors: ErrorFact[] = [];

  constructor(private readonly options: EngineOptions) {
    this.clock = options.clock ?? systemClock;
    this.limits = { ...defaults, ...options.limits };
    for (const [key, value] of Object.entries(this.limits)) positive(value, key);
    this.catalog = new TaskCatalog(this.limits);
    this.executionCatalog = new RunCatalog(this.limits);
    if (this.limits.maxEvents < 32) fail("invalid_request", "maxEvents must be at least 32.");
    for (const type of options.types) {
      if (!type.type || !type.version || !type.environment)
        fail("invalid_type", "Type binding is incomplete.");
      if (
        !type.module ||
        !Object.hasOwn(type, "resultSchema") ||
        !Object.hasOwn(type, "messageSchema")
      )
        fail("invalid_type", "需要静态类型 Worker 注册及必选结果、消息契约。");
      const key = `${type.type}\0${type.version}`;
      if (this.types.has(key)) fail("invalid_type", "Duplicate type version.");
      const contract = compileInputSchema(type.inputSchema, {
        maxInputBytes: this.limits.maxPayloadBytes,
      });
      const revision = createHash("sha256")
        .update(
          canonical({
            type: type.type,
            version: type.version,
            schema: contract.revision,
            resultSchema: type.resultSchema,
            messageSchema: type.messageSchema,
          }),
        )
        .digest("hex");
      this.types.set(
        key,
        Object.freeze({
          ...type,
          ...contract,
          revision,
          resultContract: compileJsonSchema(type.resultSchema, {
            maxInputBytes: this.limits.maxPayloadBytes,
          }),
        }),
      );
      this.supervisors.set(
        key,
        new TypeSupervisor(
          {
            ...type,
            resources: {
              ...type.resources,
              identity: async (_value, context) => {
                const run = this.view.facts.runs[context.runId];
                if (!run) fail("not_found", "Run 不存在。");
                return { runId: run.runId, startedAt: run.startedAt, generation: run.generation };
              },
              replacement: async (_value, context) => {
                const current = this.view.facts.runs[context.runId];
                const candidate = Object.values(this.view.facts.runs).find(
                  (run) =>
                    run.runId !== context.runId &&
                    !run.sealed &&
                    !run.completedAt &&
                    !run.failedAt &&
                    !run.cleanupUnknown &&
                    run.binding.type === current?.binding.type &&
                    run.binding.version === current?.binding.version &&
                    run.binding.environment === current?.binding.environment &&
                    this.tracking.has(run.runId) &&
                    !this.protectedOwners(run.runId),
                );
                return candidate
                  ? { runId: candidate.runId, generation: candidate.generation }
                  : null;
              },
              "authorize-replacement": async (value, context) => {
                const request = object(value);
                const current = this.view.facts.runs[context.runId];
                const run =
                  typeof request.runId === "string"
                    ? this.view.facts.runs[request.runId]
                    : undefined;
                if (
                  !run ||
                  !current ||
                  request.generation !== run.generation ||
                  run.sealed ||
                  run.completedAt ||
                  run.failedAt ||
                  run.cleanupUnknown ||
                  this.protectedOwners(run.runId) ||
                  run.binding.type !== current.binding.type ||
                  run.binding.version !== current.binding.version ||
                  run.binding.environment !== current.binding.environment
                )
                  return false;
                const taskIds = Object.values(this.view.facts.tasks)
                  .filter((task) => this.demand(task, run))
                  .map((task) => task.snapshot.taskId);
                this.commit([this.executionEvent("run.sealed", run, { taskIds })]);
                return true;
              },
            },
          },
          {
            dispatch: async (id, generation) => {
              const run = this.view.facts.runs[id];
              if (!run || run.completedAt || run.failedAt)
                fail("run_finished", "Run 已终结，不能投递新入口。");
              this.commit([
                this.executionEvent("run.dispatched", run, { workerGeneration: generation }),
              ]);
            },
            progress: async (id, value) =>
              this.report(this.view.facts.runs[id]!, "progress", value),
            checkpoint: async (id, value) =>
              this.evidence(this.view.facts.runs[id]!, "checkpoint", value),
            complete: async (id, value) =>
              this.report(this.view.facts.runs[id]!, "complete", value),
            failed: async (id, error, result) =>
              this.reportFailure(this.view.facts.runs[id]!, error, result),
            confirm: async (id, taskId, messageId, state, reason) =>
              this.confirmMessage(id, taskId, messageId, state, reason),
            released: (id) => {
              this.physicalReleases.add(id);
              this.confirmRelease(id);
            },
            lost: (ids, error) => {
              for (const id of ids) {
                const run = this.view.facts.runs[id];
                if (run) {
                  this.reportFailure(run, error);
                  this.cleanupUnknown(id, error.message);
                }
                this.releases.get(id)?.reject(new TaskError("reclamation_unknown", error.message));
              }
            },
          },
          {
            heartbeatMs: 100,
            healthMs: 5000,
            maxInFlight: 64,
            maxPayloadBytes: this.limits.maxPayloadBytes,
          },
        ),
      );
      const compiled = this.types.get(key)!;
      const moduleDigest = this.supervisors.get(key)!.registration.moduleDigest!;
      this.types.set(
        key,
        Object.freeze({
          ...compiled,
          moduleDigest,
          revision: createHash("sha256")
            .update(canonical({ contract: revision, moduleDigest }))
            .digest("hex"),
        }),
      );
      if (type.allocationLimit !== undefined) {
        const capacity = positive(type.allocationLimit, "allocationLimit");
        const previous = this.allocationLimits.get(type.type);
        if (previous !== undefined && previous !== capacity)
          fail("invalid_type", "Type versions must share one allocation capacity.");
        this.allocationLimits.set(type.type, capacity);
      }
    }
    for (const [key, value] of Object.entries(options.allocationLimits ?? {}))
      this.allocationLimits.set(key, positive(value, `allocationLimits.${key}`));
    this.currentVersions = Object.freeze({ ...options.currentVersions });
    this.discovery = freeze(
      Object.entries(this.currentVersions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, version]) => {
          const type = this.type({ type: name, version });
          return { type: name, version, inputSchema: type.inputSchema, revision: type.revision };
        }),
    );
    this.view = restoreTaskUpdates(options.store.read());
    assertFactsVersion(this.view.facts);
  }
  private diagnostic(error: unknown, code = "engine_failure"): void {
    const fact = errorFact(error, code);
    this.errors.push(fact);
    if (this.errors.length > 100) this.errors.shift();
    this.options.onError?.(fact);
  }
  private type(
    binding: Pick<Binding, "type" | "version"> & Partial<Pick<Binding, "contractRevision">>,
  ): CompiledType {
    const type = this.types.get(`${binding.type}\0${binding.version}`);
    if (!type)
      fail("unsupported_version", `Missing original contract ${binding.type}@${binding.version}.`);
    if ("contractRevision" in binding && binding.contractRevision !== type.revision)
      fail("unsupported_contract", "Original input contract is unavailable.");
    return type;
  }
  private historicalType(binding: Binding): CompiledType {
    if (!binding.contractRevision)
      fail("unsupported_contract", "Historical record has no input contract identity.");
    const type = this.type(binding);
    if (type.environment !== binding.environment)
      fail("unsupported_environment", "原 Run 的可信环境不可用。");
    return type;
  }
  private checkHistory(task: TaskRecord): void {
    const type = this.historicalType(task.binding);
    this.validated(task.input, type.validate.bind(type));
    const id = task.snapshot.run?.runId;
    const run = id ? this.view.facts.runs[id] : undefined;
    if (run) {
      if (
        ["type", "version", "contractRevision", "environment", "scope"].some(
          (key) => run.binding[key as keyof Binding] !== task.binding[key as keyof Binding],
        )
      )
        fail("unsupported_contract", "Associated run binding differs from the original Task.");
      this.checkExecutionHistory(run);
    }
  }
  private checkExecutionHistory(run: RunRecord): void {
    const type = this.historicalType(run.binding);
    this.validated(run.input, type.validate.bind(type));
    if (run.result !== undefined) this.validateResult(type, run.result);
  }
  private validateResult(type: CompiledType, value: unknown): Json {
    return type.resultContract.validate(value);
  }
  private validated(value: unknown, validator: (value: unknown) => unknown): Json {
    const input = freeze(json(value, this.limits.maxPayloadBytes));
    const output = json(validator(input), this.limits.maxPayloadBytes);
    if (canonical(input) !== canonical(output))
      fail("invalid_type", "Validator must not coerce input.");
    return output;
  }
  private assertRunning(): void {
    if (!this.started || this.closing) fail("engine_closed", "Engine is not accepting commands.");
  }
  private authorized(caller: Caller, operation: Operation, scope: string): void {
    if (
      !caller ||
      typeof caller.scope !== "string" ||
      typeof caller.subject !== "string" ||
      !caller.scope ||
      !caller.subject
    )
      fail("unauthenticated", "Trusted caller is required.");
    const grant = this.options.authorize(caller, operation, scope);
    if (typeof grant !== "boolean") {
      void Promise.resolve(grant).catch(() => {});
      fail("invalid_type", "服务授权必须同步返回 boolean。");
    }
    if (caller.scope !== scope || !grant) fail("forbidden", "Access denied.");
  }
  private event<K extends NewEvent["type"]>(
    type: K,
    task: TaskRecord,
    data: Extract<NewEvent, { type: K }>["data"],
    occurredAt = at(this.clock.now()),
  ): NewEvent {
    return {
      type,
      scope: task.binding.scope,
      taskId: task.snapshot.taskId,
      occurredAt,
      data,
    } as NewEvent;
  }
  private commit(events: NewEvent[]): void {
    if (!events.length) return;
    try {
      this.view = restoreTaskUpdates(
        this.options.store.append(this.owner, this.view.facts.watermark, events),
      );
    } catch (error) {
      this.view = restoreTaskUpdates(this.options.store.read());
      if (error instanceof TaskError) throw error;
      throw new TaskError(
        "storage_failure",
        error instanceof Error ? error.message : "Store commit failed.",
      );
    }
  }
  private executionEvent<K extends NewEvent["type"]>(
    type: K,
    run: RunRecord,
    data: Extract<NewEvent, { type: K }>["data"],
  ): Extract<NewEvent, { type: K }> {
    return {
      type,
      scope: run.binding.scope,
      runId: run.runId,
      occurredAt: type === "run.started" ? run.startedAt : at(this.clock.now()),
      data,
    } as Extract<NewEvent, { type: K }>;
  }
  private admittedCapacity(extra = 1, extraEvents = 0): boolean {
    const tasks = Object.values(this.view.facts.tasks);
    const unfinished = tasks.filter((task) => !effectiveEnd(task.snapshot)).length;
    return (
      tasks.length + extra <= this.limits.maxTasks &&
      this.view.events.length +
        (unfinished + extra) * 16 +
        16 +
        Object.values(this.view.facts.messages).filter((message) => message.state === "queued")
          .length +
        extraEvents <
        this.limits.maxEvents
    );
  }
  private parse(request: unknown, caller: Caller, version?: string): TaskRecord {
    const raw = object(json(request, this.limits.maxPayloadBytes));
    if (Object.hasOwn(raw, "executionMatch"))
      fail("unsupported_version", "旧 Task 协议已拒绝；请使用 matchPolicy。");
    const requestId = ulid(raw.requestId);
    if (typeof raw.type !== "string") fail("invalid_request", "type is required.");
    const selected =
      version ??
      (Object.hasOwn(this.currentVersions, raw.type) ? this.currentVersions[raw.type] : undefined);
    if (!selected) fail("unknown_type", "Unregistered task type.");
    const type = this.type({ type: raw.type, version: selected });
    const input = Object.fromEntries(Object.entries(raw).filter(([key]) => !common.has(key)));
    const validated = this.validated(input, type.validate.bind(type));
    const timeoutMs = positive(raw.timeoutMs, "timeoutMs");
    const receivedAt = at(this.clock.now());
    const requestedEligibleAt =
      raw.eligibleAt === undefined ? receivedAt : timestamp(raw.eligibleAt);
    const eligibleAt = at(Math.max(Date.parse(receivedAt), Date.parse(requestedEligibleAt)));
    const deadlineAt = at(Date.parse(eligibleAt) + timeoutMs);
    const matchPolicy = raw.matchPolicy ?? "started-after-eligible";
    if (matchPolicy !== "started-after-eligible" && matchPolicy !== "terminated-after-eligible")
      fail("invalid_request", "Unsupported matchPolicy.");
    if (raw.recurrence !== undefined) {
      const recurrence = object(raw.recurrence);
      if (
        Object.keys(recurrence).sort().join(",") !== "anchor,periodMs" ||
        (recurrence.anchor !== "eligible" && recurrence.anchor !== "terminated")
      )
        fail("invalid_request", "recurrence requires explicit anchor and periodMs.");
      at(Date.parse(eligibleAt) + positive(recurrence.periodMs, "periodMs"));
    }
    const taskId = newId(this.clock.now());
    const seriesId = raw.seriesId === undefined ? taskId : ulid(raw.seriesId);
    this.authorized(caller, "submit", caller.scope);
    for (const previous of Object.values(this.view.facts.tasks)) {
      if (previous.snapshot.seriesId === seriesId && previous.binding.scope !== caller.scope)
        fail("forbidden", "Series belongs to another scope.");
    }
    const task: TaskRecord = {
      receivedSequence: this.view.facts.watermark + 1,
      request: raw as TaskRequest,
      input: validated,
      binding: {
        type: raw.type,
        version: selected,
        contractRevision: type.revision,
        environment: type.environment,
        scope: caller.scope,
        subject: caller.subject,
        matchPolicy,
      },
      snapshot: {
        requestId,
        taskId,
        seriesId,
        stage: "initial",
        receivedAt,
        eligibleAt,
        deadlineAt,
        timestamp: receivedAt,
      },
    };
    this.authorizeTask(task);
    return task;
  }
  discoverTypes(caller: Caller): readonly TaskTypeDiscovery[] {
    this.assertRunning();
    this.authorized(caller, "submit", caller?.scope);
    return this.discovery;
  }
  sendTaskMessage(
    taskId: string,
    messageId: string,
    payload: unknown,
    caller: Caller,
  ): TaskMessageRecord {
    this.assertRunning();
    const task = this.task(taskId, caller, "message");
    ulid(messageId);
    const type = this.historicalType(task.binding);
    const parsed = compileJsonSchema(type.messageSchema, {
      maxInputBytes: this.limits.maxPayloadBytes,
    }).validate(payload);
    const key = `${taskId}\0${messageId}`;
    const existing = this.view.facts.messages[key];
    if (existing) {
      if (
        canonical(existing.payload) !== canonical(parsed) ||
        existing.caller.scope !== caller.scope ||
        existing.caller.subject !== caller.subject
      )
        fail("idempotency_conflict", "消息身份不能改写载荷或调用者。");
      return structuredClone(existing);
    }
    if (task.snapshot.canceledAt || task.snapshot.termination || this.withdrawals.has(taskId))
      fail("task_finished", "Task 已取消、过期或终结。");
    if (!this.active(task))
      fail("task_finished", "需求的接纳期限已结束；迟到结果仍可匹配，但不能追加新业务消息。");
    const id = task.snapshot.run?.runId;
    const run = id ? this.view.facts.runs[id] : undefined;
    if (
      !run ||
      run.completedAt ||
      run.failedAt ||
      !this.tracking.has(run.runId) ||
      !this.supervisors.get(`${task.binding.type}\0${task.binding.version}`)?.canRoute(run.runId)
    )
      fail("no_run_route", "Task 没有已绑定且已投递的当前 Run；不会广播或伪造绑定。");
    if (
      Object.values(this.view.facts.messages).filter(
        (item) => item.runId === run.runId && item.state === "queued",
      ).length >= 64 ||
      !this.admittedCapacity(0, 2)
    )
      fail("capacity_exceeded", "Run 消息容量已满。");
    const message: TaskMessageRecord = {
      taskId,
      messageId,
      runId: run.runId,
      generation: run.generation,
      caller: { scope: caller.scope, subject: caller.subject },
      payload: parsed,
      receivedAt: at(this.clock.now()),
      state: "queued",
    };
    this.commit([{ ...this.event("message.received", task, { message }), runId: run.runId }]);
    try {
      this.supervisors
        .get(`${task.binding.type}\0${task.binding.version}`)!
        .message(run.runId, message);
    } catch (error) {
      this.commit(
        this.unknownMessages(run.runId, error instanceof Error ? error.message : "消息投递未知。"),
      );
    }
    return structuredClone(this.view.facts.messages[key]!);
  }
  getTaskMessage(taskId: string, messageId: string, caller: Caller): TaskMessageRecord {
    this.assertRunning();
    this.task(taskId, caller, "message");
    const message = this.view.facts.messages[`${taskId}\0${ulid(messageId)}`];
    if (!message) fail("not_found", "消息不存在。");
    return structuredClone(message);
  }
  private confirmMessage(
    runId: string,
    taskId: string,
    messageId: string,
    state: "accepted" | "rejected",
    reason?: string,
  ): void {
    const message = this.view.facts.messages[`${taskId}\0${messageId}`];
    const run = this.view.facts.runs[runId];
    if (
      !message ||
      !run ||
      message.runId !== runId ||
      run.completedAt ||
      run.failedAt ||
      message.generation !== run.generation ||
      message.state !== "queued"
    )
      fail("message_finished", "消息没有当前可接纳路由。");
    const task = this.view.facts.tasks[taskId]!;
    if (task.snapshot.canceledAt || task.snapshot.termination)
      fail("task_finished", "消息所属需求已经撤回。");
    if (!this.active(task) || this.withdrawals.has(taskId))
      fail("message_finished", "消息所属需求已超过接纳期限。");
    this.commit([
      {
        ...this.event("message.resolved", task, {
          messageId,
          state,
          ...(reason === undefined ? {} : { reason }),
        }),
        runId,
      },
    ]);
  }
  private unknownMessages(runId: string, reason: string): NewEvent[] {
    return Object.values(this.view.facts.messages)
      .filter((item) => item.runId === runId && item.state === "queued")
      .map(
        (message): NewEvent => ({
          ...this.event("message.resolved", this.view.facts.tasks[message.taskId]!, {
            messageId: message.messageId,
            state: "unknown",
            reason,
          }),
          runId,
        }),
      );
  }
  private cleanupUnknown(runId: string, reason: string): void {
    const run = this.view.facts.runs[runId];
    if (!run || run.reclaimedAt || run.cleanupUnknown) return;
    this.commit([
      this.executionEvent("run.cleanup.unknown", run, { reason }),
      ...this.unknownMessages(runId, reason),
    ]);
  }
  private confirmRelease(id: string): void {
    try {
      const run = this.view.facts.runs[id];
      if (!run) return;
      if (!run.completedAt && !run.failedAt)
        this.reportFailure(run, {
          code: "invalid_tracking",
          message: "类型确认清理，但没有最终事实。",
        });
      if (!this.view.facts.runs[id]?.reclaimedAt)
        this.commit([this.executionEvent("run.reclaimed", run, {})]);
      this.releases.get(id)?.resolve();
      this.physicalReleases.delete(id);
      this.wallTimers.get(id)?.();
      this.wallTimers.delete(id);
      this.wallExpired.delete(id);
      this.tracking.delete(id);
      this.releases.delete(id);
      for (const group of this.groups) if (group.runId === id) this.groups.delete(group);
    } catch (error) {
      this.diagnostic(error, "cleanup_commit_failed");
    }
  }
  private withdrawMessages(task: TaskRecord, reason: string): NewEvent[] {
    return Object.values(this.view.facts.messages)
      .filter((message) => message.taskId === task.snapshot.taskId && message.state === "queued")
      .map((message) => ({
        ...this.event("message.resolved", task, {
          messageId: message.messageId,
          state: "rejected",
          reason,
        }),
        runId: message.runId,
      }));
  }
  private notifyWithdrawal(task: TaskRecord, reason: string): void {
    if (this.withdrawals.has(task.snapshot.taskId)) return;
    this.withdrawals.add(task.snapshot.taskId);
    if (task.snapshot.run)
      this.supervisors
        .get(`${task.binding.type}\0${task.binding.version}`)
        ?.withdraw(task.snapshot.run.runId, task.snapshot.taskId, reason);
  }
  submit(request: unknown, caller: Caller, options: SubmitOptions = {}): TaskSnapshot {
    this.assertRunning();
    this.authorized(caller, "submit", caller?.scope);
    const raw = object(json(request, this.limits.maxPayloadBytes));
    ulid(raw.requestId);
    if (options.expectedRevision !== undefined) {
      const current = this.discovery.find((entry) => entry.type === raw.type);
      if (!current || current.revision !== options.expectedRevision)
        fail(
          "contract_revision_mismatch",
          "Current input contract differs from expected revision.",
        );
    }
    const existing = Object.values(this.view.facts.tasks).find(
      (task) => task.request.requestId === raw.requestId,
    );
    if (existing) {
      this.authorized(caller, "submit", existing.binding.scope);
      this.checkHistory(existing);
      if (canonical(existing.request) !== canonical(raw))
        fail("idempotency_conflict", "requestId intent changed.");
      return project(this.view.facts, existing.snapshot.taskId, this.clock.now());
    }
    const task = this.parse(raw, caller);
    if (!this.admittedCapacity())
      fail("capacity_exceeded", "Task/event retention capacity exhausted.");
    const events = [this.event("task.created", task, { task })];
    const pending = this.pendingInSeries(task.snapshot.seriesId, this.clock.now());
    if (pending && isPending(task.snapshot)) events.push(this.event("task.canceled", task, {}));
    this.commit(events);
    return project(this.view.facts, task.snapshot.taskId, this.clock.now());
  }
  private task(taskId: string, caller: Caller, operation: Operation): TaskRecord {
    this.authorized(caller, operation, caller?.scope);
    const task = this.view.facts.tasks[ulid(taskId)];
    if (!task) fail("not_found", "Task not found.");
    this.authorized(caller, operation, task.binding.scope);
    this.checkHistory(task);
    return task;
  }
  getTask(taskId: string, caller: Caller): TaskSnapshot {
    this.task(taskId, caller, "task");
    return project(this.view.facts, taskId, this.clock.now());
  }
  listTasks(query: TaskQuery, page: { cursor?: string; limit?: number }, caller: Caller): TaskPage {
    this.assertRunning();
    this.authorized(caller, "list", caller?.scope);
    return this.catalog.read(query, page, caller, this.view.facts, this.clock.now(), (task) => {
      this.authorized(caller, "list", task.binding.scope);
      this.checkHistory(task);
    });
  }
  listRuns(query: RunQuery, page: { cursor?: string; limit?: number }, caller: Caller): RunPage {
    this.assertRunning();
    this.authorized(caller, "list-runs", caller?.scope);
    return this.executionCatalog.read(
      query,
      page,
      caller,
      this.view.facts,
      this.clock.now(),
      (execution) => {
        this.authorized(caller, "list-runs", execution.binding.scope);
        this.checkExecutionHistory(execution);
      },
    );
  }
  getRequest(requestId: string, caller: Caller): TaskRequest {
    this.authorized(caller, "request", caller?.scope);
    ulid(requestId);
    const task = Object.values(this.view.facts.tasks).find(
      (item) => item.request.requestId === ulid(requestId),
    );
    if (!task) fail("not_found", "Request not found.");
    this.authorized(caller, "request", task.binding.scope);
    this.checkHistory(task);
    return structuredClone(task.request);
  }
  cancelTask(taskId: string, caller: Caller): TaskSnapshot {
    this.assertRunning();
    let task = this.task(taskId, caller, "cancel");
    this.settle(task);
    task = this.view.facts.tasks[taskId] ?? task;
    if (task.snapshot.canceledAt) return project(this.view.facts, taskId, this.clock.now());
    if (task.snapshot.termination) fail("task_finished", "Task already finished.");
    const releases = Object.values(this.view.facts.runs)
      .filter((run) => this.demand(task, run))
      .map((run) => run.runId);
    this.commit([
      this.event("task.canceled", task, { runIds: releases }),
      ...this.withdrawMessages(task, "Task 已取消，未接纳消息拒绝。"),
    ]);
    this.notifyWithdrawal(task, "Task 已取消。");
    this.reconcileGroups();
    this.reclaimUnowned();
    return project(this.view.facts, taskId, this.clock.now());
  }
  /** Physical ownership barrier for trusted in-process composition, not cancellation. */
  async waitForTaskRelease(taskId: string, caller: Caller): Promise<void> {
    this.task(taskId, caller, "task");
    for (;;) {
      const task = this.view.facts.tasks[taskId];
      if (!task) return;
      if (task.snapshot.canceledAt) {
        const ids = task.releaseRunIds ?? [];
        for (const id of ids) {
          if (this.hasUncanceledOwners(id)) continue;
          const tracking = this.tracking.get(id);
          if (tracking) await tracking.finished;
          else if (
            !this.view.facts.runs[id]?.reclaimedAt &&
            [...this.groups].some((group) => group.runId === id)
          ) {
            await new Promise<void>((resolve) => setTimeout(resolve, 5));
            return this.waitForTaskRelease(taskId, caller);
          } else if (!this.view.facts.runs[id]?.reclaimedAt)
            fail("reclamation_unconfirmed", "Execution has no confirmed physical tracking.");
        }
        if (true && ![...this.groups].some((group) => !group.runId && group.owners.has(taskId)))
          return;
      }
      const id =
        task.snapshot.run?.runId ??
        Object.values(this.view.facts.runs).find((run) => this.demand(task, run))?.runId;
      if (id) {
        const shared = Object.values(this.view.facts.tasks).some(
          (other) =>
            other.snapshot.taskId !== taskId && this.demand(other, this.view.facts.runs[id]!),
        );
        if (task.snapshot.canceledAt && shared) return;
        const tracking = this.tracking.get(id);
        if (tracking) {
          await tracking.finished;
          return;
        }
        if (this.view.facts.runs[id]?.reclaimedAt) return;
        if (![...this.groups].some((group) => group.runId === id))
          fail("reclamation_unconfirmed", "Execution has no confirmed physical tracking.");
      } else if (true && ![...this.groups].some((group) => group.owners.has(taskId))) {
        if (task.snapshot.canceledAt || task.snapshot.termination || this.closing) return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }
  async start(): Promise<void> {
    if (this.started || this.closing) fail("engine_started", "Engine already started.");
    this.options.store.claim(this.owner);
    try {
      this.view = restoreTaskUpdates(this.options.store.read());
      assertFactsVersion(this.view.facts);
      for (const task of Object.values(this.view.facts.tasks)) this.checkHistory(task);
      for (const run of Object.values(this.view.facts.runs)) this.checkExecutionHistory(run);
      for (const run of Object.values(this.view.facts.runs))
        if (run.result !== undefined)
          await this.supervisors
            .get(`${run.binding.type}\0${run.binding.version}`)!
            .verify(run.result);
      for (const run of Object.values(this.view.facts.runs))
        for (const evidence of run.evidence ?? [])
          await this.supervisors
            .get(`${run.binding.type}\0${run.binding.version}`)!
            .verify(evidence.value, evidence.kind === "checkpoint" ? "checkpoint" : "historical");
      for (const run of Object.values(this.view.facts.runs)) {
        if (!run.completedAt && !run.failedAt) {
          this.finishExecution(
            run,
            this.executionEvent("run.failed", run, {
              error: {
                code: "execution_interrupted",
                message: "No reliable final fact survived restart; work is not rerun.",
              },
            }),
          );
          this.cleanupUnknown(run.runId, "恢复缺少物理回收证明，不重跑原 Run。");
        }
      }
      this.started = true;
      for (const task of Object.values(this.view.facts.tasks)) this.settle(task);
      this.schedule();
    } catch (error) {
      this.started = false;
      this.options.store.release(this.owner);
      await Promise.allSettled(
        [...this.supervisors.values()].map((supervisor) => supervisor.close()),
      );
      throw error;
    }
  }
  private schedule(): void {
    if (!this.started || this.closing) return;
    this.timer = this.clock.schedule(() => {
      try {
        this.tick();
      } catch (error) {
        this.diagnostic(error);
      }
      this.schedule();
    }, this.limits.tickMs);
  }
  /** Deterministic coordinator turn; hosts normally rely on start's bounded timer. */
  tick(): void {
    this.assertRunning();
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.clock.now();
      for (const id of this.physicalReleases) this.confirmRelease(id);
      for (const original of Object.values(this.view.facts.tasks)) {
        try {
          this.settle(original);
          let task = this.view.facts.tasks[original.snapshot.taskId];
          if (!task || task.snapshot.canceledAt) continue;
          this.plan(task, now);
          task = this.view.facts.tasks[original.snapshot.taskId];
          if (!task || effectiveEnd(task.snapshot)) continue;
          if (now < Date.parse(task.snapshot.eligibleAt)) continue;
          if (now > Date.parse(task.snapshot.deadlineAt)) {
            if (!this.withdrawals.has(task.snapshot.taskId)) {
              this.commit(this.withdrawMessages(task, "Task 接纳期限已结束。"));
              this.notifyWithdrawal(task, "Task 接纳期限已结束；迟到结果仍可接收。");
            }
            continue;
          }
          if (task.snapshot.run) continue;
          this.allocate(task);
        } catch (error) {
          this.diagnostic(error);
        }
      }
      this.reconcileGroups();
      this.reclaimUnowned();
    } finally {
      this.ticking = false;
    }
  }
  private active(task: TaskRecord, now = this.clock.now()): boolean {
    return (
      !effectiveEnd(task.snapshot) &&
      now >= Date.parse(task.snapshot.eligibleAt) &&
      now <= Date.parse(task.snapshot.deadlineAt)
    );
  }
  private compatible(task: TaskRecord, candidate: Pick<TaskRecord, "binding" | "input">): boolean {
    if (
      task.binding.type !== candidate.binding.type ||
      task.binding.version !== candidate.binding.version ||
      task.binding.contractRevision !== candidate.binding.contractRevision ||
      task.binding.environment !== candidate.binding.environment ||
      task.binding.scope !== candidate.binding.scope
    )
      return false;
    return this.historicalType(task.binding).equals(
      freeze(structuredClone(task.input)) as never,
      freeze(structuredClone(candidate.input)),
    );
  }
  private authorizeTask(task: TaskRecord, _run?: RunRecord): void {
    this.authorized(task.binding, "submit", task.binding.scope);
  }
  private demand(task: TaskRecord, run: RunRecord): boolean {
    if (task.snapshot.canceledAt || task.snapshot.termination) return false;
    if (task.snapshot.run) return task.snapshot.run.runId === run.runId;
    if (run.completedAt || run.failedAt) return false;
    if (
      task.binding.matchPolicy !== "terminated-after-eligible" ||
      (run.sealed && !run.sealedTaskIds?.includes(task.snapshot.taskId))
    )
      return false;
    try {
      if (!this.compatible(task, run)) return false;
      this.authorizeTask(task, run);
      return true;
    } catch (error) {
      this.diagnostic(error);
      return false;
    }
  }
  private bindings(run: RunRecord, policy: Binding["matchPolicy"], time: string): NewEvent[] {
    const events: NewEvent[] = [];
    for (const task of Object.values(this.view.facts.tasks)) {
      if (
        task.snapshot.canceledAt ||
        task.snapshot.termination ||
        task.snapshot.run ||
        task.binding.matchPolicy !== policy ||
        (run.sealed && !run.sealedTaskIds?.includes(task.snapshot.taskId)) ||
        !matchesRunTime(policy, task.snapshot.eligibleAt, run)
      )
        continue;
      try {
        if (!this.compatible(task, run)) continue;
        this.authorizeTask(task, run);
        events.push(this.event("task.run.bound", task, { runId: run.runId }, time));
      } catch (error) {
        this.diagnostic(error);
      }
    }
    return events;
  }
  private withdrawBoundWork(): void {
    this.reconcileGroups();
  }
  private finishExecution(
    run: RunRecord,
    event: Extract<NewEvent, { type: "run.completed" | "run.failed" }>,
  ): void {
    const final: RunRecord = {
      ...run,
      ...(event.type === "run.completed"
        ? { completedAt: event.occurredAt, result: event.data.result }
        : { failedAt: event.occurredAt }),
    };
    const bindings = this.bindings(final, "terminated-after-eligible", event.occurredAt);
    const ids = new Set(bindings.map((binding) => binding.taskId));
    const events: NewEvent[] = [
      event,
      ...this.unknownMessages(run.runId, "Run 终结前缺少业务接纳确认，副作用未知。"),
      ...bindings,
    ];
    for (const task of Object.values(this.view.facts.tasks))
      if (
        !task.snapshot.canceledAt &&
        !task.snapshot.termination &&
        (task.snapshot.run?.runId === run.runId || ids.has(task.snapshot.taskId))
      )
        events.push(this.event("task.terminated", task, { runId: run.runId }, event.occurredAt));
    this.commit(events);
    this.withdrawBoundWork();
  }
  private settle(task: TaskRecord): void {
    if (task.snapshot.canceledAt || task.snapshot.termination) return;
    const boundId = task.snapshot.run?.runId;
    const run = boundId ? this.view.facts.runs[boundId] : undefined;
    if (!run || (!run.completedAt && !run.failedAt)) return;
    this.commit([
      this.event("task.terminated", task, { runId: run.runId }, run.completedAt ?? run.failedAt),
    ]);
  }
  private allocate(task: TaskRecord): void {
    if (task.snapshot.run || !this.active(task)) return;
    if (
      Object.values(this.view.facts.runs).some(
        (run) => !run.failedAt && !run.completedAt && this.demand(task, run),
      )
    )
      return;
    const isolated = this.allocationLimits.has(task.binding.type);
    const count = [...this.groups].filter((group) =>
      isolated
        ? group.exemplar.binding.type === task.binding.type
        : !this.allocationLimits.has(group.exemplar.binding.type),
    ).length;
    if (
      count >=
      (isolated ? this.allocationLimits.get(task.binding.type)! : this.limits.maxConcurrent)
    )
      return;
    const group: Group = {
      exemplar: task,
      owners: new Set([task.snapshot.taskId]),
      controller: new AbortController(),
    };
    this.groups.add(group);
    let permit: StartPermit;
    try {
      permit = this.startGroup(group);
    } catch (error) {
      this.groups.delete(group);
      throw error;
    }
    const supervisor = this.supervisors.get(`${task.binding.type}\0${task.binding.version}`)!;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const finished = new Promise<void>((a, b) => {
      resolve = a;
      reject = b;
    });
    void finished.catch(() => {});
    this.releases.set(permit.runId, { resolve, reject });
    const tracking: RunTracking = {
      runId: permit.runId,
      generation: permit.generation,
      startedAt: permit.startedAt,
      finished,
      reclaim: async () => {
        supervisor.cancel(permit.runId);
        await finished;
      },
    };
    this.tracking.set(permit.runId, tracking);
    const allocation = supervisor
      .run(permit.runId, task.input, task.binding.scope)
      .then(() => {
        for (const owner of Object.values(this.view.facts.tasks))
          if (
            owner.snapshot.run?.runId === permit.runId &&
            (owner.snapshot.canceledAt || !this.active(owner))
          )
            supervisor.withdraw(permit.runId, owner.snapshot.taskId, "需求已取消或超过接纳期限。");
        if (
          this.closing ||
          this.wallExpired.has(permit.runId) ||
          !this.hasUncanceledOwners(permit.runId)
        )
          supervisor.cancel(permit.runId);
      })
      .catch((error) => {
        const current = this.view.facts.runs[permit.runId]!;
        if (
          !current.workerGeneration &&
          error instanceof TaskError &&
          error.code === "run_finished"
        ) {
          this.physicalReleases.add(permit.runId);
          this.confirmRelease(permit.runId);
          return;
        }
        this.reportFailure(
          this.view.facts.runs[permit.runId]!,
          errorFact(error, "type_unavailable"),
        );
        this.cleanupUnknown(permit.runId, "类型入口投递或模块初始化失联，副作用未知。");
        reject(new TaskError("reclamation_unknown", "完整入口投递失联。"));
      });
    this.allocations.add(allocation);
    void allocation
      .finally(() => this.allocations.delete(allocation))
      .catch((error) => this.diagnostic(error));
    void finished
      .then(
        () => {
          const run = this.view.facts.runs[permit.runId];
          if (run && !run.completedAt && !run.failedAt)
            this.reportFailure(run, {
              code: "invalid_tracking",
              message: "清理结束但缺少最终事实。",
            });
          const final = this.view.facts.runs[permit.runId];
          if (final && !final.reclaimedAt)
            this.commit([this.executionEvent("run.reclaimed", final, {})]);
          this.wallTimers.get(permit.runId)?.();
          this.wallTimers.delete(permit.runId);
          this.wallExpired.delete(permit.runId);
          this.tracking.delete(permit.runId);
          this.releases.delete(permit.runId);
          this.groups.delete(group);
        },
        (error) => {
          this.diagnostic(error, "reclamation_unknown");
          this.wallTimers.get(permit.runId)?.();
          this.wallTimers.delete(permit.runId);
          this.groups.delete(group);
        },
      )
      .catch((error) => this.diagnostic(error));
  }
  private startGroup(group: Group): StartPermit {
    this.assertRunning();
    if (group.runId || group.controller.signal.aborted)
      fail("allocation_canceled", "Start was withdrawn.");
    const now = this.clock.now();
    const owners = [...group.owners]
      .map((id) => this.view.facts.tasks[id])
      .filter(
        (task): task is TaskRecord =>
          task !== undefined && !task.snapshot.run && this.active(task, now),
      );
    if (!owners.length) fail("allocation_canceled", "No eligible, unexpired startup owner.");
    const run: RunRecord = {
      runId: newId(now),
      generation: newId(now),
      binding: group.exemplar.binding,
      input: group.exemplar.input,

      startedAt: at(now),
      startedSequence: this.view.facts.watermark + 1,
    };
    if (
      !owners.some((task) => {
        try {
          if (!this.compatible(task, run)) return false;
          this.authorizeTask(task, run);
          return true;
        } catch (error) {
          this.diagnostic(error);
          return false;
        }
      })
    )
      fail("allocation_canceled", "No authorized startup owner.");
    const events = [
      this.executionEvent("run.started", run, { run }),
      ...this.bindings(run, "started-after-eligible", run.startedAt),
    ];
    try {
      this.commit(events);
    } catch (error) {
      if (this.view.facts.runs[run.runId]) {
        group.runId = run.runId;
        this.withdrawBoundWork();
        this.reportFailure(run, {
          code: "execution_interrupted",
          message: "Durable startup committed but delivery failed.",
        });
      }
      throw error;
    }
    group.runId = run.runId;
    this.wallTimers.set(
      run.runId,
      this.clock.schedule(() => {
        this.wallExpired.add(run.runId);
        this.reclaim(run.runId, "execution_wall_limit");
      }, this.limits.executionWallMs),
    );
    return {
      runId: run.runId,
      generation: run.generation,
      startedAt: run.startedAt,
      progress: (value) => this.report(run, "progress", value),
      complete: (value) => this.report(run, "complete", value),
      fail: (error) => this.reportFailure(run, error),
    };
  }
  private report(run: RunRecord, kind: "progress" | "complete", value: unknown): void {
    const current = this.view.facts.runs[run.runId];
    if (kind === "complete" && current?.failedAt && !current.reclaimedAt) {
      this.evidence(current, "late-completed", json(value, this.limits.maxPayloadBytes));
      return;
    }
    if (
      !this.started ||
      !current ||
      current.generation !== run.generation ||
      current.completedAt ||
      current.failedAt
    )
      fail("run_finished", "Run 已终结、代际已失效或通道已关闭。");
    const type = this.historicalType(current.binding);
    let payload: Json;
    try {
      payload =
        kind === "complete"
          ? this.validateResult(type, value)
          : validateRunProgress(value, this.limits.maxPayloadBytes);
    } catch (error) {
      try {
        this.reportFailure(current, errorFact(error, "invalid_payload"));
      } catch (failure) {
        this.diagnostic(failure, "storage_failure");
      }
      throw error;
    }
    try {
      if (kind === "progress") {
        const unfinished = Object.values(this.view.facts.tasks).filter(
          (task) => !effectiveEnd(task.snapshot),
        ).length;
        if (
          this.view.events.length +
            unfinished * 16 +
            16 +
            Object.values(this.view.facts.messages).filter((message) => message.state === "queued")
              .length >=
          this.limits.maxEvents
        )
          fail("capacity_exceeded", "Progress retention capacity exhausted.");
        this.commit([this.executionEvent("run.progress", current, { progress: payload })]);
      } else
        this.finishExecution(
          current,
          this.executionEvent("run.completed", current, { result: payload }),
        );
    } catch (error) {
      try {
        this.reportFailure(current, errorFact(error, "invalid_payload"));
      } catch (failure) {
        this.diagnostic(failure, "storage_failure");
      }
      throw error;
    }
  }
  private evidence(
    run: RunRecord,
    kind: "checkpoint" | "late-completed" | "late-failed",
    value: Json,
  ): void {
    if (
      !this.started ||
      run.reclaimedAt ||
      (kind === "checkpoint" && (run.completedAt || run.failedAt))
    )
      fail("run_finished", "Run 不再接纳该类证据。");
    if ((run.evidence?.length ?? 0) >= 1024 || !this.admittedCapacity(0, 1))
      fail("capacity_exceeded", "Run 证据容量已满。");
    this.commit([
      this.executionEvent("run.evidence", run, {
        kind,
        value: this.validateResult(this.historicalType(run.binding), value),
      }),
    ]);
  }
  private reportFailure(run: RunRecord, error: ErrorFact, result?: Json): void {
    const current = this.view.facts.runs[run.runId];
    if (current?.failedAt && result !== undefined && !current.reclaimedAt) {
      this.evidence(current, "late-failed", result);
      return;
    }
    if (!this.started || !current || current.completedAt || current.failedAt) return;
    const parsed = object(error);
    if (typeof parsed.code !== "string" || typeof parsed.message !== "string")
      fail("invalid_payload", "Invalid error fact.");
    this.finishExecution(
      current,
      this.executionEvent("run.failed", current, {
        error: { code: parsed.code.slice(0, 128), message: parsed.message.slice(0, 512) },
        ...(result === undefined
          ? {}
          : { result: this.validateResult(this.historicalType(current.binding), result) }),
      }),
    );
  }
  private protectedOwners(id: string): boolean {
    const run = this.view.facts.runs[id];
    return (
      run !== undefined &&
      Object.values(this.view.facts.tasks).some(
        (task) => this.active(task) && this.demand(task, run),
      )
    );
  }
  private hasUncanceledOwners(id: string): boolean {
    const run = this.view.facts.runs[id];
    return (
      run !== undefined &&
      Object.values(this.view.facts.tasks).some((task) => this.demand(task, run))
    );
  }
  private reconcileGroups(): void {
    for (const group of this.groups) {
      if (group.runId) continue;
      for (const id of group.owners) {
        const task = this.view.facts.tasks[id];
        if (!task || task.snapshot.run || !this.active(task)) group.owners.delete(id);
      }
      if (!group.owners.size) group.controller.abort();
    }
  }
  private reclaimUnowned(): void {
    for (const id of this.tracking.keys())
      if (!this.hasUncanceledOwners(id)) this.reclaim(id, "owners_canceled");
  }
  private reclaim(id: string, reason: string): void {
    const tracking = this.tracking.get(id);
    if (!tracking || this.reclaiming.has(id)) return;
    this.reclaiming.add(id);
    const run = this.view.facts.runs[id];
    if (run && !run.completedAt && !run.failedAt)
      this.reportFailure(run, { code: reason, message: "Run 已逻辑终结，物理清理另行确认。" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([
      tracking.reclaim(reason),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            this.cleanupUnknown(id, "指定 Run 取消后没有取得清理确认。");
          } catch (error) {
            this.diagnostic(error, "cleanup_commit_failed");
          }
          this.releases
            .get(id)
            ?.reject(new TaskError("reclamation_unknown", "指定 Run 清理未确认。"));
          reject(new TaskError("reclamation_unknown", "指定 Run 清理未确认。"));
        }, 5000);
      }),
    ])
      .then(() => {
        const run = this.view.facts.runs[id];
        if (this.started && run) {
          if (!run.completedAt && !run.failedAt)
            this.reportFailure(run, {
              code: reason,
              message: "Execution physically reclaimed.",
            });
          if (!this.view.facts.runs[id]?.reclaimedAt)
            this.commit([this.executionEvent("run.reclaimed", run, {})]);
        }
      })
      .catch((error) => this.diagnostic(error, "reclamation_failed"))
      .finally(() => {
        if (timer) clearTimeout(timer);
        this.reclaiming.delete(id);
      });
  }
  private pendingInSeries(seriesId: string, now: number): TaskRecord | undefined {
    return Object.values(this.view.facts.tasks).find(
      (task) =>
        task.snapshot.seriesId === seriesId &&
        isPending(project(this.view.facts, task.snapshot.taskId, now)),
    );
  }
  private plan(task: TaskRecord, now: number): void {
    const recurrence = task.request.recurrence;
    if (!recurrence || task.successor || task.snapshot.canceledAt) return;
    const eligible = Date.parse(task.snapshot.eligibleAt);
    const deadline = Date.parse(task.snapshot.deadlineAt);
    const end = effectiveEnd(task.snapshot);
    if (recurrence.anchor === "eligible" ? now < eligible : !end && now <= deadline) return;
    if (!this.admittedCapacity()) return;
    const anchor =
      recurrence.anchor === "eligible"
        ? eligible
        : Math.min(end ? Date.parse(end) : deadline, deadline);
    const next = at(
      anchor + (Math.floor((now - anchor) / recurrence.periodMs) + 1) * recurrence.periodMs,
    );
    const raw: TaskRequest = {
      ...structuredClone(task.request),
      requestId: newId(now),
      eligibleAt: next,
      seriesId: task.snapshot.seriesId,
    };
    const successor = this.parse(
      raw,
      { scope: task.binding.scope, subject: task.binding.subject },
      task.binding.version,
    );
    const events = [
      this.event("task.created", successor, { task: successor }),
      this.event("task.successor", task, {
        requestId: successor.request.requestId,
        taskId: successor.snapshot.taskId,
      }),
    ];
    if (this.pendingInSeries(task.snapshot.seriesId, now))
      events.push(this.event("task.canceled", successor, {}));
    this.commit(events);
  }
  private filter(
    filter: HistoryFilter,
    caller: Caller,
    operation: "history" | "subscribe",
  ): { tasks: TaskRecord[]; runs: Set<string>; key: string } {
    const raw = object(filter);
    if (Object.keys(raw).length !== 1)
      fail("invalid_request", "Exactly one history filter required.");
    let tasks: TaskRecord[];
    const runs = new Set<string>();
    if ("taskId" in raw) tasks = [this.task(ulid(raw.taskId), caller, operation)];
    else if ("seriesId" in raw) {
      ulid(raw.seriesId);
      tasks = Object.values(this.view.facts.tasks).filter(
        (task) => task.snapshot.seriesId === raw.seriesId,
      );
    } else if ("runId" in raw) {
      const id = ulid(raw.runId);
      const run = this.view.facts.runs[id];
      if (!run) fail("not_found", "Execution not found.");
      this.authorized(caller, operation, run.binding.scope);
      const type = this.historicalType(run.binding);
      this.validated(run.input, type.validate.bind(type));
      if (run.result !== undefined) this.validateResult(type, run.result);
      runs.add(id);
      tasks = [];
    } else fail("invalid_request", "Unknown history filter.");
    if (!tasks.length && !runs.size) fail("not_found", "History target not found.");
    for (const task of tasks) {
      this.authorized(caller, operation, task.binding.scope);
      this.checkHistory(task);
      if (task.snapshot.run) runs.add(task.snapshot.run.runId);
    }
    return { tasks, runs, key: canonical(raw) };
  }
  private encode(cursor: Cursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString("base64url");
  }
  private decode(token: string, key: string): Cursor {
    if (typeof token !== "string" || token.length > 4096)
      fail("invalid_cursor", "Cursor exceeds bounded token size.");
    let cursor: Cursor;
    try {
      cursor = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Cursor;
    } catch {
      fail("invalid_cursor", "Malformed cursor.");
    }
    if (
      !cursor ||
      cursor.storeId !== this.view.storeId ||
      cursor.filter !== key ||
      !Number.isSafeInteger(cursor.position) ||
      !Number.isSafeInteger(cursor.watermark) ||
      cursor.position < 0 ||
      cursor.position > cursor.watermark ||
      cursor.watermark > this.view.facts.watermark ||
      !["page", "stream"].includes(cursor.mode)
    )
      fail("invalid_cursor", "Cursor does not match store/filter/boundary.");
    if (cursor.position < this.view.floor) fail("history_expired", "History cursor expired.");
    return cursor;
  }
  private publicEvent(event: FactEvent): PublicEvent {
    if (event.runId) {
      const run = this.view.facts.runs[event.runId];
      if (run) {
        const type = this.historicalType(run.binding);
        if (event.type === "run.progress")
          validateRunProgress(event.data.progress, this.limits.maxPayloadBytes);
        if (event.type === "run.completed") this.validateResult(type, event.data.result);
      }
    }
    if (event.type === "run.started") {
      const run = event.data.run;
      return { ...event, data: JSON.parse(JSON.stringify({ run })) as Json };
    }
    return structuredClone(event) as unknown as PublicEvent;
  }
  private selectedEvents(
    filter: ReturnType<TaskEngine["filter"]>,
    after: number,
    through: number,
  ): FactEvent[] {
    const ids = new Set(filter.tasks.map((task) => task.snapshot.taskId));
    const runs = ids.size
      ? new Set(
          this.view.events
            .filter(
              (event) =>
                event.sequence <= through &&
                event.taskId !== undefined &&
                ids.has(event.taskId) &&
                event.type === "task.run.bound",
            )
            .map((event) => (event.type === "task.run.bound" ? event.data.runId : "")),
        )
      : filter.runs;
    return this.view.events.filter(
      (event) =>
        event.sequence > after &&
        event.sequence <= through &&
        ((event.taskId !== undefined && ids.has(event.taskId)) ||
          (event.runId !== undefined && runs.has(event.runId))),
    );
  }
  readHistory(
    filter: HistoryFilter,
    page: { cursor?: string; limit?: number },
    caller: Caller,
  ): HistoryPage {
    this.authorized(caller, "history", caller?.scope);
    if (page.cursor) this.decode(page.cursor, canonical(object(filter)));
    const selected = this.filter(filter, caller, "history");
    const cursor = page.cursor
      ? this.decode(page.cursor, selected.key)
      : {
          storeId: this.view.storeId,
          filter: selected.key,
          watermark: this.view.facts.watermark,
          position: this.view.floor,
          mode: "page" as const,
        };
    if (cursor.mode !== "page") fail("invalid_cursor", "Expected page cursor.");
    const limit = Math.min(
      positive(page.limit ?? this.limits.pageSize, "limit"),
      this.limits.pageSize,
    );
    const candidates = this.selectedEvents(selected, cursor.position, cursor.watermark);
    const events = candidates.slice(0, limit);
    const position =
      candidates.length > limit ? (events.at(-1)?.sequence ?? cursor.position) : cursor.watermark;
    const next = this.encode({ ...cursor, position });
    return {
      events: events.map((event) => this.publicEvent(event)),
      watermark: cursor.watermark,
      cursor: this.encode({ ...cursor, position, mode: "stream" }),
      ...(candidates.length > limit ? { next } : {}),
    };
  }
  subscribe(filter: HistoryFilter, resume: string | undefined, caller: Caller): Subscription {
    this.assertRunning();
    this.authorized(caller, "subscribe", caller?.scope);
    if (resume) this.decode(resume, canonical(object(filter)));
    if (this.subscriptions.size >= this.limits.maxSubscriptions)
      fail("capacity_exceeded", "Subscription limit.");
    const selected = this.filter(filter, caller, "subscribe");
    const start = resume
      ? this.decode(resume, selected.key)
      : {
          storeId: this.view.storeId,
          filter: selected.key,
          watermark: this.view.facts.watermark,
          position: this.view.facts.watermark,
          mode: "stream" as const,
        };
    if (start.mode !== "stream") fail("invalid_cursor", "Expected stream cursor.");
    let position = start.position;
    let closed = false;
    const observe = (): Observation => {
      if (closed || !this.started || this.closing)
        fail("subscription_closed", "Subscription closed.");
      const current = this.filter(filter, caller, "subscribe");
      if (position < this.view.floor) fail("history_expired", "History cursor expired.");
      const watermark = this.view.facts.watermark;
      const candidates = this.selectedEvents(current, position, watermark);
      const events = candidates.slice(0, this.limits.pageSize);
      position =
        candidates.length > events.length ? (events.at(-1)?.sequence ?? position) : watermark;
      return {
        snapshots: current.tasks
          .slice(-this.limits.pageSize)
          .map((task) => project(this.view.facts, task.snapshot.taskId, this.clock.now())),
        events: events.map((event) => this.publicEvent(event)),
        watermark,
        cursor: this.encode({ ...start, position, watermark }),
      };
    };
    const subscription: Subscription = {
      initial: observe(),
      pull: observe,
      close: () => {
        closed = true;
        this.subscriptions.delete(subscription);
      },
    };
    this.subscriptions.add(subscription);
    return subscription;
  }
  /** Conservatively reclaim only entire inactive, expired reference graphs. */
  collect(): void {
    this.assertRunning();
    const now = this.clock.now();
    const tasks = Object.values(this.view.facts.tasks);
    if (!tasks.length || this.groups.size || this.tracking.size) return;
    if (
      tasks.some(
        (task) =>
          !effectiveEnd(task.snapshot) ||
          now - Date.parse(effectiveEnd(task.snapshot) ?? task.snapshot.receivedAt) <
            this.limits.retentionMs ||
          (task.request.recurrence && !task.successor && !task.snapshot.canceledAt),
      )
    )
      return;
    this.commit([
      {
        type: "records.forgotten",
        scope: "",
        occurredAt: at(now),
        data: {
          taskIds: tasks.map((task) => task.snapshot.taskId),
          runIds: Object.keys(this.view.facts.runs),
        },
      },
    ]);
    this.options.store.compact(this.owner, this.view.facts.watermark);
    this.view = this.options.store.read();
  }
  close(): Promise<void> {
    this.closeAttempt ??= this.closeInner();
    return this.closeAttempt;
  }
  private async closeInner(): Promise<void> {
    if (!this.started || this.closing) return;
    this.closing = true;
    this.catalog.clear();
    this.executionCatalog.clear();
    this.timer?.();
    for (const stopTimer of this.wallTimers.values()) stopTimer();
    this.wallTimers.clear();
    for (const subscription of this.subscriptions) subscription.close();
    for (const group of this.groups) if (!group.runId) group.controller.abort();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(this.allocations),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new TaskError("reclamation_failed", "Startup tracking delivery did not finish."),
              ),
            5_000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    const outcomes = await Promise.allSettled(
      [...this.tracking.values()].map(async (tracking) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            tracking.reclaim("engine_closed"),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new TaskError(
                      "reclamation_unknown",
                      "指定 Run 未确认物理清理，保留 Store 租约。",
                    ),
                  ),
                5000,
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        const run = this.view.facts.runs[tracking.runId];
        if (run && !run.reclaimedAt) this.commit([this.executionEvent("run.reclaimed", run, {})]);
      }),
    );
    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    if (failed?.status === "rejected") {
      this.diagnostic(failed.reason, "reclamation_failed");
      await Promise.allSettled(
        [...this.supervisors.values()].map((supervisor) => supervisor.retire()),
      );
      fail("reclamation_failed", "Engine retains store ownership because resource cleanup failed.");
    }
    this.started = false;
    await Promise.all([...this.supervisors.values()].map((supervisor) => supervisor.close()));
    this.options.store.release(this.owner);
  }
}

export function createTaskEngine(options: EngineOptions): TaskEngine {
  return new TaskEngine(options);
}
