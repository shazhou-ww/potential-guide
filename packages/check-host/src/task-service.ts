import { randomUUID } from "node:crypto";
import { canonicalJson, finiteJson, type Json } from "@potential-guide/check-artifacts";
import type { ContractMetadata } from "./contract-store.js";
import { type Freshness, type TaskError, type TaskState, TaskProtocolError } from "./v2-types.js";

export interface TaskOptions {
  freshness?: Freshness;
  timeoutMs?: number;
}
export interface ServiceSnapshot<R, P = Json, E = Json> {
  taskId: string;
  hostInstance: string;
  revision: number;
  state: TaskState;
  acceptedAt: string;
  freshness: Freshness;
  artifact?: ContractMetadata;
  language?: string;
  executionId?: string;
  executionStartedAt?: string;
  executionCompletedAt?: string;
  result?: R;
  progress?: P;
  evidence?: E;
  error?: TaskError;
}
export interface ServiceEvent<R, P = Json, E = Json> {
  taskId: string;
  snapshot: ServiceSnapshot<R, P, E>;
}
export interface PreparedTask {
  artifact: ContractMetadata;
  language: string;
  compatibility: string;
}
export interface ExecutionContext<P, E> {
  id: string;
  scope: string;
  signal: AbortSignal;
  deadline: number;
  start(): void;
  progress(progress: P, evidence?: E): void;
}
export interface TaskAdapter<Q, A extends PreparedTask, R, P, E> {
  normalize(request: Q): Q;
  authorize(request: Q, scope: string): void;
  prepare(request: Q, scope: string, signal: AbortSignal): Promise<A>;
  execute(
    prepared: A,
    request: Q,
    context: ExecutionContext<P, E>,
  ): Promise<{ result: R; evidence: E }>;
}
export const serviceLimits = {
  records: 256,
  executions: 256,
  observers: 64,
  filterTasks: 64,
  timeoutMs: 60_000,
  maxTimeoutMs: 600_000,
  executionMs: 600_000,
  retentionMs: 60_000,
};
export const serviceTerminal = (state: { state: TaskState }) =>
  ["completed", "failed", "cancelled"].includes(state.state);
type Task<Q, A, R, P, E> = {
  request: Q;
  scope: string;
  accepted: number;
  deadline: number;
  fingerprint: string;
  key?: string;
  prepared?: A;
  run?: Run<Q, A, R, P, E>;
  snapshot: ServiceSnapshot<R, P, E>;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  expires?: number;
};
type Run<Q, A, R, P, E> = {
  id: string;
  key: string;
  prepared: A;
  request: Q;
  scope: string;
  state: "reserved" | "running" | "completed" | "stopping" | "failed";
  tasks: Set<Task<Q, A, R, P, E>>;
  controller: AbortController;
  started?: number;
  completed?: number;
  startedAt?: string;
  completedAt?: string;
  progress?: P;
  evidence?: E;
  result?: R;
  timer?: ReturnType<typeof setTimeout>;
  expires?: number;
  deadline?: number;
};
/** Single-threaded arbitration uses causal sequence numbers, never client wall clocks. */
export class TaskService<Q extends TaskOptions, A extends PreparedTask, R, P = Json, E = Json> {
  readonly instance = randomUUID();
  private sequence = 0;
  private closed = false;
  private readonly tasks = new Map<string, Task<Q, A, R, P, E>>();
  private readonly keys = new Map<string, Task<Q, A, R, P, E>>();
  private readonly runs = new Map<string, Run<Q, A, R, P, E>>();
  private readonly listeners = new Set<{
    scope: string;
    ids?: Set<string>;
    send(event: ServiceEvent<R, P, E>): void;
  }>();
  private readonly operations = new Set<Promise<void>>();
  private readonly sweep: ReturnType<typeof setInterval>;
  constructor(
    readonly adapter: TaskAdapter<Q, A, R, P, E>,
    readonly limits = serviceLimits,
  ) {
    for (const limit of Object.values(limits))
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_147_483_647)
        throw new Error("Invalid service limit.");
    this.sweep = setInterval(() => this.expire(), Math.min(1000, limits.retentionMs));
    this.sweep.unref();
  }
  private fail(status: number, code: string, message: string): never {
    throw new TaskProtocolError(status, { code, stage: "schedule", message });
  }
  accept(input: Q, scope: string, idempotencyKey?: string) {
    if (this.closed) this.fail(503, "host_closing", "Service is closing.");
    if (!finiteJson(input)) this.fail(400, "invalid_request", "Expected finite JSON request.");
    if (new TextEncoder().encode(JSON.stringify(input)).length > 1024 * 1024)
      this.fail(413, "request_too_large", "Task request exceeds bounds.");
    if (idempotencyKey !== undefined && !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey))
      this.fail(400, "invalid_idempotency_key", "Invalid idempotency key.");
    let request: Q;
    try {
      request = this.adapter.normalize(structuredClone(input));
    } catch (error) {
      if (error instanceof TaskProtocolError) throw error;
      this.fail(400, "invalid_request", "Task request violates the contract.");
    }
    try {
      this.adapter.authorize(request, scope);
    } catch (error) {
      if (error instanceof TaskProtocolError) throw error;
      this.fail(403, "source_denied", "Task source is not authorized.");
    }
    const duration = request.timeoutMs ?? this.limits.timeoutMs;
    const freshness = request.freshness ?? "started-after-request";
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > this.limits.maxTimeoutMs)
      this.fail(400, "invalid_timeout", "Task timeout exceeds bounds.");
    if (!["started-after-request", "completed-after-request"].includes(freshness))
      this.fail(400, "invalid_freshness", "Invalid freshness.");
    const fingerprint = canonicalJson({
      ...request,
      freshness,
      timeoutMs: duration,
    } as unknown as Json);
    const key = idempotencyKey ? `${scope}\0${idempotencyKey}` : undefined;
    this.expire();
    const previous = key ? this.keys.get(key) : undefined;
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        this.fail(409, "idempotency_conflict", "Idempotency key request differs.");
      return structuredClone(previous.snapshot);
    }
    if (this.tasks.size >= this.limits.records)
      this.fail(429, "task_capacity", "Task retention capacity exhausted.");
    const taskId = randomUUID();
    const task: Task<Q, A, R, P, E> = {
      request,
      scope,
      fingerprint,
      ...(key ? { key } : {}),
      accepted: ++this.sequence,
      deadline: performance.now() + duration,
      controller: new AbortController(),
      snapshot: {
        taskId,
        hostInstance: this.instance,
        revision: 1,
        state: "accepted",
        acceptedAt: new Date().toISOString(),
        freshness,
      },
      timer: setTimeout(() => this.timeout(task), duration),
    };
    this.tasks.set(taskId, task);
    if (key) this.keys.set(key, task);
    queueMicrotask(() => {
      this.track(this.prepare(task));
    });
    this.emit(task);
    return structuredClone(task.snapshot);
  }
  private track(operation: Promise<void>) {
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation));
  }
  private async prepare(task: Task<Q, A, R, P, E>) {
    if (!this.alive(task)) return;
    this.update(task, { state: "preparing" });
    try {
      const prepared = await this.adapter.prepare(task.request, task.scope, task.controller.signal);
      if (!this.alive(task)) return;
      task.prepared = prepared;
      this.update(task, { artifact: prepared.artifact, language: prepared.language });
      this.match(task, prepared);
    } catch (error) {
      if (this.alive(task))
        this.finish(task, {
          state: "failed",
          error:
            error instanceof TaskProtocolError
              ? error.detail
              : {
                  code: "preparation_failed",
                  stage: "validate",
                  message: "Artifact preparation failed.",
                },
        });
    }
  }
  private qualifies(task: Task<Q, A, R, P, E>, run: Run<Q, A, R, P, E>) {
    return task.snapshot.freshness === "started-after-request"
      ? (run.started ?? -1) > task.accepted
      : (run.completed ?? this.sequence + 1) > task.accepted;
  }
  private match(task: Task<Q, A, R, P, E>, prepared: A) {
    const key = `${task.scope}\0${prepared.compatibility}`;
    for (const run of this.runs.values()) {
      for (const member of [...run.tasks]) this.alive(member);
      if (
        run.deadline !== undefined &&
        performance.now() >= run.deadline &&
        (run.state === "running" || run.state === "reserved")
      )
        this.stopExpiredRun(run);
      if (run.key !== key || !this.qualifies(task, run)) continue;
      if (run.state === "completed") {
        this.deliver(task, run);
        return;
      }
      if (run.state === "running") {
        this.attach(task, run);
        return;
      }
    }
    const reserved = [...this.runs.values()].find(
      (run) => run.key === key && run.state === "reserved",
    );
    if (reserved) {
      this.attach(task, reserved);
      return;
    }
    if (this.runs.size >= this.limits.executions)
      this.fail(429, "execution_capacity", "Execution retention capacity exhausted.");
    const run: Run<Q, A, R, P, E> = {
      id: randomUUID(),
      key,
      prepared,
      request: task.request,
      scope: task.scope,
      state: "reserved",
      tasks: new Set(),
      controller: new AbortController(),
    };
    this.runs.set(run.id, run);
    this.attach(task, run);
    // Reserve all same-turn requests before initiating any business observation.
    queueMicrotask(() => {
      this.track(this.execute(run));
    });
  }
  private attach(task: Task<Q, A, R, P, E>, run: Run<Q, A, R, P, E>) {
    task.run = run;
    run.tasks.add(task);
    this.update(task, {
      state: run.state === "running" ? "running" : "waiting",
      executionId: run.id,
      ...(run.startedAt ? { executionStartedAt: run.startedAt } : {}),
      ...(run.progress !== undefined ? { progress: run.progress } : {}),
      ...(run.evidence !== undefined ? { evidence: run.evidence } : {}),
    });
  }
  private async execute(run: Run<Q, A, R, P, E>) {
    if (run.state !== "reserved") {
      run.expires = performance.now() + this.limits.retentionMs;
      return;
    }
    const deadline = performance.now() + this.limits.executionMs;
    run.deadline = deadline;
    const wall = () => {
      if (performance.now() < deadline) {
        run.timer = setTimeout(wall, Math.max(1, deadline - performance.now()));
        return;
      }
      this.stopExpiredRun(run);
    };
    run.timer = setTimeout(wall, this.limits.executionMs);
    try {
      const output = await this.adapter.execute(run.prepared, run.request, {
        id: run.id,
        scope: run.scope,
        signal: run.controller.signal,
        deadline,
        start: () => {
          if (run.state !== "reserved") throw new Error("Execution cannot start.");
          if (performance.now() >= deadline) {
            this.stopExpiredRun(run);
            throw new Error("Execution deadline expired.");
          }
          for (const task of [...run.tasks]) this.alive(task);
          run.controller.signal.throwIfAborted();
          run.state = "running";
          run.started = ++this.sequence;
          run.startedAt = new Date().toISOString();
          for (const task of run.tasks)
            this.update(task, { state: "running", executionStartedAt: run.startedAt });
        },
        progress: (progress, evidence) => {
          if (run.state !== "running") return;
          if (JSON.stringify({ progress, evidence }).length > 1024 * 1024)
            throw new Error("Progress exceeds bounds.");
          run.progress = structuredClone(progress);
          if (evidence !== undefined) run.evidence = structuredClone(evidence);
          for (const task of [...run.tasks])
            if (this.alive(task))
              this.update(task, {
                progress: run.progress,
                ...(run.evidence !== undefined ? { evidence: run.evidence } : {}),
              });
        },
      });
      run.controller.signal.throwIfAborted();
      if (run.started === undefined || performance.now() >= deadline)
        throw new Error("Invalid observation start or deadline.");
      if (!finiteJson(output) || JSON.stringify(output).length > 4 * 1024 * 1024)
        throw new Error("Observation result/evidence exceeds finite JSON bounds.");
      run.completed = ++this.sequence;
      run.completedAt = new Date().toISOString();
      run.result = output.result;
      run.evidence = output.evidence;
      run.state = "completed";
      for (const task of [...run.tasks]) this.deliver(task, run);
    } catch (error) {
      run.state = "failed";
      for (const task of [...run.tasks])
        if (this.alive(task))
          this.finish(task, {
            state: "failed",
            error:
              error instanceof TaskProtocolError
                ? error.detail
                : { code: "observation_failed", stage: "observe", message: "Execution failed." },
          });
    } finally {
      clearTimeout(run.timer);
      run.tasks.clear();
      run.expires = performance.now() + this.limits.retentionMs;
    }
  }
  private deliver(task: Task<Q, A, R, P, E>, run: Run<Q, A, R, P, E>) {
    if (!this.alive(task) || !this.qualifies(task, run)) return;
    this.finish(task, {
      state: "completed",
      executionId: run.id,
      ...(run.startedAt ? { executionStartedAt: run.startedAt } : {}),
      ...(run.completedAt ? { executionCompletedAt: run.completedAt } : {}),
      ...(run.result !== undefined ? { result: run.result } : {}),
      ...(run.progress !== undefined ? { progress: run.progress } : {}),
      ...(run.evidence !== undefined ? { evidence: run.evidence } : {}),
    });
  }
  private alive(task: Task<Q, A, R, P, E>) {
    if (serviceTerminal(task.snapshot)) return false;
    if (performance.now() >= task.deadline) {
      this.timeout(task);
      return false;
    }
    return true;
  }
  private timeout(task: Task<Q, A, R, P, E>) {
    if (serviceTerminal(task.snapshot)) return;
    if (performance.now() < task.deadline) {
      clearTimeout(task.timer);
      task.timer = setTimeout(
        () => this.timeout(task),
        Math.max(1, task.deadline - performance.now()),
      );
      return;
    }
    this.finish(task, {
      state: "failed",
      error: {
        code: "task_timeout",
        stage: task.snapshot.state === "preparing" ? "resolve" : "schedule",
        message: "Task deadline expired.",
      },
    });
  }
  private stopExpiredRun(run: Run<Q, A, R, P, E>) {
    if (run.state !== "reserved" && run.state !== "running") return;
    run.state = "stopping";
    run.controller.abort();
    for (const task of [...run.tasks])
      this.finish(task, {
        state: "failed",
        error: {
          code: "execution_timeout",
          stage: "observe",
          message: "Execution wall-clock expired.",
        },
      });
  }
  private finish(task: Task<Q, A, R, P, E>, patch: Partial<ServiceSnapshot<R, P, E>>) {
    if (serviceTerminal(task.snapshot)) return;
    clearTimeout(task.timer);
    task.controller.abort();
    task.expires = performance.now() + this.limits.retentionMs;
    this.update(task, patch);
    task.run?.tasks.delete(task);
    if (task.run && !task.run.tasks.size && ["reserved", "running"].includes(task.run.state)) {
      task.run.state = "stopping";
      task.run.controller.abort();
    }
  }
  private update(task: Task<Q, A, R, P, E>, patch: Partial<ServiceSnapshot<R, P, E>>) {
    task.snapshot = structuredClone({
      ...task.snapshot,
      ...patch,
      revision: task.snapshot.revision + 1,
    });
    this.emit(task);
  }
  private emit(task: Task<Q, A, R, P, E>) {
    for (const listener of this.listeners)
      if (
        listener.scope === task.scope &&
        (!listener.ids || listener.ids.has(task.snapshot.taskId))
      )
        listener.send({ taskId: task.snapshot.taskId, snapshot: structuredClone(task.snapshot) });
  }
  private lookup(id: string, scope: string) {
    this.expire();
    const task = this.tasks.get(id);
    if (!task) this.fail(404, "task_unavailable", "Task missing or retention expired.");
    if (task.scope !== scope) this.fail(403, "task_forbidden", "Task scope mismatch.");
    return task;
  }
  snapshot(id: string, scope: string) {
    const task = this.lookup(id, scope);
    this.alive(task);
    return structuredClone(task.snapshot);
  }
  cancel(id: string, scope: string) {
    const task = this.lookup(id, scope);
    if (this.alive(task))
      this.finish(task, {
        state: "cancelled",
        error: { code: "task_cancelled", stage: "schedule", message: "Task cancelled." },
      });
    return structuredClone(task.snapshot);
  }
  subscribe(
    ids: readonly string[] | undefined,
    scope: string,
    send: (event: ServiceEvent<R, P, E>) => void,
  ) {
    if (this.listeners.size >= this.limits.observers)
      this.fail(429, "observer_capacity", "Observer capacity exhausted.");
    if (ids && (!ids.length || ids.length > this.limits.filterTasks))
      this.fail(400, "invalid_filter", "Invalid task filter.");
    const tasks = ids
      ? [...new Set(ids)].map((id) => this.lookup(id, scope))
      : [...this.tasks.values()].filter((task) => task.scope === scope);
    if (tasks.length > this.limits.filterTasks)
      this.fail(429, "observer_capacity", "Observer scope exceeds bounds.");
    for (const task of tasks) this.alive(task);
    const listener = { scope, send, ...(ids ? { ids: new Set(ids) } : {}) };
    this.listeners.add(listener);
    for (const task of tasks)
      send({ taskId: task.snapshot.taskId, snapshot: structuredClone(task.snapshot) });
    return () => this.listeners.delete(listener);
  }
  private expire() {
    const now = performance.now();
    for (const [id, task] of this.tasks)
      if (task.expires !== undefined && task.expires <= now) {
        this.tasks.delete(id);
        if (task.key) this.keys.delete(task.key);
      }
    for (const [id, run] of this.runs)
      if (run.expires !== undefined && run.expires <= now) this.runs.delete(id);
  }
  async close() {
    this.closed = true;
    clearInterval(this.sweep);
    for (const task of this.tasks.values())
      if (!serviceTerminal(task.snapshot))
        this.finish(task, {
          state: "failed",
          error: { code: "host_closing", stage: "cleanup", message: "Service closed." },
        });
    await Promise.allSettled(this.operations);
    this.listeners.clear();
  }
}
