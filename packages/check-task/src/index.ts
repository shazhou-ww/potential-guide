import { createHash } from "node:crypto";
import {
  type ArtifactReference,
  canonicalJson,
  validateArtifactReference,
} from "@potential-guide/check-artifacts/contracts";
import {
  authorizeSync,
  type Json,
  json,
  positive,
  type RegisteredType,
  type RunContext,
  TaskError,
  type TaskType,
} from "@potential-guide/task-protocol";
import { type CheckInput, type CheckTaskOptions, createIsolatedCheck } from "./implementation.js";
import { checkInputSchema, checkResultSchema } from "./input.js";
import { runtimeRevision } from "./runtime-identity.js";

export type { CheckInput, CheckPrepared, CheckTaskOptions } from "./implementation.js";
export {
  artifactDigestSchema,
  artifactHttpsUrlSchema,
  artifactReferenceSchema,
  checkInputSchema,
  validateCheckInput,
} from "./input.js";
export {
  type ArtifactSource,
  type ArtifactSourceOptions,
  createArtifactSource,
} from "./prepare.js";

export function createCheckTaskType(
  options: CheckTaskOptions,
): RegisteredType & TaskType<CheckInput, Json> & { close(): Promise<void> } {
  const configuration = {
    directory: options.directory,
    version: options.version ?? "2",
    languages: [...(options.languages ?? ["en"])],
    workers: positive(options.workers ?? 4, "workers"),
    wallMs: positive(options.wallMs ?? 60_000, "wallMs"),
    cleanupMs: positive(options.cleanupMs ?? 5_000, "cleanupMs"),
    graceMs: positive(options.graceMs ?? 100, "graceMs"),
    memoryMb: positive(options.memoryMb ?? 256, "memoryMb"),
    environment: { ...options.environment },
  };
  const module = new URL(
    import.meta.url.endsWith(".ts") ? "../dist/implementation.js" : "./implementation.js",
    import.meta.url,
  );
  const { directory: _directory, ...environmentConfiguration } = configuration;
  const environment = canonicalJson({
    type: "check-run-v3",
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    revision: runtimeRevision,
    configuration: createHash("sha256")
      .update(canonicalJson(json(environmentConfiguration)))
      .digest("hex"),
  });
  const action = (value: unknown, scope: string) => {
    const reference = value as ArtifactReference;
    validateArtifactReference(reference);
    authorizeSync(() => options.source.authorize(reference, scope));
    return reference;
  };
  const registration: RegisteredType & { close(): Promise<void> } = {
    type: "check",
    version: configuration.version,
    environment,
    inputSchema: checkInputSchema,
    resultSchema: checkResultSchema,
    messageSchema: false,
    module: module.href,
    exportName: "createIsolatedCheck",
    verifyExportName: "verifyIsolatedCheck",
    configuration: json(configuration),
    allocationLimit: configuration.workers,
    resourceLifetime: "request",
    resources: {
      async authorize(value, context) {
        action(value, context.scope);
        return null;
      },
      async resolve(value, context) {
        const artifact = await options.source.resolve(
          action(value, context.scope),
          context.scope,
          context.signal,
        );
        return {
          files: Object.fromEntries(
            [...artifact.files].map(([path, bytes]) => [path, bytes.toString("base64")]),
          ),
        };
      },
    },
    async close() {},
  };
  return {
    ...registration,
    async run(input, context) {
      const current = context as RunContext;
      await current.log({
        level: "debug",
        message: "开始逐项检查。",
        fields: { phase: "prepare" },
      });
      if (!current.generation || !current.startedAt)
        throw new TaskError("invalid_tracking", "SDK Run identity is required.");
      const type = createIsolatedCheck(configuration, {
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
          return action(value, {
            runId: current.runId,
            workerGeneration: current.generation!,
            scope: current.scope,
            signal: current.signal,
          });
        },
      });
      try {
        const result = await type.run(input, context);
        const report = (
          result as { result?: { ok?: boolean; problems?: { id?: string; kind?: string }[] } }
        ).result;
        for (const [index, problem] of (report?.problems ?? []).slice(0, 100).entries())
          await current.log({
            level: "warn",
            message: "逐项检查发现问题。",
            fields: {
              index,
              kind: problem.kind ?? "unknown",
              ...(problem.id ? { problemId: problem.id } : {}),
            },
          });
        await current.log({
          level: "info",
          message: "Checker 已完成，业务结果与诊断分开保留。",
          fields: {
            phase: "complete",
            ok: report?.ok ?? false,
            problemCount: report?.problems?.length ?? 0,
          },
        });
        return result;
      } catch (error) {
        await current.log({
          level: "error",
          message: "Checker 执行失败。",
          fields: {
            code: error instanceof TaskError ? error.code : "check_failed",
          },
        });
        throw error;
      }
    },
  };
}
