import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import {
  type ArtifactReference,
  canonicalJson,
  inspectContractFiles,
  type JsonObject,
} from "@potential-guide/check-artifacts/contracts";
import {
  type ObservationEffect,
  observationDefaults,
  prepareObjective,
} from "@potential-guide/check-artifacts/observation";
import type { ArtifactSource } from "@potential-guide/check-task";
import { newId } from "@potential-guide/task-engine/identity";
import { createExecutorPool, type RunningWork } from "@potential-guide/task-engine/pool";
import {
  authorizeSync,
  type BundleReference,
  bundleCid,
  type Caller,
  type ExecuteOptions,
  isTimedOut,
  type Json,
  json,
  type PreparationOptions,
  positive,
  RunFailure,
  type RunTracking,
  type StartPermit,
  type SubmissionResult,
  TaskError,
  type TaskService,
  type TaskSnapshot,
  type TaskType,
} from "@potential-guide/task-protocol";
import {
  decodePrepared,
  encodeObjective,
  type ProbeEffectEvidence,
  type ProbeInput,
  type ProbePolicy,
  type ProbePrepared,
  type ProbeResult,
  probeInputSchema,
  probeResultSchema,
  replayResult,
  validateProbeConsistency,
  validateProbeInput,
  validateProbeResult,
} from "./contracts.js";
import { runtimeRevision } from "./runtime-identity.js";
import { workerSource } from "./worker-source.js";

export type { ProbeEffectEvidence, ProbeInput, ProbePrepared, ProbeResult } from "./contracts.js";
export { probeInputSchema, validateProbeInput } from "./contracts.js";

export interface ChildTaskPort {
  service: {
    [K in
      | "submit"
      | "getRequestStatus"
      | "getTask"
      | "cancelTask"
      | "readHistory"
      | "getRun"
      | "getRunHistory"]: (
      ...args: Parameters<TaskService[K]>
    ) => ReturnType<TaskService[K]> | Promise<ReturnType<TaskService[K]>>;
  };
  caller: Caller;
  /** Engine-owned barrier: cancelled shared owners detach without killing other owners. */
  waitForTaskRelease(taskId: string, caller: Caller): Promise<void>;
}
type Configuration = Omit<ProbeTaskOptions, "source" | "children">;
interface Resources {
  invoke(context: object, action: string, value: Json): Promise<Json>;
}
export function createIsolatedProbe(
  configuration: Configuration,
  resources: Resources,
): TaskType<ProbeInput, Json> & { environment: string } {
  const identities = new WeakMap<AbortSignal, object>();
  const contexts = new Map<string, { context: object; caller: Caller }>();
  const implementation = createProbeImplementation(
    {
      ...configuration,
      source: {
        authorize() {},
        async resolve(reference, _scope, signal) {
          const id = identities.get(signal);
          if (!id) throw new TaskError("forbidden", "资源请求缺少当前 Run。");
          const response = (await resources.invoke(id, "resolve", json(reference))) as JsonObject;
          const files = response.files as Record<string, string>;
          return inspectContractFiles(
            new Map(
              Object.entries(files).map(([path, bytes]) => [path, Buffer.from(bytes, "base64")]),
            ),
          );
        },
      },
      children(scope, runId) {
        const current = runId ? contexts.get(runId) : undefined;
        if (!current || current.caller.scope !== scope)
          throw new TaskError("forbidden", "缺少当前 Run 子需求路由。");
        const invoke = (action: string, value: Json) =>
          resources.invoke(current.context, action, value);
        return {
          caller: current.caller,
          service: {
            submit: (request) =>
              invoke("child-submit", json(request)) as unknown as Promise<SubmissionResult>,
            getRequestStatus: (requestId, options) =>
              invoke("child-status", {
                requestId,
                ...options,
              }) as unknown as Promise<SubmissionResult>,
            getTask: (taskId) =>
              invoke("child-get", { taskId }) as unknown as Promise<TaskSnapshot>,
            cancelTask: (taskId) =>
              invoke("child-cancel", { taskId }) as unknown as Promise<
                ReturnType<TaskService["cancelTask"]>
              >,
            readHistory: (filter, page) =>
              invoke("child-history", {
                taskId: "taskId" in filter ? filter.taskId : "",
                page: json(page),
              }) as never,
            getRun: (runId) =>
              invoke("child-run", { runId }) as unknown as Promise<
                ReturnType<TaskService["getRun"]>
              >,
            getRunHistory: (runId, page) =>
              invoke("child-run-history", { runId, page: json(page) }) as unknown as Promise<
                ReturnType<TaskService["getRunHistory"]>
              >,
          },
          waitForTaskRelease: async (taskId) => {
            await invoke("child-release", { taskId });
          },
        };
      },
    },
    (runId, signal) => {
      const current = contexts.get(runId);
      if (current) identities.set(signal, current.context);
    },
  );
  return {
    environment: implementation.environment,
    type: implementation.type,
    version: implementation.version,
    inputSchema: implementation.inputSchema,
    resultSchema: probeResultSchema,
    messageSchema: false,
    async run(input, context) {
      identities.set(context.signal, context);
      let prepared: ProbePrepared | undefined;
      const trace: Json[] = [];
      let released = false;
      try {
        const identity = (await resources.invoke(context, "identity", null)) as JsonObject;
        const caller = (await resources.invoke(
          context,
          "child-identity",
          null,
        )) as unknown as Caller;
        contexts.set(context.runId, { context, caller });
        await context.progress({
          stage: "preparation",
          message: "准备 Objective 与 Checker Bundle。",
        });
        prepared = await implementation.prepare(input, {
          signal: context.signal,
          deadlineAt: new Date(Date.now() + (configuration.wallMs ?? 60_000)).toISOString(),
          context: {
            type: "probe",
            version: configuration.version ?? "3",
            environment: implementation.environment,
            scope: context.scope,
          },
        });
        await context.checkpoint({
          kind: "probe-prepared",
          prepared: json(prepared, 96 * 1024 * 1024),
        });
        await context.progress({ stage: "allocation", message: "等待 Probe 执行资源。" });
        await resources.invoke(context, "authorize", json(prepared.root.reference));
        let result: unknown,
          failure: unknown,
          progress = Promise.resolve();
        const tracking = await implementation.execute(prepared, {
          signal: context.signal,
          context: {
            type: "probe",
            version: configuration.version ?? "3",
            environment: implementation.environment,
            scope: context.scope,
          },
          authorizeReplacement: () => false,
          start: () => {
            return {
              runId: context.runId,
              generation: String(identity.generation),
              startedAt: String(identity.startedAt),
              progress: (value) => {
                if (trace.length >= 1024)
                  throw new TaskError("capacity_exceeded", "Probe 证据容量已满。");
                trace.push(json(value, 96 * 1024 * 1024));
                progress = progress.then(async () => {
                  await context.checkpoint({
                    kind: "probe-progress",
                    progress: json(value, 96 * 1024 * 1024),
                  });
                  await context.progress({ stage: "execution", message: "Probe 执行中。" });
                });
                void progress.catch(() => {});
              },
              complete: (value) => {
                result = value;
              },
              fail: (error) => {
                failure = new TaskError(error.code, error.message);
              },
            };
          },
        });
        const abort = () => {
          void tracking.reclaim("run_canceled").catch(() => {});
        };
        context.signal.addEventListener("abort", abort, { once: true });
        try {
          if (context.signal.aborted) abort();
          await tracking.finished;
          released = true;
          await progress;
          if (failure) throw failure;
          const value = result as ProbeResult;
          value.evidence.prepared = prepared;
          return verifyIsolatedProbe(configuration, json(value, 96 * 1024 * 1024));
        } finally {
          context.signal.removeEventListener("abort", abort);
        }
      } catch (error) {
        const failure = {
          code: error instanceof TaskError ? error.code : "probe_failed",
          message: error instanceof Error ? error.message : "Probe 失败。",
        };
        throw new RunFailure(
          failure.code,
          failure.message,
          json(
            { failure, evidence: { ...(prepared ? { prepared } : {}), trace } },
            96 * 1024 * 1024,
          ),
        );
      } finally {
        if (released) await resources.invoke(context, "run-dispose", null);
        identities.delete(context.signal);
        contexts.delete(context.runId);
      }
    },
  };
}
export async function verifyIsolatedProbe(
  configuration: Configuration,
  value: unknown,
  mode = "historical",
): Promise<Json> {
  const implementation = createProbeImplementation({
    ...configuration,
    source: {
      authorize() {},
      async resolve() {
        throw new Error("历史复验不执行资源 IO。");
      },
    },
    children() {
      throw new Error("历史复验不创建子需求。");
    },
  });
  try {
    if (value && typeof value === "object" && Object.hasOwn(value, "kind")) {
      const record = value as { kind: string; prepared?: unknown; progress?: unknown };
      if (mode === "terminal")
        throw new TaskError("invalid_probe", "checkpoint 不能充当最终 Result。");
      if (record.kind === "probe-prepared") implementation.validatePrepared(record.prepared);
      else if (record.kind === "probe-progress") implementation.validateProgress(record.progress);
      else throw new TaskError("invalid_probe", "未知 Probe checkpoint。");
      return json(value, 96 * 1024 * 1024);
    }
    if (value && typeof value === "object" && Object.hasOwn(value, "failure")) {
      const result = value as {
        failure: { code: string; message: string };
        evidence: { prepared?: unknown; trace: Json[] };
      };
      if (
        typeof result.failure.code !== "string" ||
        typeof result.failure.message !== "string" ||
        !Array.isArray(result.evidence.trace)
      )
        throw new TaskError("invalid_probe", "失败证据格式无效。");
      if (result.evidence.prepared !== undefined)
        implementation.validatePrepared(result.evidence.prepared);
      return json(value, 96 * 1024 * 1024);
    }
    const result = value as ProbeResult;
    implementation.validateExecutionResult(
      result,
      implementation.validatePrepared(result.evidence.prepared),
    );
    return json(value, 96 * 1024 * 1024);
  } finally {
    await implementation.close();
  }
}
export interface ProbeTaskOptions {
  checkBundle?: BundleReference;
  source: ArtifactSource;
  checkEnvironment: string;
  /** Trusted scoped authority. Never populated from the request body. */
  children(scope: string, runId?: string): ChildTaskPort;
  version?: string;
  languages?: readonly string[];
  parents?: number;
  maxQueue?: number;
  wallMs?: number;
  cleanupMs?: number;
  maxDepth?: number;
  maxObservations?: number;
  maxChecks?: number;
}
interface ProbeImplementation {
  type: string;
  version: string;
  environment: string;
  inputSchema: typeof probeInputSchema;
  prepare(input: ProbeInput, options: PreparationOptions): Promise<ProbePrepared>;
  validatePrepared(value: unknown): ProbePrepared;
  validateResult(value: unknown): Json;
  validateExecutionResult(value: unknown, prepared: ProbePrepared): Json;
  validateProgress(value: unknown): Json;
  execute(prepared: ProbePrepared, options: ExecuteOptions): Promise<RunTracking>;
}
export function createProbeImplementation(
  options: ProbeTaskOptions,
  bindSignal?: (runId: string, signal: AbortSignal) => void,
): ProbeImplementation & {
  close(): Promise<void>;
  readonly diagnostics: { queued: number; idle: number; running: number; quarantined: number };
} {
  const parents = positive(options.parents ?? 4, "parents");
  if (parents > 128) throw new TaskError("invalid_config", "At most 128 Probe parents.");
  const wallMs = positive(options.wallMs ?? 60_000, "wallMs");
  const cleanupMs = positive(options.cleanupMs ?? 5_000, "cleanupMs");
  const policy: ProbePolicy = {
    languages: [...(options.languages ?? ["en"])],
    checkEnvironment: options.checkEnvironment,
    maxDepth: positive(options.maxDepth ?? observationDefaults.maxDepth, "maxDepth"),
    maxObservations: positive(
      options.maxObservations ?? observationDefaults.maxObservations,
      "maxObservations",
    ),
    maxChecks: positive(options.maxChecks ?? observationDefaults.maxChecks, "maxChecks"),
  };
  if (
    !policy.checkEnvironment ||
    policy.maxDepth > 32 ||
    policy.maxObservations > 256 ||
    policy.maxChecks > 512
  )
    throw new TaskError("invalid_config", "Invalid bounded Probe policy.");
  const environment = canonicalJson({
    adapter: "objective-observation-v1",
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    wallMs,
    policy: json(policy),
    revision: runtimeRevision,
  });
  const validatePrepared = (value: unknown) => {
    decodePrepared(value as ProbePrepared, environment, policy);
    return value as ProbePrepared;
  };
  const prepare = async (
    reference: ArtifactReference,
    scope: string,
    signal: AbortSignal,
    language?: string,
  ) =>
    prepareObjective(
      reference,
      async (ref) => {
        signal.throwIfAborted();
        authorizeSync(() => options.source.authorize(ref, scope));
        const artifact = await options.source.resolve(ref, scope, signal);
        signal.throwIfAborted();
        return artifact;
      },
      policy.languages,
      language,
    );
  const pool = createExecutorPool<ProbePrepared>({
    resources: Array.from({ length: parents }, () => environment),
    resourceKey: () => environment,
    maxQueue: options.maxQueue ?? 128,
    graceMs: 10,
    reclaimMs: cleanupMs,
    run(prepared, permit, context) {
      return run(prepared, permit, context);
    },
  });
  function run(
    prepared: ProbePrepared,
    permit: StartPermit,
    context: ExecuteOptions["context"],
  ): RunningWork {
    const port = options.children(context.scope, permit.runId);
    if (port.caller.scope !== context.scope || !port.caller.subject)
      throw new TaskError("forbidden", "Injected child caller must retain the parent scope.");
    const controller = new AbortController();
    bindSignal?.(permit.runId, controller.signal);
    const owned = new Set<string>();
    const pending = new Set<Promise<void>>();
    const deadline = performance.now() + wallMs;
    const worker = new Worker(workerSource, {
      eval: true,
      execArgv: [],
      env: { NODE_OPTIONS: "" },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
      workerData: {
        prepared,
        policy,
        runId: permit.runId,
        startedAt: permit.startedAt,
      },
    });
    let response: unknown;
    let failure: unknown;
    let hasResult = false;
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    let termination: Promise<void> | undefined;
    const stop = () => {
      controller.abort();
      termination ??= worker.terminate().then(() => exited);
      return termination;
    };
    const timer = setTimeout(() => {
      failure = new TaskError("probe_wall_limit", "Probe run wall budget exhausted.");
      void stop();
    }, wallMs);
    const cleanup = async () => {
      for (const id of owned) {
        try {
          await port.service.cancelTask(id, port.caller);
        } catch (error) {
          if (
            !(error instanceof TaskError) ||
            !["task_finished", "engine_closed"].includes(error.code)
          )
            throw error;
        }
      }
      await Promise.all([...owned].map((id) => port.waitForTaskRelease(id, port.caller)));
      await Promise.all([...pending]);
      owned.clear();
    };
    let cleaning: Promise<void> | undefined;
    const release = () => (cleaning ??= cleanup());
    const progress = (value: unknown) =>
      permit.progress({
        parentRunId: permit.runId,
        environment,
        progress: value,
      });
    const effect = async (request: ObservationEffect): Promise<ProbeEffectEvidence> => {
      controller.signal.throwIfAborted();
      if (request.kind === "resolve") {
        const content = encodeObjective(
          await prepare(
            request.reference,
            context.scope,
            controller.signal,
            prepared.root.language,
          ),
          request.reference.url,
        );
        progress({ kind: "selection", request, content });
        return { request, content };
      }
      const remaining = Math.floor(deadline - performance.now());
      if (remaining < 1) throw new TaskError("probe_wall_limit", "No child time budget remains.");
      let decision = await port.service.submit(
        {
          requestId: newId(),
          ...(options.checkBundle ? { bundle: options.checkBundle } : { type: "check" }),
          checker: request.reference,
          subject: request.subject,
          context: request.context,
          language: request.language,
          matchPolicy: "starts-after-eligible",
          timeoutMs: remaining,
        },
        port.caller,
      );
      while (decision.status === "preparing") {
        await delay(5);
        decision = await port.service.getRequestStatus(decision.requestId, {}, port.caller);
      }
      if (decision.status === "rejected")
        throw new TaskError(decision.error.code, decision.error.message);
      const initial = await port.service.getTask(decision.taskId, port.caller);
      owned.add(initial.taskId);
      progress({ kind: "child", request, taskId: initial.taskId });
      let snapshot: TaskSnapshot = initial;
      let started = false;
      while (!snapshot.termination && !snapshot.canceledAt && !isTimedOut(snapshot)) {
        await delay(5, undefined, { signal: controller.signal });
        snapshot = await port.service.getTask(initial.taskId, port.caller);
        if (snapshot.run && !started) {
          started = true;
          progress({ kind: "child.started", request, snapshot });
        }
      }
      if (snapshot.stage !== "completed" || !snapshot.run?.completedAt || !snapshot.result)
        throw new TaskError(
          "probe_child_failed",
          `Child ${snapshot.taskId}: ${snapshot.error?.code ?? snapshot.stage}.`,
        );
      // Check the actual committed child runtime, not a caller-declared label.
      const runSnapshot = await port.service.getRun(snapshot.run.runId, port.caller);
      if (
        runSnapshot.runId !== snapshot.run.runId ||
        (options.checkBundle
          ? !runSnapshot.bundle || bundleCid(runSnapshot.bundle) !== bundleCid(options.checkBundle)
          : runSnapshot.type !== "check") ||
        runSnapshot.stage !== "completed" ||
        runSnapshot.dataDomain !== snapshot.dataDomain ||
        runSnapshot.result === undefined ||
        canonicalJson(runSnapshot.result) !== canonicalJson(snapshot.result)
      )
        throw new TaskError("invalid_probe", "Child Task and independent Run evidence differ.");
      let cursor: string | undefined;
      let actual: string | undefined;
      do {
        const page = await port.service.getRunHistory(
          snapshot.run.runId,
          cursor ? { cursor } : {},
          port.caller,
        );
        for (const event of page.events)
          if (event.type === "run.started" && event.runId === snapshot.run.runId) {
            const run = (
              event.data as { run?: { runId?: string; binding?: { environment?: string } } }
            ).run;
            if (run?.runId === snapshot.run.runId) actual = run.binding?.environment;
          }
        cursor = page.next;
      } while (cursor);
      if (options.checkBundle)
        actual = runSnapshot.bundle ? bundleCid(runSnapshot.bundle) : undefined;
      if (
        actual !== policy.checkEnvironment ||
        (!options.checkBundle && actual !== runSnapshot.environment)
      )
        throw new TaskError(
          "unsupported_environment",
          "Child Check runtime differs from prepared Probe.",
        );
      await port.waitForTaskRelease(initial.taskId, port.caller);
      owned.delete(initial.taskId);
      const entry = { request, snapshot, environment: actual };
      progress({ kind: "child.completed", ...entry });
      return entry;
    };
    let busy = false;
    worker.on("message", (message) => {
      if (controller.signal.aborted) return;
      if (message.kind === "progress") {
        try {
          progress(message.value);
        } catch (error) {
          failure = error;
          void stop();
        }
        return;
      }
      if (message.kind === "result") {
        if (
          message.value?.evidence?.parentRunId !== permit.runId ||
          message.value?.evidence?.startedAt !== permit.startedAt
        ) {
          failure = new Error("Parent run identity differs.");
          void stop();
        } else {
          response = message.value;
          hasResult = true;
        }
        return;
      }
      if (message.kind !== "effect" || busy) {
        failure = new Error("Invalid observation worker protocol.");
        void stop();
        return;
      }
      busy = true;
      const operation = effect(message.value)
        .then((entry) => {
          if (!controller.signal.aborted) worker.postMessage(entry);
        })
        .catch((error) => {
          failure ??= error;
          void stop();
        })
        .finally(() => {
          busy = false;
          pending.delete(operation);
        });
      pending.add(operation);
    });
    worker.on("error", (error) => {
      failure ??= error;
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !hasResult)
        failure ??= new Error("Probe interrupted before confirmed root exit.");
      resolveExit();
    });
    const result = exited.then(async () => {
      controller.abort();
      await release();
      if (failure) throw failure;
      return response;
    });
    return {
      result,
      exited,
      cooperate: () => {
        void stop();
      },
      force: stop,
      cleanup: release,
    };
  }
  return {
    type: "probe",
    version: options.version ?? "2",
    environment,
    inputSchema: probeInputSchema,
    async prepare(input, context) {
      validateProbeInput(input);
      validateProbeConsistency(input);
      if (!context.context)
        throw new TaskError("invalid_config", "Trusted preparation context required.");
      const scope = context.context.scope;
      for (const [url, digest] of Object.entries(input.bindings ?? {}))
        authorizeSync(() => options.source.authorize({ kind: "objective", url, digest }, scope));
      const digest = input.bindings?.[input.objective.url] ?? input.objective.digest;
      const root = await prepare(
        { ...input.objective, ...(digest ? { digest } : {}) },
        scope,
        context.signal,
        input.language,
      );
      return validatePrepared({
        input,
        root: encodeObjective(root, input.objective.url),
        environment,
      });
    },
    validatePrepared,
    validateResult: validateProbeResult,
    validateExecutionResult: (value, prepared) =>
      replayResult(value, prepared, environment, policy),
    validateProgress: (value) => json(value, 96 * 1024 * 1024),
    async execute(prepared, context) {
      const root = decodePrepared(prepared, environment, policy);
      authorizeSync(() => options.source.authorize(prepared.root.reference, context.context.scope));
      for (const binding of Object.values(root.artifact.manifest.checkers))
        authorizeSync(() =>
          options.source.authorize(
            { kind: "checker", url: binding.url, digest: binding.digest },
            context.context.scope,
          ),
        );
      context.signal.throwIfAborted();
      return pool.execute(prepared, context);
    },
    close: () => pool.close(),
    get diagnostics() {
      return pool.stats;
    },
  };
}
