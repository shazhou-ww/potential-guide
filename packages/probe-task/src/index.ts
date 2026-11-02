import { runtimeRevision } from "./runtime-identity.js";
import {
  type ArtifactReference,
  canonicalJson,
  validateArtifactReference,
} from "@potential-guide/check-artifacts/contracts";
import { observationDefaults } from "@potential-guide/check-artifacts/observation";
import {
  authorizeSync,
  json,
  object,
  positive,
  type RegisteredType,
  type RunResourceContext,
  TaskError,
  type TaskService,
  type SubmissionResult,
  type TaskType,
  type Json,
  type RunContext,
  RunFailure,
} from "@potential-guide/task-protocol";
import { probeInputSchema, probeResultSchema } from "./contracts.js";
import { createIsolatedProbe, type ProbeTaskOptions } from "./implementation.js";
import type { ProbeInput } from "./contracts.js";

export type { ProbeTaskOptions } from "./implementation.js";
export interface ChildTaskPort {
  service: Pick<
    TaskService,
    | "submit"
    | "getRequestStatus"
    | "getTask"
    | "cancelTask"
    | "readHistory"
    | "getRun"
    | "getRunHistory"
  >;
  caller: { scope: string; subject: string };
  waitForTaskRelease(taskId: string, caller: { scope: string; subject: string }): Promise<void>;
}
export type { ProbeEffectEvidence, ProbeInput, ProbePrepared, ProbeResult } from "./contracts.js";
export { probeInputSchema, validateProbeInput } from "./contracts.js";

function childObservation(value: unknown) {
  // Engine query budgets apply before the existing 96 MiB resource transport bound.
  return json(value, 96 * 1024 * 1024);
}

export function createProbeTaskType(
  options: ProbeTaskOptions,
): RegisteredType & TaskType<ProbeInput, Json> & { close(): Promise<void> } {
  const configuration = {
    checkEnvironment: options.checkEnvironment,
    ...(options.checkBundle ? { checkBundle: options.checkBundle } : {}),
    version: options.version ?? "2",
    languages: [...(options.languages ?? ["en"])],
    parents: positive(options.parents ?? 4, "parents"),
    maxQueue: options.maxQueue ?? 128,
    wallMs: options.wallMs ?? 60_000,
    cleanupMs: options.cleanupMs ?? 5_000,
    maxDepth: options.maxDepth ?? observationDefaults.maxDepth,
    maxObservations: options.maxObservations ?? observationDefaults.maxObservations,
    maxChecks: options.maxChecks ?? observationDefaults.maxChecks,
  };
  const module = new URL(
    import.meta.url.endsWith(".ts") ? "../dist/implementation.js" : "./implementation.js",
    import.meta.url,
  );
  const environment = canonicalJson({
    type: "probe-run-v3",
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    revision: runtimeRevision,
    configuration: json(configuration),
  });
  const owned = new Map<
    string,
    { ids: Set<string>; requests: Set<string>; active: Set<string>; cleanup: Set<Promise<void>> }
  >();
  const ownerKey = (context: RunResourceContext) => `${context.workerGeneration}\0${context.runId}`;
  const portFor = (context: RunResourceContext) => {
    const port = options.children(context.scope, context.runId);
    if (port.caller.scope !== context.scope || !port.caller.subject)
      throw new TaskError("forbidden", "子需求权限必须保留父 scope。");
    let state = owned.get(ownerKey(context));
    if (!state) {
      state = { ids: new Set(), requests: new Set(), active: new Set(), cleanup: new Set() };
      owned.set(ownerKey(context), state);
      context.signal.addEventListener(
        "abort",
        () => {
          for (const id of state!.active) {
            const operation = Promise.resolve()
              .then(async () => {
                try {
                  await port.service.cancelTask(id, port.caller);
                } catch (error) {
                  if (!(error instanceof TaskError) || error.code !== "task_finished") throw error;
                }
                await port.waitForTaskRelease(id, port.caller);
                state!.active.delete(id);
              })
              .finally(() => state!.cleanup.delete(operation));
            state!.cleanup.add(operation);
            void operation.catch(() => {});
          }
        },
        { once: true },
      );
    }
    return { port, ids: state.ids, requests: state.requests, active: state.active };
  };
  const ownedTask = (value: unknown, context: RunResourceContext) => {
    const id = String(object(value).taskId);
    const { port, ids, active } = portFor(context);
    if (!ids.has(id)) throw new TaskError("forbidden", "子需求不属于当前 Run。");
    return { id, port, ids, active };
  };
  const ownedRun = async (value: unknown, context: RunResourceContext) => {
    const raw = object(value),
      runId = String(raw.runId),
      { port, ids } = portFor(context);
    for (const id of ids) {
      const task = await port.service.getTask(id, port.caller);
      if (task.run?.runId === runId) return { runId, port };
    }
    throw new TaskError("forbidden", "Run 不属于当前父 Run 的唯一匹配子需求。");
  };
  const registration: RegisteredType & { close(): Promise<void> } = {
    type: "probe",
    version: configuration.version,
    environment,
    allocationLimit: configuration.parents,
    inputSchema: probeInputSchema,
    resultSchema: probeResultSchema,
    messageSchema: false,
    module: module.href,
    exportName: "createIsolatedProbe",
    verifyExportName: "verifyIsolatedProbe",
    configuration: json(configuration),
    cleanupActions: ["child-cancel", "child-release", "run-dispose"],
    async confirmResourceRelease(context) {
      const state = owned.get(ownerKey(context));
      if (!state) return;
      await Promise.all(state.cleanup);
      if (state.active.size)
        throw new TaskError("reclamation_unknown", "父 Run 的子需求物理回收尚未确认。");
      owned.delete(ownerKey(context));
    },
    resources: {
      async authorize(value, context) {
        const reference = value as unknown as ArtifactReference;
        validateArtifactReference(reference);
        authorizeSync(() => options.source.authorize(reference, context.scope));
        return null;
      },
      async resolve(value, context) {
        const reference = value as unknown as ArtifactReference;
        validateArtifactReference(reference);
        authorizeSync(() => options.source.authorize(reference, context.scope));
        const artifact = await options.source.resolve(reference, context.scope, context.signal);
        return {
          files: Object.fromEntries(
            [...artifact.files].map(([path, bytes]) => [path, bytes.toString("base64")]),
          ),
        };
      },
      async "child-identity"(_value, context) {
        const caller = portFor(context).port.caller;
        return { scope: caller.scope, subject: caller.subject };
      },
      async "child-submit"(value, context) {
        const { port, ids, requests, active } = portFor(context);
        requests.add(String(object(value).requestId));
        const result = await port.service.submit(value, port.caller);
        if (result.status === "accepted") {
          ids.add(result.taskId);
          active.add(result.taskId);
          if (context.signal.aborted) {
            await port.service.cancelTask(result.taskId, port.caller);
            await port.waitForTaskRelease(result.taskId, port.caller);
            active.delete(result.taskId);
            context.signal.throwIfAborted();
          }
        }
        return childObservation(result);
      },
      async "child-status"(value, context) {
        const raw = object(value),
          id = String(raw.requestId);
        const { port, ids, requests, active } = portFor(context);
        if (!requests.has(id))
          throw new TaskError("forbidden", "Request does not belong to this parent Run.");
        const result: SubmissionResult = await port.service.getRequestStatus(id, {}, port.caller);
        if (result.status === "accepted") {
          ids.add(result.taskId);
          active.add(result.taskId);
          if (context.signal.aborted) {
            await port.service.cancelTask(result.taskId, port.caller);
            await port.waitForTaskRelease(result.taskId, port.caller);
            active.delete(result.taskId);
            context.signal.throwIfAborted();
          }
        }
        return childObservation(result);
      },
      async "child-get"(value, context) {
        const { id, port } = ownedTask(value, context);
        return childObservation(await port.service.getTask(id, port.caller));
      },
      async "child-cancel"(value, context) {
        const { id, port } = ownedTask(value, context);
        return childObservation(await port.service.cancelTask(id, port.caller));
      },
      async "child-history"(value, context) {
        const { id, port } = ownedTask(value, context);
        const raw = object(value);
        return childObservation(
          await port.service.readHistory({ taskId: id }, object(raw.page) as {}, port.caller),
        );
      },
      async "child-run"(value, context) {
        const { runId, port } = await ownedRun(value, context);
        return childObservation(await port.service.getRun(runId, port.caller));
      },
      async "child-run-history"(value, context) {
        const { runId, port } = await ownedRun(value, context),
          raw = object(value);
        return childObservation(
          await port.service.getRunHistory(runId, object(raw.page) as {}, port.caller),
        );
      },
      async "child-release"(value, context) {
        const { id, port, active } = ownedTask(value, context);
        if (active.has(id)) await port.waitForTaskRelease(id, port.caller);
        active.delete(id);
        return null;
      },
      async "run-dispose"(_value, context) {
        const state = owned.get(ownerKey(context));
        if (state?.active.size)
          throw new TaskError("reclamation_unknown", "子需求所有权尚未释放。");
        owned.delete(ownerKey(context));
        return null;
      },
    },
    async close() {},
  };
  return {
    ...registration,
    async run(input, context) {
      const current = context as RunContext;
      if (!current.generation || !current.startedAt)
        throw new TaskError("invalid_tracking", "SDK Run identity is required.");
      const resourceContext: RunResourceContext = {
        runId: current.runId,
        workerGeneration: current.generation,
        scope: current.scope,
        signal: current.signal,
      };
      const type = createIsolatedProbe(configuration, {
        async invoke(capability, operation, value) {
          if (capability !== context)
            throw new TaskError("forbidden", "Current Run context required.");
          if (operation === "identity")
            return {
              runId: current.runId,
              generation: current.generation!,
              startedAt: current.startedAt!,
            };
          if (operation === "replacement") return null;
          if (operation === "authorize-replacement") return false;
          const action = registration.resources?.[operation];
          if (!action) throw new TaskError("forbidden", "Unknown business resource action.");
          return action(value, resourceContext);
        },
      });
      let value: Json | undefined, failure: unknown;
      try {
        value = await type.run(input, context);
      } catch (error) {
        failure = error;
      }
      try {
        await registration.confirmResourceRelease!(resourceContext);
      } catch (error) {
        throw new RunFailure(
          "reclamation_unknown",
          error instanceof Error ? error.message : "Child release unconfirmed.",
          json(
            {
              failure: { code: "reclamation_unknown", message: "Child release unconfirmed." },
              evidence: {
                trace: [
                  {
                    kind: "before-cleanup-failure",
                    value: failure instanceof RunFailure ? failure.result : (value ?? null),
                  },
                ],
              },
            },
            96 * 1024 * 1024,
          ),
        );
      }
      if (failure) throw failure;
      return value!;
    },
  };
}
