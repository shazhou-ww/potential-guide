import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
} from "@potential-guide/task-protocol";
import { probeInputSchema, probeResultSchema } from "./contracts.js";
import type { ProbeTaskOptions } from "./implementation.js";

export type { ProbeTaskOptions } from "./implementation.js";
export interface ChildTaskPort {
  service: Pick<TaskService, "submit" | "getTask" | "cancelTask" | "readHistory">;
  caller: { scope: string; subject: string };
  waitForTaskRelease(taskId: string, caller: { scope: string; subject: string }): Promise<void>;
}
export type { ProbeEffectEvidence, ProbeInput, ProbePrepared, ProbeResult } from "./contracts.js";
export { probeInputSchema, validateProbeInput } from "./contracts.js";

export function createProbeTaskType(
  options: ProbeTaskOptions,
): RegisteredType & { close(): Promise<void> } {
  const configuration = {
    checkEnvironment: options.checkEnvironment,
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
    revision: createHash("sha256")
      .update(readFileSync(module))
      .update(readFileSync(new URL("./contracts.js", module)))
      .update(readFileSync(new URL("./worker.js", module)))
      .digest("hex"),
    configuration: json(configuration),
  });
  const owned = new Map<
    string,
    { ids: Set<string>; active: Set<string>; cleanup: Set<Promise<void>> }
  >();
  const ownerKey = (context: RunResourceContext) => `${context.workerGeneration}\0${context.runId}`;
  const portFor = (context: RunResourceContext) => {
    const port = options.children(context.scope);
    if (port.caller.scope !== context.scope || !port.caller.subject)
      throw new TaskError("forbidden", "子需求权限必须保留父 scope。");
    let state = owned.get(ownerKey(context));
    if (!state) {
      state = { ids: new Set(), active: new Set(), cleanup: new Set() };
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
    return { port, ids: state.ids, active: state.active };
  };
  const ownedTask = (value: unknown, context: RunResourceContext) => {
    const id = String(object(value).taskId);
    const { port, ids, active } = portFor(context);
    if (!ids.has(id)) throw new TaskError("forbidden", "子需求不属于当前 Run。");
    return { id, port, ids, active };
  };
  return {
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
        const { port, ids, active } = portFor(context);
        const snapshot = await port.service.submit(value, port.caller);
        ids.add(snapshot.taskId);
        active.add(snapshot.taskId);
        if (context.signal.aborted) {
          await port.service.cancelTask(snapshot.taskId, port.caller);
          await port.waitForTaskRelease(snapshot.taskId, port.caller);
          active.delete(snapshot.taskId);
          context.signal.throwIfAborted();
        }
        return json(snapshot);
      },
      async "child-get"(value, context) {
        const { id, port } = ownedTask(value, context);
        return json(await port.service.getTask(id, port.caller));
      },
      async "child-cancel"(value, context) {
        const { id, port } = ownedTask(value, context);
        return json(await port.service.cancelTask(id, port.caller));
      },
      async "child-history"(value, context) {
        const { id, port } = ownedTask(value, context);
        const raw = object(value);
        return json(
          await port.service.readHistory({ taskId: id }, object(raw.page) as {}, port.caller),
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
}
