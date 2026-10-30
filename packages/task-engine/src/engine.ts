import {
  type Authorize,
  at,
  type Binding,
  type Caller,
  type Clock,
  canonical,
  type ErrorFact,
  type ExecutionRecord,
  type ExecutionTracking,
  effectiveEnd,
  type FactEvent,
  fail,
  freeze,
  type HistoryFilter,
  type HistoryPage,
  isPending,
  type Json,
  json,
  matchesExecutionTime,
  type NewEvent,
  type Observation,
  type Operation,
  object,
  type PublicEvent,
  positive,
  project,
  type RegisteredType,
  type StartPermit,
  type Store,
  type StoreView,
  type Subscription,
  TaskError,
  type TaskRecord,
  type TaskRequest,
  type TaskService,
  type TaskSnapshot,
  timestamp,
  ulid,
} from "@potential-guide/task-protocol";
import { newId } from "./identity.js";

export interface EngineLimits {
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
  onError?: (error: ErrorFact) => void;
}
interface Group {
  exemplar: TaskRecord;
  owners: Set<string>;
  controller: AbortController;
  executionId?: string;
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
};
const common = new Set([
  "requestId",
  "type",
  "timeoutMs",
  "eligibleAt",
  "seriesId",
  "executionMatch",
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
  private readonly types = new Map<string, RegisteredType>();
  private view: StoreView;
  private started = false;
  private closing = false;
  private ticking = false;
  private timer: (() => void) | undefined;
  private preparations = new Map<string, AbortController>();
  private groups = new Set<Group>();
  private tracking = new Map<string, ExecutionTracking>();
  private wallTimers = new Map<string, () => void>();
  private wallExpired = new Set<string>();
  private reclaiming = new Set<string>();
  private subscriptions = new Set<Subscription>();
  private allocations = new Set<Promise<void>>();
  private closeAttempt: Promise<void> | undefined;
  readonly errors: ErrorFact[] = [];

  constructor(private readonly options: EngineOptions) {
    this.clock = options.clock ?? systemClock;
    this.limits = { ...defaults, ...options.limits };
    for (const [key, value] of Object.entries(this.limits)) positive(value, key);
    if (this.limits.maxEvents < 32) fail("invalid_request", "maxEvents must be at least 32.");
    for (const type of options.types) {
      if (!type.type || !type.version || !type.environment)
        fail("invalid_type", "Type binding is incomplete.");
      const key = `${type.type}\0${type.version}`;
      if (this.types.has(key)) fail("invalid_type", "Duplicate type version.");
      this.types.set(key, type);
    }
    this.view = options.store.read();
  }
  private diagnostic(error: unknown, code = "engine_failure"): void {
    const fact = errorFact(error, code);
    this.errors.push(fact);
    if (this.errors.length > 100) this.errors.shift();
    this.options.onError?.(fact);
  }
  private type(binding: Pick<Binding, "type" | "version">): RegisteredType {
    const type = this.types.get(`${binding.type}\0${binding.version}`);
    if (!type)
      fail("unsupported_version", `Missing original contract ${binding.type}@${binding.version}.`);
    return type;
  }
  private checkHistory(task: TaskRecord): void {
    const type = this.type(task.binding);
    this.validated(task.input, type.validate.bind(type));
    if (task.prepared !== undefined)
      this.validated(task.prepared, type.validatePrepared.bind(type));
    const id = task.snapshot.execution?.executionId;
    const execution = id ? this.view.facts.executions[id] : undefined;
    if (execution?.result !== undefined)
      this.validateResult(type, execution.result, execution.prepared);
  }
  private validateResult(type: RegisteredType, value: unknown, prepared: Json): Json {
    const result = this.validated(value, type.validateResult.bind(type));
    const validate = type.validateExecutionResult;
    if (validate)
      this.validated(result, (value) =>
        validate.call(type, value, freeze(structuredClone(prepared)) as never),
      );
    return result;
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
    if (caller.scope !== scope || !this.options.authorize(caller, operation, scope))
      fail("forbidden", "Access denied.");
  }
  private event<K extends NewEvent["type"]>(
    type: K,
    task: TaskRecord,
    data: Extract<NewEvent, { type: K }>["data"],
  ): NewEvent {
    return {
      type,
      scope: task.binding.scope,
      taskId: task.snapshot.taskId,
      occurredAt: at(this.clock.now()),
      data,
    } as NewEvent;
  }
  private commit(events: NewEvent[]): void {
    if (!events.length) return;
    try {
      this.view = this.options.store.append(this.owner, this.view.facts.watermark, events);
    } catch (error) {
      this.view = this.options.store.read();
      if (error instanceof TaskError) throw error;
      throw new TaskError(
        "storage_failure",
        error instanceof Error ? error.message : "Store commit failed.",
      );
    }
  }
  private executionEvent<K extends NewEvent["type"]>(
    type: K,
    execution: ExecutionRecord,
    data: Extract<NewEvent, { type: K }>["data"],
  ): NewEvent {
    return {
      type,
      scope: execution.binding.scope,
      executionId: execution.executionId,
      occurredAt: type === "execution.started" ? execution.startedAt : at(this.clock.now()),
      data,
    } as NewEvent;
  }
  private admittedCapacity(extra = 1): boolean {
    const tasks = Object.values(this.view.facts.tasks);
    const unfinished = tasks.filter((task) => !effectiveEnd(task.snapshot)).length;
    return (
      tasks.length + extra <= this.limits.maxTasks &&
      this.view.events.length + (unfinished + extra) * 16 + 16 < this.limits.maxEvents
    );
  }
  private parse(request: unknown, caller: Caller, version?: string): TaskRecord {
    const raw = object(json(request, this.limits.maxPayloadBytes));
    const requestId = ulid(raw.requestId);
    if (typeof raw.type !== "string") fail("invalid_request", "type is required.");
    const selected =
      version ??
      (Object.hasOwn(this.options.currentVersions, raw.type)
        ? this.options.currentVersions[raw.type]
        : undefined);
    if (!selected) fail("unknown_type", "Unregistered task type.");
    const type = this.type({ type: raw.type, version: selected });
    const input = Object.fromEntries(Object.entries(raw).filter(([key]) => !common.has(key)));
    const validated = this.validated(input, type.validate.bind(type));
    const timeoutMs = positive(raw.timeoutMs, "timeoutMs");
    const receivedAt = at(this.clock.now());
    const eligibleAt = raw.eligibleAt === undefined ? receivedAt : timestamp(raw.eligibleAt);
    const deadlineAt = at(Date.parse(eligibleAt) + timeoutMs);
    const executionMatch = raw.executionMatch ?? "started-after-eligible";
    if (
      executionMatch !== "started-after-eligible" &&
      executionMatch !== "completed-after-eligible"
    )
      fail("invalid_request", "Unsupported executionMatch.");
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
    return {
      request: raw as TaskRequest,
      input: validated,
      binding: {
        type: raw.type,
        version: selected,
        environment: type.environment,
        scope: caller.scope,
        subject: caller.subject,
        executionMatch,
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
  }
  submit(request: unknown, caller: Caller): TaskSnapshot {
    this.assertRunning();
    this.authorized(caller, "submit", caller?.scope);
    const raw = object(json(request, this.limits.maxPayloadBytes));
    ulid(raw.requestId);
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
    this.commit([this.event("task.canceled", task, {})]);
    this.preparations.get(taskId)?.abort();
    this.reconcileGroups();
    this.reclaimUnowned();
    return project(this.view.facts, taskId, this.clock.now());
  }
  start(): void {
    if (this.started || this.closing) fail("engine_started", "Engine already started.");
    this.options.store.claim(this.owner);
    try {
      this.view = this.options.store.read();
      for (const task of Object.values(this.view.facts.tasks)) this.checkHistory(task);
      for (const execution of Object.values(this.view.facts.executions)) {
        if (!execution.completedAt && !execution.failedAt) {
          this.commit([
            this.executionEvent("execution.failed", execution, {
              error: {
                code: "execution_interrupted",
                message: "No reliable final fact survived restart; work is not rerun.",
              },
            }),
          ]);
        }
      }
      this.started = true;
      for (const task of Object.values(this.view.facts.tasks)) this.settle(task);
      this.schedule();
    } catch (error) {
      this.started = false;
      this.options.store.release(this.owner);
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
            this.preparations.get(task.snapshot.taskId)?.abort();
            continue;
          }
          if (task.prepared !== undefined) this.allocate(task);
          else if (
            !this.preparations.has(task.snapshot.taskId) &&
            this.preparations.size < this.limits.maxConcurrent
          )
            this.prepare(task);
        } catch (error) {
          this.diagnostic(error);
          const current = this.view.facts.tasks[original.snapshot.taskId];
          if (current?.snapshot.stage === "queued" && !effectiveEnd(current.snapshot))
            this.processFailure(current, "allocation", error);
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
  private compatible(
    task: TaskRecord,
    candidate: Pick<TaskRecord, "binding" | "input" | "prepared">,
  ): boolean {
    if (
      task.binding.type !== candidate.binding.type ||
      task.binding.version !== candidate.binding.version ||
      task.binding.environment !== candidate.binding.environment ||
      task.binding.scope !== candidate.binding.scope ||
      task.prepared === undefined ||
      candidate.prepared === undefined ||
      canonical(task.prepared) !== canonical(candidate.prepared)
    )
      return false;
    return this.type(task.binding).equals(
      freeze(structuredClone(task.input)) as never,
      freeze(structuredClone(candidate.input)),
    );
  }
  private matches(task: TaskRecord, execution: ExecutionRecord): boolean {
    if (execution.sealed || !this.compatible(task, execution)) return false;
    return matchesExecutionTime(task.binding.executionMatch, task.snapshot.eligibleAt, execution);
  }
  private settle(task: TaskRecord): void {
    if (task.snapshot.canceledAt || task.snapshot.termination) return;
    const boundId = task.snapshot.execution?.executionId;
    const execution = boundId
      ? this.view.facts.executions[boundId]
      : Object.values(this.view.facts.executions).find(
          (candidate) => candidate.completedAt !== undefined && this.matches(task, candidate),
        );
    if (!execution || (!execution.completedAt && !execution.failedAt)) return;
    if (
      execution.completedAt &&
      !matchesExecutionTime(task.binding.executionMatch, task.snapshot.eligibleAt, execution)
    )
      return;
    const events: NewEvent[] = [];
    if (!boundId)
      events.push(
        this.event("task.allocation.bound", task, { executionId: execution.executionId }),
      );
    events.push(this.event("task.terminated", task, { executionId: execution.executionId }));
    this.commit(events);
  }
  private prepare(task: TaskRecord): void {
    const type = this.type(task.binding);
    if (type.environment !== task.binding.environment) {
      this.processFailure(
        task,
        "preparation",
        new TaskError("unsupported_environment", "Original execution environment unavailable."),
      );
      return;
    }
    const controller = new AbortController();
    this.preparations.set(task.snapshot.taskId, controller);
    try {
      this.commit([this.event("task.preparation.started", task, {})]);
    } catch (error) {
      this.preparations.delete(task.snapshot.taskId);
      throw error;
    }
    void Promise.resolve()
      .then(() => {
        const current = this.view.facts.tasks[task.snapshot.taskId];
        if (this.closing || controller.signal.aborted || !current || !this.active(current)) {
          controller.abort();
          fail("preparation_canceled", "Preparation was withdrawn before invocation.");
        }
        return type.prepare(freeze(structuredClone(task.input)) as never, {
          signal: controller.signal,
          deadlineAt: task.snapshot.deadlineAt,
          context: Object.freeze({
            type: task.binding.type,
            version: task.binding.version,
            environment: task.binding.environment,
            scope: task.binding.scope,
          }),
        });
      })
      .then((value) => {
        if (!this.started || this.closing) return;
        const prepared = this.validated(value, type.validatePrepared.bind(type));
        const current = this.view.facts.tasks[task.snapshot.taskId];
        if (!current || current.snapshot.canceledAt) return;
        this.commit([this.event("task.preparation.completed", current, { prepared })]);
        this.settle(this.view.facts.tasks[task.snapshot.taskId] ?? current);
      })
      .catch((error) => {
        if (!this.started || this.closing || controller.signal.aborted) return;
        const current = this.view.facts.tasks[task.snapshot.taskId];
        if (current) this.processFailure(current, "preparation", error);
      })
      .catch((error) => this.diagnostic(error))
      .finally(() => {
        this.preparations.delete(task.snapshot.taskId);
      });
  }
  private processFailure(
    task: TaskRecord,
    phase: "preparation" | "allocation",
    error: unknown,
  ): void {
    if (effectiveEnd(task.snapshot)) return;
    const fact = errorFact(error, `${phase}_failed`);
    this.commit([
      this.event(
        phase === "preparation" ? "task.preparation.failed" : "task.allocation.failed",
        task,
        { error: fact },
      ),
      this.event("task.terminated", task, { error: fact }),
    ]);
  }
  private allocate(task: TaskRecord): void {
    if (task.snapshot.execution) return;
    if (this.type(task.binding).environment !== task.binding.environment) {
      this.processFailure(
        task,
        "allocation",
        new TaskError(
          "unsupported_environment",
          "Original prepared execution environment unavailable.",
        ),
      );
      return;
    }
    if (this.clock.now() <= Date.parse(task.snapshot.eligibleAt)) return;
    for (const group of this.groups) if (group.owners.has(task.snapshot.taskId)) return;
    const existing = Object.values(this.view.facts.executions).find(
      (execution) =>
        !execution.failedAt &&
        !execution.sealed &&
        this.compatible(task, execution) &&
        (this.matches(task, execution) ||
          (!execution.completedAt && task.binding.executionMatch === "completed-after-eligible")),
    );
    if (existing) {
      this.commit([
        this.event("task.allocation.bound", task, { executionId: existing.executionId }),
      ]);
      this.settle(this.view.facts.tasks[task.snapshot.taskId] ?? task);
      return;
    }
    for (const group of this.groups) {
      if (
        !group.executionId &&
        !group.controller.signal.aborted &&
        this.compatible(task, group.exemplar)
      ) {
        group.owners.add(task.snapshot.taskId);
        return;
      }
    }
    if (this.groups.size >= this.limits.maxConcurrent) return;
    const group: Group = {
      exemplar: task,
      owners: new Set([task.snapshot.taskId]),
      controller: new AbortController(),
    };
    this.groups.add(group);
    const candidate = Object.values(this.view.facts.executions).find(
      (execution) =>
        !execution.sealed &&
        !execution.completedAt &&
        !execution.failedAt &&
        execution.binding.type === task.binding.type &&
        execution.binding.version === task.binding.version &&
        execution.binding.environment === task.binding.environment &&
        this.tracking.has(execution.executionId) &&
        !this.protectedOwners(execution.executionId),
    );
    const options = {
      context: Object.freeze({
        type: task.binding.type,
        version: task.binding.version,
        environment: task.binding.environment,
        scope: task.binding.scope,
      }),
      signal: group.controller.signal,
      ...(candidate ? { replaceExecutionId: candidate.executionId } : {}),
      start: () => this.startGroup(group),
      authorizeReplacement: (id: string, generation: string) => {
        const execution = this.view.facts.executions[id];
        if (
          !candidate ||
          id !== candidate.executionId ||
          !execution ||
          execution.generation !== generation ||
          execution.sealed ||
          execution.completedAt ||
          execution.failedAt ||
          this.protectedOwners(id) ||
          group.controller.signal.aborted
        )
          return false;
        this.commit([this.executionEvent("execution.sealed", execution, {})]);
        return true;
      },
    };
    const allocation = Promise.resolve()
      .then(() =>
        this.type(task.binding).execute(freeze(structuredClone(task.prepared)) as never, options),
      )
      .then((tracking) => {
        if (tracking.executionId !== group.executionId)
          fail("invalid_tracking", "Tracking does not match durable startup.");
        const execution = this.view.facts.executions[tracking.executionId];
        if (
          !execution ||
          tracking.startedAt !== execution.startedAt ||
          tracking.generation !== execution.generation
        )
          fail("invalid_tracking", "Untrusted tracking identity or start time.");
        this.tracking.set(tracking.executionId, tracking);
        void tracking.finished
          .then(
            () => {
              const final = this.view.facts.executions[tracking.executionId];
              if (final && !final.completedAt && !final.failedAt)
                this.reportFailure(final, {
                  code: "invalid_tracking",
                  message: "Tracking ended without a final execution fact.",
                });
              const reclaimed = this.view.facts.executions[tracking.executionId];
              if (this.started && reclaimed && !reclaimed.reclaimedAt)
                this.commit([this.executionEvent("execution.reclaimed", reclaimed, {})]);
              this.wallTimers.get(tracking.executionId)?.();
              this.wallTimers.delete(tracking.executionId);
              this.wallExpired.delete(tracking.executionId);
              this.tracking.delete(tracking.executionId);
            },
            (error) => this.diagnostic(error, "reclamation_failed"),
          )
          .catch((error) => this.diagnostic(error, "reclamation_failed"));
        if (this.wallExpired.has(tracking.executionId))
          this.reclaim(tracking.executionId, "execution_wall_limit");
        else if (this.closing || !this.hasUncanceledOwners(tracking.executionId))
          this.reclaim(tracking.executionId, this.closing ? "engine_closed" : "owners_canceled");
      })
      .catch((error) => {
        if (group.executionId) {
          const execution = this.view.facts.executions[group.executionId];
          if (execution) this.reportFailure(execution, errorFact(error, "execution_failed"));
        } else if (!group.controller.signal.aborted && this.started && !this.closing) {
          for (const id of group.owners) {
            const owner = this.view.facts.tasks[id];
            if (owner && this.active(owner)) this.processFailure(owner, "allocation", error);
          }
        }
      })
      .catch((error) => this.diagnostic(error))
      .finally(() => {
        this.groups.delete(group);
        this.allocations.delete(allocation);
      });
    this.allocations.add(allocation);
  }
  private startGroup(group: Group): StartPermit {
    this.assertRunning();
    if (group.executionId || group.controller.signal.aborted)
      fail("allocation_canceled", "Start was withdrawn.");
    const now = this.clock.now();
    const owners = [...group.owners]
      .map((id) => this.view.facts.tasks[id])
      .filter(
        (task): task is TaskRecord =>
          task !== undefined &&
          this.active(task, now) &&
          now > Date.parse(task.snapshot.eligibleAt),
      );
    if (!owners.length) fail("allocation_canceled", "No eligible, unexpired startup owner.");
    const execution: ExecutionRecord = {
      executionId: newId(now),
      generation: newId(now),
      binding: group.exemplar.binding,
      input: group.exemplar.input,
      prepared: group.exemplar.prepared as Json,
      startedAt: at(now),
    };
    const events = [
      this.executionEvent("execution.started", execution, { execution }),
      ...owners.map((task) =>
        this.event("task.allocation.bound", task, { executionId: execution.executionId }),
      ),
    ];
    try {
      this.commit(events);
    } catch (error) {
      if (this.view.facts.executions[execution.executionId]) {
        group.executionId = execution.executionId;
        this.reportFailure(execution, {
          code: "execution_interrupted",
          message: "Durable startup committed but delivery failed.",
        });
      }
      throw error;
    }
    group.executionId = execution.executionId;
    this.wallTimers.set(
      execution.executionId,
      this.clock.schedule(() => {
        this.wallExpired.add(execution.executionId);
        this.reclaim(execution.executionId, "execution_wall_limit");
      }, this.limits.executionWallMs),
    );
    return {
      executionId: execution.executionId,
      generation: execution.generation,
      startedAt: execution.startedAt,
      progress: (value) => this.report(execution, "progress", value),
      complete: (value) => this.report(execution, "complete", value),
      fail: (error) => this.reportFailure(execution, error),
    };
  }
  private report(execution: ExecutionRecord, kind: "progress" | "complete", value: unknown): void {
    const current = this.view.facts.executions[execution.executionId];
    if (
      !this.started ||
      !current ||
      current.generation !== execution.generation ||
      current.completedAt ||
      current.failedAt
    )
      return;
    const type = this.type(current.binding);
    let payload: Json;
    try {
      payload =
        kind === "complete"
          ? this.validateResult(type, value, current.prepared)
          : this.validated(value, type.validateProgress.bind(type));
    } catch (error) {
      this.reportFailure(current, errorFact(error, "invalid_payload"));
      return;
    }
    try {
      if (kind === "progress") {
        const unfinished = Object.values(this.view.facts.tasks).filter(
          (task) => !effectiveEnd(task.snapshot),
        ).length;
        if (this.view.events.length + unfinished * 16 + 16 >= this.limits.maxEvents)
          fail("capacity_exceeded", "Progress retention capacity exhausted.");
        this.commit([this.executionEvent("execution.progress", current, { progress: payload })]);
      } else
        this.commit([this.executionEvent("execution.completed", current, { result: payload })]);
    } catch (error) {
      if (
        error instanceof TaskError &&
        ["invalid_payload", "payload_too_large", "invalid_type", "capacity_exceeded"].includes(
          error.code,
        )
      )
        this.reportFailure(current, errorFact(error, "execution_failed"));
      else throw error;
    }
  }
  private reportFailure(execution: ExecutionRecord, error: ErrorFact): void {
    const current = this.view.facts.executions[execution.executionId];
    if (!this.started || !current || current.completedAt || current.failedAt) return;
    const parsed = object(error);
    if (typeof parsed.code !== "string" || typeof parsed.message !== "string")
      fail("invalid_payload", "Invalid error fact.");
    this.commit([
      this.executionEvent("execution.failed", current, {
        error: { code: parsed.code.slice(0, 128), message: parsed.message.slice(0, 512) },
      }),
    ]);
  }
  private protectedOwners(id: string): boolean {
    return Object.values(this.view.facts.tasks).some(
      (task) => task.snapshot.execution?.executionId === id && this.active(task),
    );
  }
  private hasUncanceledOwners(id: string): boolean {
    return Object.values(this.view.facts.tasks).some(
      (task) =>
        task.snapshot.execution?.executionId === id &&
        !task.snapshot.canceledAt &&
        !task.snapshot.termination,
    );
  }
  private reconcileGroups(): void {
    for (const group of this.groups) {
      if (group.executionId) continue;
      for (const id of group.owners) {
        const task = this.view.facts.tasks[id];
        if (!task || !this.active(task)) group.owners.delete(id);
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
    void tracking
      .reclaim(reason)
      .then(() => {
        const execution = this.view.facts.executions[id];
        if (this.started && execution) {
          if (!execution.completedAt && !execution.failedAt)
            this.reportFailure(execution, {
              code: reason,
              message: "Execution physically reclaimed.",
            });
          if (!this.view.facts.executions[id]?.reclaimedAt)
            this.commit([this.executionEvent("execution.reclaimed", execution, {})]);
        }
      })
      .catch((error) => this.diagnostic(error, "reclamation_failed"))
      .finally(() => this.reclaiming.delete(id));
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
  ): { tasks: TaskRecord[]; executions: Set<string>; key: string } {
    const raw = object(filter);
    if (Object.keys(raw).length !== 1)
      fail("invalid_request", "Exactly one history filter required.");
    let tasks: TaskRecord[];
    const executions = new Set<string>();
    if ("taskId" in raw) tasks = [this.task(ulid(raw.taskId), caller, operation)];
    else if ("seriesId" in raw) {
      ulid(raw.seriesId);
      tasks = Object.values(this.view.facts.tasks).filter(
        (task) => task.snapshot.seriesId === raw.seriesId,
      );
    } else if ("executionId" in raw) {
      const id = ulid(raw.executionId);
      const execution = this.view.facts.executions[id];
      if (!execution) fail("not_found", "Execution not found.");
      this.authorized(caller, operation, execution.binding.scope);
      const type = this.type(execution.binding);
      this.validated(execution.input, type.validate.bind(type));
      this.validated(execution.prepared, type.validatePrepared.bind(type));
      if (execution.result !== undefined)
        this.validateResult(type, execution.result, execution.prepared);
      executions.add(id);
      tasks = [];
    } else fail("invalid_request", "Unknown history filter.");
    if (!tasks.length && !executions.size) fail("not_found", "History target not found.");
    for (const task of tasks) {
      this.authorized(caller, operation, task.binding.scope);
      this.checkHistory(task);
      if (task.snapshot.execution) executions.add(task.snapshot.execution.executionId);
    }
    return { tasks, executions, key: canonical(raw) };
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
    if (event.executionId) {
      const execution = this.view.facts.executions[event.executionId];
      if (execution) {
        const type = this.type(execution.binding);
        if (event.type === "execution.progress")
          this.validated(event.data.progress, type.validateProgress.bind(type));
        if (event.type === "execution.completed")
          this.validateResult(type, event.data.result, execution.prepared);
      }
    }
    if (event.type === "task.preparation.completed") return { ...event, data: {} };
    if (event.type === "execution.started") {
      const { prepared: _prepared, ...execution } = event.data.execution;
      return { ...event, data: JSON.parse(JSON.stringify({ execution })) as Json };
    }
    return structuredClone(event) as unknown as PublicEvent;
  }
  private selectedEvents(
    filter: ReturnType<TaskEngine["filter"]>,
    after: number,
    through: number,
  ): FactEvent[] {
    const ids = new Set(filter.tasks.map((task) => task.snapshot.taskId));
    const executions = ids.size
      ? new Set(
          this.view.events
            .filter(
              (event) =>
                event.sequence <= through &&
                event.taskId !== undefined &&
                ids.has(event.taskId) &&
                event.type === "task.allocation.bound",
            )
            .map((event) => (event.type === "task.allocation.bound" ? event.data.executionId : "")),
        )
      : filter.executions;
    return this.view.events.filter(
      (event) =>
        event.sequence > after &&
        event.sequence <= through &&
        ((event.taskId !== undefined && ids.has(event.taskId)) ||
          (event.executionId !== undefined && executions.has(event.executionId))),
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
    if (!tasks.length || this.groups.size || this.preparations.size || this.tracking.size) return;
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
          executionIds: Object.keys(this.view.facts.executions),
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
    this.timer?.();
    for (const stopTimer of this.wallTimers.values()) stopTimer();
    this.wallTimers.clear();
    for (const subscription of this.subscriptions) subscription.close();
    for (const controller of this.preparations.values()) controller.abort();
    for (const group of this.groups) if (!group.executionId) group.controller.abort();
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
        await tracking.reclaim("engine_closed");
        const execution = this.view.facts.executions[tracking.executionId];
        if (execution && !execution.reclaimedAt)
          this.commit([this.executionEvent("execution.reclaimed", execution, {})]);
      }),
    );
    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    if (failed?.status === "rejected") {
      this.diagnostic(failed.reason, "reclamation_failed");
      fail("reclamation_failed", "Engine retains store ownership because resource cleanup failed.");
    }
    this.started = false;
    this.options.store.release(this.owner);
  }
}

export function createTaskEngine(options: EngineOptions): TaskEngine {
  return new TaskEngine(options);
}
