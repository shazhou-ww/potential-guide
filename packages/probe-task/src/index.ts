import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { type ArtifactReference, canonicalJson } from "@potential-guide/check-artifacts/contracts";
import {
  type ObservationEffect,
  observationDefaults,
  prepareObjective,
} from "@potential-guide/check-artifacts/observation";
import type { ArtifactSource } from "@potential-guide/check-task";
import { newId } from "@potential-guide/task-engine";
import { createExecutorPool, type RunningWork } from "@potential-guide/task-engine/pool";
import {
  authorizeSync,
  type Caller,
  type ExecuteOptions,
  isTimedOut,
  json,
  positive,
  type StartPermit,
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
  probeResultReferences,
  replayResult,
  validateProbeInput,
  validateProbeConsistency,
  probeInputSchema,
  validateProbeResult,
} from "./contracts.js";
export type { ProbeInput, ProbePrepared, ProbeResult, ProbeEffectEvidence } from "./contracts.js";
export { validateProbeInput, probeInputSchema } from "./contracts.js";

export interface ChildTaskPort {
  service: Pick<TaskService, "submit" | "getTask" | "cancelTask" | "readHistory">;
  caller: Caller;
  /** Engine-owned barrier: cancelled shared owners detach without killing other owners. */
  waitForTaskRelease(taskId: string, caller: Caller): Promise<void>;
}
export interface ProbeTaskOptions {
  source: ArtifactSource;
  checkEnvironment: string;
  /** Trusted scoped authority. Never populated from the request body. */
  children(scope: string): ChildTaskPort;
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
export function createProbeTaskType(options: ProbeTaskOptions): TaskType<
  ProbeInput,
  ProbePrepared
> & {
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
  const workerUrl = new URL(
    import.meta.url.endsWith(".ts") ? "../dist/worker.js" : "./worker.js",
    import.meta.url,
  );
  const environment = canonicalJson({
    adapter: "objective-observation-v1",
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    wallMs,
    policy: json(policy),
    revision: createHash("sha256")
      .update(readFileSync(new URL(import.meta.url)))
      .update(readFileSync(workerUrl))
      .update(readFileSync(new URL("./contracts.js", workerUrl)))
      .update(
        readFileSync(new URL(import.meta.resolve("@potential-guide/check-artifacts/observation"))),
      )
      .digest("hex"),
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
    const port = options.children(context.scope);
    if (port.caller.scope !== context.scope || !port.caller.subject)
      throw new TaskError("forbidden", "Injected child caller must retain the parent scope.");
    const controller = new AbortController();
    const owned = new Set<string>();
    const pending = new Set<Promise<void>>();
    const deadline = performance.now() + wallMs;
    const worker = new Worker(workerUrl, {
      execArgv: [],
      env: { NODE_OPTIONS: "" },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
      workerData: {
        prepared,
        policy,
        executionId: permit.executionId,
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
      failure = new TaskError("probe_wall_limit", "Probe execution wall budget exhausted.");
      void stop();
    }, wallMs);
    const cleanup = async () => {
      for (const id of owned) {
        try {
          port.service.cancelTask(id, port.caller);
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
        parentExecutionId: permit.executionId,
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
      const initial = port.service.submit(
        {
          requestId: newId(),
          type: "check",
          checker: request.reference,
          subject: request.subject,
          context: request.context,
          language: request.language,
          executionMatch: "started-after-eligible",
          timeoutMs: remaining,
        },
        port.caller,
      );
      owned.add(initial.taskId);
      progress({ kind: "child", request, taskId: initial.taskId });
      let snapshot: TaskSnapshot = initial;
      let started = false;
      while (!snapshot.termination && !snapshot.canceledAt && !isTimedOut(snapshot)) {
        await delay(5, undefined, { signal: controller.signal });
        snapshot = port.service.getTask(initial.taskId, port.caller);
        if (snapshot.execution && !started) {
          started = true;
          progress({ kind: "child.started", request, snapshot });
        }
      }
      if (snapshot.stage !== "completed" || !snapshot.execution?.completedAt || !snapshot.result)
        throw new TaskError(
          "probe_child_failed",
          `Child ${snapshot.taskId}: ${snapshot.error?.code ?? snapshot.stage}.`,
        );
      // Check the actual committed child runtime, not a caller-declared label.
      let cursor: string | undefined;
      let actual: string | undefined;
      do {
        const page = port.service.readHistory(
          { taskId: snapshot.taskId },
          cursor ? { cursor } : {},
          port.caller,
        );
        for (const event of page.events)
          if (event.type === "execution.started") {
            const execution = (event.data as { execution?: { binding?: { environment?: string } } })
              .execution;
            actual = execution?.binding?.environment;
          }
        cursor = page.next;
      } while (cursor);
      if (actual !== policy.checkEnvironment)
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
          message.value?.evidence?.parentExecutionId !== permit.executionId ||
          message.value?.evidence?.startedAt !== permit.startedAt
        ) {
          failure = new Error("Parent execution identity differs.");
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
    allocationLimit: parents,
    version: options.version ?? "2",
    environment,
    inputSchema: probeInputSchema,
    authorize(input, context, prepared, result) {
      const authorize = (reference: ArtifactReference) =>
        authorizeSync(() => options.source.authorize(reference, context.scope));
      authorize(input.objective);
      for (const [url, digest] of Object.entries(input.bindings ?? {}))
        authorize({ kind: "objective", url, digest });
      if (prepared) {
        const root = decodePrepared(prepared, environment, policy);
        authorize(prepared.root.reference);
        for (const binding of Object.values(root.artifact.manifest.checkers))
          authorize({ kind: "checker", url: binding.url, digest: binding.digest });
      }
      if (result !== undefined)
        for (const reference of probeResultReferences(result)) authorize(reference);
    },
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
