import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { Effect, SubscriptionRef } from "@potential-guide/effects";
import { readArtifact, snapshotArtifact } from "./artifact.js";
import {
  type CheckState,
  defaults,
  type Execution,
  HostError,
  type StartCheck,
  terminal,
} from "./types.js";

type Slot = {
  worker: Worker;
  generation: string;
  pool: Pool;
  ready: boolean;
  retiring: boolean;
  tasks: number;
  job?: Job;
  owned: Set<number>;
  exited: Promise<void>;
};
type Pool = { directory: string; revision: string; snapshot: string; slots: Set<Slot> };
type Job = {
  execution: Execution;
  fingerprint: string;
  request?: StartCheck;
  pool: Pool;
  timer?: NodeJS.Timeout;
  cancellation?: NodeJS.Timeout;
  expires?: number;
  finishing: boolean;
};
export type ActiveCheck = {
  checkId: string;
  state: CheckState["state"];
  directory: string;
  revision: string;
};
const set = <T>(ref: SubscriptionRef.SubscriptionRef<T>, value: T) =>
  Effect.runSync(SubscriptionRef.set(ref, value));
const get = <T>(ref: SubscriptionRef.SubscriptionRef<T>) =>
  Effect.runSync(SubscriptionRef.get(ref));

export class CheckKernel {
  readonly limits: typeof defaults;
  readonly active: SubscriptionRef.SubscriptionRef<ActiveCheck[]>;
  readonly metrics = { initializations: 0, executions: 0, peakWorkers: 0, retirements: 0 };
  readonly workerSamples: {
    memory: NodeJS.MemoryUsage;
    resources: { timers: number; processes: number };
  }[] = [];
  private readonly pools = new Map<string, Pool>();
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private readonly slots = new Set<Slot>();
  private serial: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly sweep: NodeJS.Timeout;
  private constructor(
    private readonly snapshots: string,
    active: SubscriptionRef.SubscriptionRef<ActiveCheck[]>,
    limits: Partial<typeof defaults>,
  ) {
    this.active = active;
    this.limits = { ...defaults, ...limits };
    for (const value of Object.values(this.limits))
      if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
        throw new Error("Invalid kernel limit.");
    this.sweep = setInterval(() => this.expire(), Math.min(this.limits.retentionMs, 1000));
    this.sweep.unref();
  }
  static async create(snapshots: string, limits: Partial<typeof defaults> = {}) {
    return new CheckKernel(
      snapshots,
      await Effect.runPromise(SubscriptionRef.make<ActiveCheck[]>([])),
      limits,
    );
  }
  private exclusive<T>(use: () => Promise<T>): Promise<T> {
    const result = this.serial.then(use);
    this.serial = result.catch(() => {});
    return result;
  }
  /** This IO creates one execution. Reading its SubscriptionRef never executes user code. */
  executeCheck(request: StartCheck): Promise<Execution> {
    return this.exclusive(async () => {
      if (this.closed) throw new HostError(503, "Host is closing.");
      if (
        !/^[A-Za-z0-9:_-]{1,128}$/.test(request.checkId) ||
        !/^[a-f0-9]{64}$/.test(request.revision)
      )
        throw new HostError(400, "Invalid checkId or revision.");
      if (!request.subject || typeof request.subject !== "object" || Array.isArray(request.subject))
        throw new HostError(400, "Subject must be a JSON object.");
      const text = JSON.stringify(request);
      if (Buffer.byteLength(text) > this.limits.messageBytes)
        throw new HostError(413, "Start exceeds limit.");
      const fingerprint = createHash("sha256").update(text).digest("hex");
      const existing = this.jobs.get(request.checkId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new HostError(409, "checkId content conflict.");
        return existing.execution;
      }
      this.expire();
      if (this.jobs.size >= this.limits.records || this.queue.length >= this.limits.queue)
        throw new HostError(429, "Check capacity exhausted.");
      const artifact = await readArtifact(request.directory);
      if (artifact.revision !== request.revision)
        throw new HostError(409, "Artifact revision mismatch.");
      let pool = this.pools.get(artifact.directory);
      if (pool && pool.revision !== artifact.revision) {
        if (
          [...this.jobs.values()].some(
            (job) => job.pool === pool && !terminal(get(job.execution.state)),
          )
        )
          throw new HostError(409, "Directory revision is busy; drain before switching.");
        await Promise.all([...pool.slots].map((slot) => this.retire(slot)));
        await rm(pool.snapshot, { recursive: true, force: true });
        this.pools.delete(pool.directory);
        pool = undefined;
      }
      if (!pool) {
        if (this.pools.size >= this.limits.directories) {
          const unused = [...this.pools.values()].find(
            (candidate) =>
              ![...this.jobs.values()].some(
                (job) => job.pool === candidate && !terminal(get(job.execution.state)),
              ),
          );
          if (!unused) throw new HostError(429, "Artifact capacity exhausted.");
          await Promise.all([...unused.slots].map((slot) => this.retire(slot)));
          await rm(unused.snapshot, { recursive: true, force: true });
          this.pools.delete(unused.directory);
        }
        pool = {
          directory: artifact.directory,
          revision: artifact.revision,
          snapshot: await snapshotArtifact(artifact, this.snapshots),
          slots: new Set(),
        };
        this.pools.set(pool.directory, pool);
      }
      const execution = {
        checkId: request.checkId,
        state: await Effect.runPromise(
          SubscriptionRef.make<CheckState>({ checkId: request.checkId, state: "Queued" }),
        ),
      };
      const job: Job = {
        execution,
        fingerprint,
        request: structuredClone(request),
        pool,
        finishing: false,
      };
      this.jobs.set(request.checkId, job);
      this.queue.push(job);
      job.timer = setTimeout(() => this.cancel(request.checkId), this.limits.deadlineMs);
      this.publish();
      this.schedule();
      return execution;
    });
  }
  observe(checkId: string): Execution {
    this.expire();
    const job = this.jobs.get(checkId);
    if (!job) throw new HostError(404, "Unknown or expired checkId.");
    return job.execution;
  }
  sample(checkId: string): CheckState {
    return get(this.observe(checkId).state);
  }
  cancel(checkId: string): CheckState {
    const job = this.jobs.get(checkId);
    if (!job) throw new HostError(404, "Unknown or expired checkId.");
    const state = get(job.execution.state);
    if (terminal(state) || state.state === "Cancelling") return state;
    this.transition(job, { checkId, state: "Cancelling" });
    const index = this.queue.indexOf(job);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.finish(job, { checkId, state: "Cancelled" });
    } else {
      const slot = [...job.pool.slots].find((entry) => entry.job === job);
      if (slot) {
        this.send(slot, "cancel", { checkId });
        job.cancellation = setTimeout(() => {
          void this.breakSlot(slot, "Cancellation cleanup deadline exceeded.");
        }, this.limits.cleanupMs);
      }
    }
    return get(job.execution.state);
  }
  private transition(job: Job, state: CheckState) {
    if (terminal(get(job.execution.state))) return;
    set(job.execution.state, state);
    this.publish();
  }
  private finish(job: Job, state: CheckState) {
    clearTimeout(job.timer);
    clearTimeout(job.cancellation);
    delete job.request;
    job.expires = Date.now() + this.limits.retentionMs;
    this.transition(job, state);
  }
  private publish() {
    set(
      this.active,
      [...this.jobs.values()].flatMap((job) => {
        const state = get(job.execution.state);
        return terminal(state)
          ? []
          : [
              {
                checkId: state.checkId,
                state: state.state,
                directory: job.pool.directory,
                revision: job.pool.revision,
              },
            ];
      }),
    );
  }
  private expire() {
    for (const [id, job] of this.jobs)
      if (job.expires !== undefined && job.expires <= Date.now()) this.jobs.delete(id);
  }
  private send(slot: Slot, type: string, fields: Record<string, unknown> = {}) {
    slot.worker.postMessage({ version: 1, generation: slot.generation, type, ...fields });
  }
  private spawn(pool: Pool): Slot {
    const generation = randomUUID();
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      execArgv: [],
      env: { ...process.env, NODE_OPTIONS: "" },
      workerData: {
        entry: join(pool.snapshot, "worker.cjs"),
        generation,
        messageBytes: this.limits.messageBytes,
      },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
      stdout: true,
      stderr: true,
    });
    // Logs are not a shared cross-request evidence channel.
    worker.stdout.resume();
    worker.stderr.resume();
    let exit!: () => void;
    const slot: Slot = {
      worker,
      generation,
      pool,
      ready: false,
      retiring: false,
      tasks: 0,
      owned: new Set(),
      exited: new Promise((resolve) => {
        exit = resolve;
      }),
    };
    pool.slots.add(slot);
    this.slots.add(slot);
    this.metrics.initializations++;
    this.metrics.peakWorkers = Math.max(this.metrics.peakWorkers, this.slots.size);
    const startup = setTimeout(() => {
      void this.breakSlot(slot, "Worker initialization timed out.");
    }, this.limits.cleanupMs);
    worker.on("message", (message) => {
      if (message.version !== 1 || message.generation !== generation) return;
      if (Buffer.byteLength(JSON.stringify(message)) > this.limits.messageBytes) {
        void this.breakSlot(slot, "Worker message exceeds limit.");
        return;
      }
      if (message.type === "ready") {
        clearTimeout(startup);
        slot.ready = true;
        this.schedule();
        return;
      }
      if (message.type === "initialization-failed") {
        clearTimeout(startup);
        for (const job of this.queue.filter((item) => item.pool === pool)) {
          this.queue.splice(this.queue.indexOf(job), 1);
          this.finish(job, {
            checkId: job.execution.checkId,
            state: "Failed",
            error: message.error,
          });
        }
        void this.breakSlot(slot, message.error);
        return;
      }
      const job = slot.job;
      if (!job || message.checkId !== job.execution.checkId) return;
      if (message.type === "owned") {
        if (!Number.isSafeInteger(message.pid) || message.pid <= 0 || message.pid === process.pid) {
          void this.breakSlot(slot, "Invalid owned-process identity.");
          return;
        }
        slot.owned.add(message.pid);
      }
      if (message.type === "released") slot.owned.delete(message.pid);
      if (message.type === "progress" && get(job.execution.state).state === "Running")
        this.transition(job, {
          checkId: job.execution.checkId,
          state: "Running",
          progress: message.value,
        });
      if (message.type === "done" && !job.finishing) {
        this.workerSamples.push({ memory: message.memory, resources: message.resources });
        if (this.workerSamples.length > 64) this.workerSamples.shift();
        job.finishing = true;
        if (!message.clean || slot.owned.size) {
          void this.breakSlot(slot, message.error ?? "Worker cleanup failed.");
          return;
        }
        this.finish(
          job,
          message.error && !message.cancelled
            ? { checkId: job.execution.checkId, state: "Failed", error: message.error }
            : message.cancelled
              ? { checkId: job.execution.checkId, state: "Cancelled" }
              : { checkId: job.execution.checkId, state: "Completed", result: message.result },
        );
        delete slot.job;
        slot.tasks++;
        if (slot.tasks >= this.limits.retireAfter)
          void this.retire(slot).then(() => this.schedule());
        else {
          if (
            slot.tasks === Math.max(1, this.limits.retireAfter - 1) &&
            this.slots.size < this.limits.workers &&
            pool.slots.size === 1
          )
            this.spawn(pool);
          this.schedule();
        }
      }
    });
    worker.on("error", (error) => {
      void this.breakSlot(slot, String(error));
    });
    worker.once("exit", () => {
      clearTimeout(startup);
      exit();
      pool.slots.delete(slot);
      this.slots.delete(slot);
      if (slot.job) void this.breakSlot(slot, "Worker exited before cleanup confirmation.");
      this.schedule();
    });
    return slot;
  }
  private schedule() {
    if (this.closed) return;
    for (const job of [...this.queue]) {
      const slot = [...job.pool.slots].find(
        (candidate) => candidate.ready && !candidate.retiring && !candidate.job,
      );
      if (!slot) {
        const starting = [...job.pool.slots].some(
          (candidate) => !candidate.ready && !candidate.retiring,
        );
        if (!starting && this.slots.size < this.limits.workers) this.spawn(job.pool);
        else if (!starting) {
          const unused = [...this.slots].find(
            (candidate) =>
              candidate.pool !== job.pool &&
              candidate.ready &&
              !candidate.retiring &&
              !candidate.job &&
              !this.queue.some((queued) => queued.pool === candidate.pool),
          );
          if (unused) void this.retire(unused).then(() => this.schedule());
        }
        continue;
      }
      this.queue.splice(this.queue.indexOf(job), 1);
      slot.job = job;
      this.metrics.executions++;
      this.transition(job, { checkId: job.execution.checkId, state: "Running" });
      this.send(slot, "execute", {
        checkId: job.execution.checkId,
        subject: job.request?.subject,
        context: job.request?.context,
        deadline: Date.now() + this.limits.deadlineMs,
      });
    }
  }
  private async cleanChildren(slot: Slot) {
    for (const pid of [...slot.owned]) {
      if (process.platform === "win32") {
        try {
          await promisify(execFile)("taskkill", ["/PID", String(pid), "/T", "/F"], {
            windowsHide: true,
            timeout: this.limits.cleanupMs,
          });
        } catch (error) {
          try {
            process.kill(pid, 0);
          } catch {
            continue;
          }
          throw error;
        }
      } else {
        try {
          process.kill(-pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      const deadline = performance.now() + this.limits.cleanupMs;
      for (;;) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          break;
        }
        if (performance.now() >= deadline)
          throw new Error(`Owned process ${pid} did not exit during bounded cleanup.`);
        await delay(10);
      }
      slot.owned.delete(pid);
    }
  }
  private async breakSlot(slot: Slot, reason: string) {
    if (slot.retiring) return;
    slot.retiring = true;
    if (!slot.job) {
      for (const job of this.queue.filter((candidate) => candidate.pool === slot.pool)) {
        this.queue.splice(this.queue.indexOf(job), 1);
        this.finish(job, { checkId: job.execution.checkId, state: "Failed", error: reason });
      }
    }
    let failure = reason;
    try {
      await this.cleanChildren(slot);
    } catch (error) {
      failure += ` Owned-process cleanup unconfirmed: ${String(error)}`;
    }
    await slot.worker.terminate();
    await slot.exited;
    if (slot.job) {
      this.finish(slot.job, {
        checkId: slot.job.execution.checkId,
        state: "Failed",
        error: failure,
      });
      delete slot.job;
    }
    this.schedule();
  }
  private async retire(slot: Slot) {
    if (slot.retiring) {
      await slot.exited;
      return;
    }
    slot.retiring = true;
    this.metrics.retirements++;
    this.send(slot, "dispose");
    const timer = setTimeout(() => {
      void slot.worker.terminate();
    }, this.limits.cleanupMs);
    await slot.exited;
    clearTimeout(timer);
  }
  diagnostics() {
    return {
      ...this.metrics,
      workers: this.slots.size,
      queue: this.queue.length,
      records: this.jobs.size,
      ownedProcesses: [...this.slots].reduce((n, slot) => n + slot.owned.size, 0),
    };
  }
  async close() {
    this.closed = true;
    clearInterval(this.sweep);
    await this.serial;
    for (const job of this.jobs.values())
      if (!terminal(get(job.execution.state))) this.cancel(job.execution.checkId);
    await Promise.all(
      [...this.slots].map((slot) =>
        slot.job ? this.breakSlot(slot, "Host shutdown.") : this.retire(slot),
      ),
    );
    for (const pool of this.pools.values())
      await rm(pool.snapshot, { recursive: true, force: true });
    this.jobs.clear();
    this.pools.clear();
    this.queue.length = 0;
    this.publish();
  }
}
