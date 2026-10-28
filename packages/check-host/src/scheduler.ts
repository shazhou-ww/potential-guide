import { randomUUID } from "node:crypto";
import { validateCheckValue } from "@potential-guide/check-artifacts";
import type { ArtifactManager, ManagedArtifact } from "./artifact-manager.js";
import type { CheckKernel } from "./kernel.js";
import type { CheckState } from "./types.js";
import {
  canonicalJson,
  type CheckRequest,
  type CheckTaskSnapshot,
  type TaskEvent,
  TaskProtocolError,
  taskTerminal,
  v2Limits,
} from "./v2-types.js";

type Task = {
  request: CheckRequest;
  scope: string;
  fingerprint: string;
  accepted: number;
  deadline: number;
  snapshot: CheckTaskSnapshot;
  timer: NodeJS.Timeout;
  expires?: number;
  artifact?: ManagedArtifact;
  key?: string;
  execution?: Run;
};
type Run = {
  id: string;
  key: string;
  artifact: ManagedArtifact;
  tasks: Set<Task>;
  state: "reserved" | "running" | "completed" | "stopping" | "failed";
  started?: number;
  completed?: number;
  startedAt?: string;
  completedAt?: string;
  result?: CheckState & { state: "Completed" };
  expires?: number;
};
type Listener = { scope: string; ids?: Set<string>; send(event: TaskEvent): void };
export interface SchedulerClock {
  now(): number;
  date(): string;
}
export type SchedulerArtifacts = Pick<
  ArtifactManager,
  "authorize" | "resolve" | "retain" | "release" | "metadata" | "reference"
>;
export type SchedulerKernel = Pick<CheckKernel, "executeCheck" | "cancel" | "close" | "limits">;
const clock: SchedulerClock = {
  now: () => performance.now(),
  date: () => new Date().toISOString(),
};

// All arbitration methods are synchronous. IO only returns through resolve/start/finish.
export class TaskScheduler {
  readonly instance = randomUUID();
  private sequence = 0;
  private readonly tasks = new Map<string, Task>();
  private readonly keys = new Map<string, Task>();
  private readonly runs = new Map<string, Run>();
  private readonly listeners = new Set<Listener>();
  private readonly sweep: NodeJS.Timeout;
  private closed = false;
  constructor(
    readonly artifacts: SchedulerArtifacts,
    readonly kernel: SchedulerKernel,
    readonly limits = v2Limits,
    readonly time: SchedulerClock = clock,
  ) {
    this.sweep = setInterval(() => this.expire(), Math.min(1000, limits.retentionMs));
    this.sweep.unref();
  }
  private error(status: number, code: string, message: string, stage = "schedule"): never {
    throw new TaskProtocolError(status, { code, stage, message });
  }
  accept(request: CheckRequest, scope: string, idempotency?: string) {
    if (this.closed) this.error(503, "host_closing", "Host is closing.");
    this.artifacts.authorize(request.check.url);
    const normalized: CheckRequest = {
      ...request,
      freshness: request.freshness ?? "started-after-request",
      timeoutMs: request.timeoutMs ?? this.limits.timeoutMs,
      context: request.context ?? {},
    };
    const duration = normalized.timeoutMs ?? this.limits.timeoutMs;
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > this.limits.maxTimeoutMs)
      this.error(400, "invalid_timeout", "Task timeout is out of bounds.");
    if (!["started-after-request", "completed-after-request"].includes(normalized.freshness ?? ""))
      this.error(400, "invalid_freshness", "Unknown freshness.");
    const fingerprint = canonicalJson({
      check: normalized.check,
      subject: normalized.subject,
      context: normalized.context ?? {},
      freshness: normalized.freshness ?? "",
      timeoutMs: duration,
    });
    const key = idempotency ? `${scope}\0${idempotency}` : undefined;
    this.expire();
    const existing = key ? this.keys.get(key) : undefined;
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        this.error(409, "idempotency_conflict", "Idempotency key content conflict.");
      return structuredClone(existing.snapshot);
    }
    if (this.tasks.size >= this.limits.records)
      this.error(429, "task_capacity", "Task capacity exhausted.");
    const accepted = ++this.sequence;
    const now = this.time.now();
    const taskId = randomUUID();
    const task: Task = {
      request: structuredClone(normalized),
      scope,
      fingerprint,
      accepted,
      deadline: now + duration,
      snapshot: {
        taskId,
        hostInstance: this.instance,
        revision: 1,
        state: "accepted",
        acceptedAt: this.time.date(),
        freshness: normalized.freshness ?? "started-after-request",
      },
      timer: setTimeout(() => this.deadline(task), duration),
      ...(key ? { key } : {}),
    };
    this.tasks.set(taskId, task);
    if (key) this.keys.set(key, task);
    // Admission returns before network or preparation work begins.
    queueMicrotask(() => {
      void this.prepare(task);
    });
    this.emit(task);
    return structuredClone(task.snapshot);
  }
  private async prepare(task: Task) {
    if (!this.alive(task)) return;
    this.update(task, { state: "preparing" });
    try {
      const artifact = await this.artifacts.resolve(
        task.request.check.url,
        task.request.check.digest,
      );
      if (!this.alive(task)) return;
      if (!validateCheckValue(artifact.metadata.manifest, "subject", task.request.subject))
        this.error(400, "invalid_subject", "Subject violates Check schema.", "verify");
      task.artifact = artifact;
      this.artifacts.retain(artifact.metadata.digest);
      task.snapshot.artifact = structuredClone(artifact.metadata);
      this.match(task);
    } catch (error) {
      if (!this.alive(task)) return;
      const detail =
        error instanceof TaskProtocolError
          ? error.detail
          : {
              code: "preparation_failed",
              stage: "verify",
              message: "Artifact preparation failed.",
            };
      this.finishTask(task, { state: "failed", error: detail });
    }
  }
  private compatible(task: Task) {
    return canonicalJson({
      digest: task.artifact?.metadata.digest ?? "",
      subject: task.request.subject,
      context: task.request.context ?? {},
      scope: task.scope,
      policy: "shared-observation-v2",
    });
  }
  private qualifies(task: Task, run: Run) {
    return task.snapshot.freshness === "started-after-request"
      ? (run.started ?? -1) > task.accepted
      : (run.completed ?? this.sequence + 1) > task.accepted;
  }
  private match(task: Task) {
    const key = this.compatible(task);
    for (const run of this.runs.values()) {
      if (run.key !== key || !this.qualifies(task, run)) continue;
      if (run.state === "completed" && run.result) {
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
      this.error(429, "execution_capacity", "Execution retention capacity exhausted.");
    const artifact = task.artifact;
    if (!artifact) throw new Error("Cannot execute an unresolved artifact.");
    const run: Run = { id: randomUUID(), key, artifact, tasks: new Set(), state: "reserved" };
    this.runs.set(run.id, run);
    this.artifacts.retain(artifact.metadata.digest);
    this.attach(task, run);
    // Scheduling IO cannot hold or split the synchronous matching transaction.
    void this.kernel
      .executeCheck(
        {
          checkId: run.id,
          directory: artifact.prepared.directory,
          revision: artifact.prepared.revision,
          subject: task.request.subject,
          context: task.request.context ?? {},
        },
        {
          started: () => this.start(run),
          finished: (state) => this.finishRun(run, state),
        },
      )
      .then(() => {
        if (run.state === "stopping") this.kernel.cancel(run.id);
      })
      .catch(() =>
        this.finishRun(run, {
          checkId: run.id,
          state: "Failed",
          error: "execution_admission_failed",
        }),
      );
  }
  private attach(task: Task, run: Run) {
    task.execution = run;
    run.tasks.add(task);
    this.update(task, {
      state: run.state === "running" ? "running" : "waiting",
      executionId: run.id,
      ...(run.startedAt ? { executionStartedAt: run.startedAt } : {}),
    });
  }
  private start(run: Run) {
    if (run.state !== "reserved") {
      this.kernel.cancel(run.id);
      return;
    }
    run.started = ++this.sequence;
    run.startedAt = this.time.date();
    run.state = "running";
    for (const task of [...run.tasks]) {
      if (this.alive(task))
        this.update(task, { state: "running", executionStartedAt: run.startedAt });
    }
    // Also cover resolved Tasks whose arbitration preceded this logical start.
    for (const task of this.tasks.values()) {
      if (
        !task.execution &&
        task.artifact &&
        !taskTerminal(task.snapshot) &&
        this.compatible(task) === run.key &&
        this.qualifies(task, run) &&
        this.alive(task)
      )
        this.attach(task, run);
    }
  }
  private finishRun(run: Run, result: CheckState) {
    if (run.state === "completed" || run.state === "failed") return;
    const stopped = run.state === "stopping";
    run.completed = ++this.sequence;
    run.completedAt = this.time.date();
    run.expires = this.time.now() + this.limits.retentionMs;
    if (
      !stopped &&
      result.state === "Completed" &&
      validateCheckValue(run.artifact.metadata.manifest, "result", result.result)
    ) {
      run.state = "completed";
      run.result = result;
      for (const task of [...run.tasks]) this.deliver(task, run);
    } else {
      run.state = "failed";
      const timeout = result.state === "Failed" && result.error === "execution_timeout";
      for (const task of [...run.tasks])
        if (this.alive(task))
          this.finishTask(task, {
            state: "failed",
            error: {
              code: timeout ? "execution_timeout" : "execution_failed",
              stage: "execute",
              message: timeout ? "Execution wall-clock expired." : "Execution or cleanup failed.",
            },
          });
    }
    run.tasks.clear();
  }
  private deliver(task: Task, run: Run) {
    if (!this.alive(task) || !run.result || !this.qualifies(task, run)) return;
    this.finishTask(task, {
      state: "completed",
      executionId: run.id,
      result: run.result.result,
      ...(run.startedAt ? { executionStartedAt: run.startedAt } : {}),
      ...(run.completedAt ? { executionCompletedAt: run.completedAt } : {}),
    });
  }
  private alive(task: Task) {
    if (taskTerminal(task.snapshot)) return false;
    if (this.time.now() >= task.deadline) {
      this.deadline(task);
      return false;
    }
    return true;
  }
  private deadline(task: Task) {
    if (taskTerminal(task.snapshot)) return;
    if (this.time.now() < task.deadline) {
      clearTimeout(task.timer);
      task.timer = setTimeout(
        () => this.deadline(task),
        Math.max(1, task.deadline - this.time.now()),
      );
      return;
    }
    this.finishTask(task, {
      state: "failed",
      error: {
        code: "task_timeout",
        stage: task.snapshot.state === "preparing" ? "resolve" : "schedule",
        message: "Task delivery deadline expired.",
      },
    });
  }
  private update(task: Task, patch: Partial<CheckTaskSnapshot>) {
    task.snapshot = { ...task.snapshot, ...patch, revision: task.snapshot.revision + 1 };
    this.emit(task);
  }
  private finishTask(task: Task, patch: Partial<CheckTaskSnapshot>) {
    if (taskTerminal(task.snapshot)) return;
    clearTimeout(task.timer);
    task.expires = this.time.now() + this.limits.retentionMs;
    this.update(task, patch);
    const run = task.execution;
    run?.tasks.delete(task);
    if (run && !run.tasks.size && (run.state === "running" || run.state === "reserved")) {
      run.state = "stopping";
      // The execution may still be inside kernel preparation; its continuation cancels it.
      try {
        this.kernel.cancel(run.id);
      } catch (error) {
        if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
      }
    }
  }
  private lookup(id: string, scope: string) {
    this.expire();
    const task = this.tasks.get(id);
    if (!task) this.error(404, "task_unavailable", "Task does not exist or retention expired.");
    if (task.scope !== scope) this.error(403, "task_forbidden", "Task belongs to another scope.");
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
      this.finishTask(task, {
        state: "cancelled",
        error: { code: "task_cancelled", stage: "schedule", message: "Task cancelled." },
      });
    return structuredClone(task.snapshot);
  }
  subscribe(ids: readonly string[] | undefined, scope: string, send: (event: TaskEvent) => void) {
    if (this.listeners.size >= this.limits.observers)
      this.error(429, "observer_capacity", "Observer capacity exhausted.");
    const selected = ids ? [...new Set(ids)] : undefined;
    if (selected && (!selected.length || selected.length > this.limits.filterTasks))
      this.error(400, "invalid_filter", "Task filter is empty or exceeds limit.");
    const tasks = selected
      ? selected.map((id) => this.lookup(id, scope))
      : [...this.tasks.values()].filter((task) => task.scope === scope);
    const listener: Listener = { scope, send, ...(selected ? { ids: new Set(selected) } : {}) };
    this.listeners.add(listener);
    for (const task of tasks)
      send({ taskId: task.snapshot.taskId, snapshot: structuredClone(task.snapshot) });
    return () => this.listeners.delete(listener);
  }
  private emit(task: Task) {
    for (const listener of this.listeners)
      if (
        listener.scope === task.scope &&
        (!listener.ids || listener.ids.has(task.snapshot.taskId))
      )
        listener.send({ taskId: task.snapshot.taskId, snapshot: structuredClone(task.snapshot) });
  }
  private expire() {
    const now = this.time.now();
    for (const [id, task] of this.tasks) {
      if (task.expires !== undefined && task.expires <= now) {
        this.tasks.delete(id);
        if (task.key) this.keys.delete(task.key);
        if (task.artifact) this.artifacts.release(task.artifact.metadata.digest);
        // Expiration is explicit on already-open subscriptions.
        this.update(task, {
          state: "failed",
          error: { code: "task_expired", stage: "schedule", message: "Task retention expired." },
        });
      }
    }
    for (const [id, run] of this.runs)
      if (run.expires !== undefined && run.expires <= now) {
        this.runs.delete(id);
        this.artifacts.release(run.artifact.metadata.digest);
      }
  }
  async close() {
    this.closed = true;
    clearInterval(this.sweep);
    for (const task of this.tasks.values())
      if (!taskTerminal(task.snapshot)) this.cancel(task.snapshot.taskId, task.scope);
    this.listeners.clear();
    await this.kernel.close();
  }
}
