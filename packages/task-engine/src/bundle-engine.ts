import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  at,
  type BundleCacheService,
  type Caller,
  canonical,
  type ErrorFact,
  json,
  object,
  requestTime,
  type SubmissionRecord,
  type SubmissionResult,
  TaskError,
  type TaskRequest,
  type TaskService,
  ulid,
  validateBundleReference,
} from "@potential-guide/task-protocol";
import { BundleCache, type BundleLimits } from "./bundle.js";
import { TaskEngine as Coordinator, type EngineOptions as CoordinatorOptions } from "./engine.js";

export { defaultEngineLimits, type EngineLimits } from "./engine.js";
export interface EngineOptions
  extends Omit<
    CoordinatorOptions,
    "types" | "currentVersions" | "allocationLimits" | "loadBundle"
  > {
  bundleDirectory: string;
  bundleLimits?: Partial<BundleLimits>;
  bundleConcurrency?: number;
  fetchBundle?: typeof globalThis.fetch;
}
function failure(error: unknown): ErrorFact {
  return {
    code: error instanceof TaskError ? error.code : "invalid_bundle",
    message:
      error instanceof TaskError ? error.message.slice(0, 512) : "Bundle preparation failed.",
  };
}
export class TaskEngine implements TaskService {
  private readonly core: Coordinator;
  private readonly cache: BundleCache;
  private started = false;
  private closing = false;
  private closeAttempt: Promise<void> | undefined;
  private readonly processing = new Map<string, Promise<void>>();
  private readonly waiters = new Map<string, Set<() => void>>();
  readonly getTask: TaskService["getTask"];
  readonly cancelTask: TaskService["cancelTask"];
  readonly getRun: TaskService["getRun"];
  readonly getRunLogs: Coordinator["getRunLogs"];
  readonly subscribeRunLogs: Coordinator["subscribeRunLogs"];
  readonly getTaskHistory: TaskService["getTaskHistory"];
  readonly getRunHistory: TaskService["getRunHistory"];
  readonly subscribeTask: TaskService["subscribeTask"];
  readonly subscribeRun: TaskService["subscribeRun"];
  readonly subscribeTasks: TaskService["subscribeTasks"];
  readonly subscribeRuns: TaskService["subscribeRuns"];
  readonly listTasks: TaskService["listTasks"];
  readonly listRuns: TaskService["listRuns"];
  readonly readHistory: TaskService["readHistory"];
  readonly subscribe: TaskService["subscribe"];
  readonly sendTaskMessage: TaskService["sendTaskMessage"];
  readonly getTaskMessage: TaskService["getTaskMessage"];
  readonly waitForTaskRelease: Coordinator["waitForTaskRelease"];
  readonly collect: Coordinator["collect"];
  constructor(private readonly options: EngineOptions) {
    for (const key of ["types", "currentVersions", "allocationLimits"])
      if (Object.hasOwn(options, key))
        throw new TaskError("invalid_config", "Bundle Engine does not accept a type registry.");
    this.cache = new BundleCache({
      directory: options.bundleDirectory,
      ...(options.bundleConcurrency !== undefined
        ? { concurrency: options.bundleConcurrency }
        : {}),
      ...(options.bundleLimits ? { limits: options.bundleLimits } : {}),
      ...(options.fetchBundle ? { fetch: options.fetchBundle } : {}),
    });
    this.core = new Coordinator({
      store: options.store,
      types: [],
      currentVersions: {},
      authorize: options.authorize,
      ...(options.logs ? { logs: options.logs } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.limits ? { limits: options.limits } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
      loadBundle: async (binding) => {
        const prepared = await this.cache.acquire(binding.bundle!);
        this.install(prepared);
        return prepared.release;
      },
    });
    this.getTask = this.core.getTask.bind(this.core);
    this.cancelTask = this.core.cancelTask.bind(this.core);
    this.getRun = this.core.getRun.bind(this.core);
    this.getRunLogs = this.core.getRunLogs.bind(this.core);
    this.subscribeRunLogs = this.core.subscribeRunLogs.bind(this.core);
    this.getTaskHistory = this.core.getTaskHistory.bind(this.core);
    this.getRunHistory = this.core.getRunHistory.bind(this.core);
    this.subscribeTask = this.core.subscribeTask.bind(this.core);
    this.subscribeRun = this.core.subscribeRun.bind(this.core);
    this.subscribeTasks = this.core.subscribeTasks.bind(this.core);
    this.subscribeRuns = this.core.subscribeRuns.bind(this.core);
    this.listTasks = this.core.listTasks.bind(this.core);
    this.listRuns = this.core.listRuns.bind(this.core);
    this.readHistory = this.core.readHistory.bind(this.core);
    this.subscribe = this.core.subscribe.bind(this.core);
    this.sendTaskMessage = this.core.sendTaskMessage.bind(this.core);
    this.getTaskMessage = this.core.getTaskMessage.bind(this.core);
    this.waitForTaskRelease = this.core.waitForTaskRelease.bind(this.core);
    this.collect = this.core.collect.bind(this.core);
  }
  get limits() {
    return this.core.limits;
  }
  get errors() {
    return this.core.errors;
  }
  private now(): number {
    return this.options.clock?.now() ?? Date.now();
  }
  private readable(): void {
    if (!this.started || this.closing) throw new TaskError("engine_closed", "Engine is closed.");
  }
  private install(bundle: Awaited<ReturnType<BundleCache["acquire"]>>) {
    const registration = {
      type: "bundle",
      version: bundle.digest,
      environment: "node",
      inputSchema: bundle.resolved.inputSchema,
      resultSchema: bundle.resolved.resultSchema,
      messageSchema: bundle.resolved.messageSchema,
      module: pathToFileURL(join(bundle.directory, "worker.cjs")).href,
      exportName: "unused",
      configuration: null,
      bundle: { digest: bundle.digest, declaration: bundle.resolved },
    };
    this.core.installBundle(registration);
    return registration;
  }
  async start(): Promise<void> {
    for (const record of [
      ...Object.values(this.core.facts().facts.tasks),
      ...Object.values(this.core.facts().facts.runs),
    ])
      if (!record.binding.bundle || !record.binding.declaration)
        throw new TaskError(
          "unsupported_version",
          "Legacy type facts require a separate new data domain.",
        );
    await this.core.start();
    try {
      if (this.core.facts().facts.admissionLowerBound === null) {
        const now = this.now();
        this.core.commitAdmission([
          {
            type: "window.advanced",
            scope: "",
            occurredAt: at(now),
            data: { lowerBound: now - this.limits.windowMs },
          },
        ]);
      }
    } catch (error) {
      await this.core.close();
      throw error;
    }
    this.started = true;
    for (const record of Object.values(this.core.facts().facts.submissions))
      if (record.decision.status === "preparing") this.begin(record);
  }
  private record(id: string, caller: Caller): SubmissionRecord {
    this.readable();
    this.core.authorizeAdmission(caller, "request", caller?.scope);
    const record = this.core.facts().facts.submissions[ulid(id)];
    if (!record) throw new TaskError("not_found", "Request is unavailable.");
    this.core.authorizeAdmission(caller, "request", record.caller.scope);
    return record;
  }
  private result(record: SubmissionRecord): SubmissionResult {
    if (record.resultForgotten)
      throw new TaskError("record_unavailable", "Request result retention has expired.");
    return structuredClone(record.decision);
  }
  getRequest(id: string, caller: Caller): TaskRequest {
    return structuredClone(this.record(id, caller).request);
  }
  async submit(value: unknown, caller: Caller): Promise<SubmissionResult> {
    this.readable();
    this.core.authorizeAdmission(caller, "submit", caller?.scope);
    const raw = object(json(value, this.limits.maxPayloadBytes));
    const id = ulid(raw.requestId);
    const now = this.now();
    const lower = Math.max(
      this.core.facts().facts.admissionLowerBound ?? -Number.MAX_SAFE_INTEGER,
      now - this.limits.windowMs,
    );
    if (lower !== this.core.facts().facts.admissionLowerBound)
      this.core.commitAdmission([
        { type: "window.advanced", scope: "", occurredAt: at(now), data: { lowerBound: lower } },
      ]);
    if (requestTime(id) < lower)
      throw new TaskError("request_expired", "Request ULID is before the admission floor.");
    if (requestTime(id) > now + this.limits.futureSkewMs)
      throw new TaskError("request_future", "Request ULID exceeds the permitted future skew.");
    const existing = this.core.facts().facts.submissions[id];
    if (existing) {
      this.core.authorizeAdmission(caller, "submit", existing.caller.scope);
      if (canonical(existing.request) !== canonical(raw))
        throw new TaskError("idempotency_conflict", "requestId intent changed.");
      return this.result(existing);
    }
    if (
      ["recurrence", "executionMatch"].some((key) => Object.hasOwn(raw, key)) ||
      (!Object.hasOwn(raw, "bundle") && ["type", "version"].some((key) => Object.hasOwn(raw, key)))
    )
      throw new TaskError("unsupported_request", "Legacy type/version requests are not supported.");
    const overloaded =
      Object.values(this.core.facts().facts.submissions).filter(
        (record) => record.decision.status === "preparing",
      ).length >= this.limits.maxPreparing;
    const record: SubmissionRecord = {
      request: raw as TaskRequest,
      caller: structuredClone(caller),
      arrivedAt: at(now),
      qualifiedLowerBound: lower,
      decision: { status: "preparing", requestId: id, trackingToken: id },
    };
    this.core.commitAdmission([
      { type: "submission.preparing", scope: caller.scope, occurredAt: at(now), data: { record } },
      ...(overloaded
        ? [
            {
              type: "submission.resolved" as const,
              scope: caller.scope,
              occurredAt: at(this.now()),
              data: {
                requestId: id,
                decision: {
                  status: "rejected" as const,
                  requestId: id,
                  error: {
                    code: "capacity_exceeded",
                    message: "Preparing Request capacity exceeded.",
                  },
                },
              },
            },
          ]
        : []),
    ]);
    if (overloaded) return this.result(this.core.facts().facts.submissions[id]!);
    let cached = false;
    try {
      cached = await this.cache.available(validateBundleReference(raw.bundle).digest);
    } catch (error) {
      this.reject(id, error);
      return this.result(this.core.facts().facts.submissions[id]!);
    }
    const processing = this.begin(record);
    if (cached) await processing;
    return this.result(this.core.facts().facts.submissions[id]!);
  }
  private reject(id: string, error: unknown): void {
    const current = this.core.facts().facts.submissions[id];
    if (!current || current.decision.status !== "preparing" || this.closing) return;
    this.core.commitAdmission([
      {
        type: "submission.resolved",
        scope: current.caller.scope,
        occurredAt: at(this.now()),
        data: {
          requestId: id,
          decision: { status: "rejected", requestId: id, error: failure(error) },
        },
      },
    ]);
    for (const wake of this.waiters.get(id) ?? []) wake();
  }
  private begin(record: SubmissionRecord): Promise<void> {
    const id = record.request.requestId;
    const running = this.processing.get(id);
    if (running) return running;
    const operation = Promise.resolve()
      .then(async () => {
        const prepared = await this.cache.acquire(validateBundleReference(record.request.bundle));
        try {
          if (this.closing) return;
          const current = this.core.facts().facts.submissions[id]!;
          if (current.decision.status !== "preparing") return;
          const registration = this.install(prepared);
          this.core.submit(
            { ...record.request, type: registration.type },
            record.caller,
            {},
            { registration, intent: record.request },
          );
        } finally {
          prepared.release();
        }
      })
      .catch((error) => {
        try {
          this.reject(id, error);
        } catch (failure) {
          this.options.onError?.(
            failure instanceof TaskError
              ? { code: failure.code, message: failure.message }
              : { code: "storage_failure", message: "Admission commit failed." },
          );
        }
      })
      .finally(() => {
        this.processing.delete(id);
        for (const wake of this.waiters.get(id) ?? []) wake();
      });
    this.processing.set(id, operation);
    return operation;
  }
  async getRequestStatus(
    id: string,
    options: { waitMs?: number } = {},
    caller: Caller,
  ): Promise<SubmissionResult> {
    const record = this.record(id, caller);
    const wait = options.waitMs ?? 0;
    if (
      !Number.isSafeInteger(wait) ||
      wait < 0 ||
      wait > this.limits.maxWaitMs ||
      Object.keys(options).some((key) => key !== "waitMs")
    )
      throw new TaskError("invalid_request", "waitMs exceeds the bounded observation policy.");
    if (record.decision.status !== "preparing" || wait === 0) return this.result(record);
    await new Promise<void>((resolve) => {
      const pending = this.waiters.get(id) ?? new Set<() => void>();
      const done = () => {
        clearTimeout(timer);
        pending.delete(done);
        if (!pending.size) this.waiters.delete(id);
        resolve();
      };
      const timer = setTimeout(done, wait);
      pending.add(done);
      this.waiters.set(id, pending);
    });
    return this.result(this.record(id, caller));
  }
  collectRequestResults(): number {
    this.readable();
    const ids = Object.entries(this.core.facts().facts.submissions)
      .filter(
        ([, record]) =>
          record.decision.status !== "preparing" &&
          !record.resultForgotten &&
          record.terminalAt !== undefined &&
          this.now() - Date.parse(record.terminalAt) >= this.limits.requestResultRetentionMs,
      )
      .map(([id]) => id);
    for (let offset = 0; offset < ids.length; offset += 100)
      this.core.commitAdmission([
        {
          type: "submission.results-forgotten",
          scope: "",
          occurredAt: at(this.now()),
          data: { requestIds: ids.slice(offset, offset + 100) },
        },
      ]);
    return ids.length;
  }
  tick(): void {
    this.core.tick();
  }
  async evictBundle(digest: string): Promise<boolean> {
    return this.cache.evict(digest);
  }
  private cacheAccess(caller: Caller, operation: "cache-read" | "cache-remove"): void {
    this.readable();
    if (
      !caller ||
      typeof caller.scope !== "string" ||
      !caller.scope ||
      typeof caller.subject !== "string" ||
      !caller.subject ||
      !this.options.authorize(caller, operation, caller.scope)
    )
      throw new TaskError("forbidden", "Endpoint-wide Bundle cache permission required.");
  }
  readonly listCachedBundles: BundleCacheService["listCachedBundles"] = async (page, caller) => {
    this.cacheAccess(caller, "cache-read");
    return this.cache.list(page);
  };
  readonly getCachedBundle: BundleCacheService["getCachedBundle"] = async (digest, caller) => {
    this.cacheAccess(caller, "cache-read");
    return this.cache.detail(digest);
  };
  readonly removeCachedBundle: BundleCacheService["removeCachedBundle"] = async (
    digest,
    caller,
  ) => {
    this.cacheAccess(caller, "cache-remove");
    if (!(await this.cache.evict(digest)))
      throw new TaskError("bundle_in_use", "Bundle is preparing, leased or being removed.");
  };
  close(): Promise<void> {
    if (this.closeAttempt) return this.closeAttempt;
    this.closeAttempt = this.closeInner().catch((error) => {
      this.closeAttempt = undefined;
      throw error;
    });
    return this.closeAttempt;
  }
  private async closeInner(): Promise<void> {
    this.closing = true;
    await this.cache.close();
    await Promise.allSettled([...this.processing.values()]);
    for (const pending of this.waiters.values()) for (const wake of pending) wake();
    await this.core.close();
    this.started = false;
  }
}
export function createTaskEngine(options: EngineOptions): TaskEngine {
  return new TaskEngine(options);
}
