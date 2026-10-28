import {
  type CheckerManifest,
  type CheckerResult,
  type JsonObject,
  assertRuntime,
  canonicalJson,
  jsonObject,
  parseCheckerResult,
  validateArtifactSubject,
} from "@potential-guide/check-artifacts";
import {
  type ContractRepository,
  type ResolvedContract,
  type RuntimeEvidence,
  type CheckerMaterializer,
  runtimeEvidence,
  selectServiceLanguage,
} from "./contract-store.js";
import type { CheckKernel } from "./kernel.js";
import {
  type PreparedTask,
  type TaskOptions,
  type ServiceSnapshot,
  TaskService,
  serviceLimits,
} from "./task-service.js";
import { TaskProtocolError } from "./v2-types.js";

export interface CheckerRequest extends TaskOptions {
  checker: { url: string; digest?: string };
  subject: JsonObject;
  context?: JsonObject;
  language?: string;
}
export interface CheckerEvidence {
  runtime: RuntimeEvidence;
  revision: string;
}
export type CheckerSnapshot = ServiceSnapshot<CheckerResult, never, CheckerEvidence>;
interface PreparedChecker extends PreparedTask {
  resolved: ResolvedContract & { manifest: CheckerManifest };
  capsule: { directory: string; revision: string };
  runtime: RuntimeEvidence;
}
export function normalizeCheckerRequest(value: CheckerRequest): CheckerRequest {
  if (
    !jsonObject(value) ||
    Object.keys(value).some(
      (key) =>
        !["checker", "subject", "context", "language", "freshness", "timeoutMs"].includes(key),
    ) ||
    !jsonObject(value.checker) ||
    Object.keys(value.checker).some((key) => !["url", "digest"].includes(key)) ||
    typeof value.checker.url !== "string" ||
    (value.checker.digest !== undefined && typeof value.checker.digest !== "string") ||
    !jsonObject(value.subject) ||
    (value.context !== undefined && !jsonObject(value.context)) ||
    (value.language !== undefined && typeof value.language !== "string")
  )
    throw new TaskProtocolError(400, {
      code: "invalid_request",
      stage: "validate",
      message: "Invalid Checker request.",
    });
  return { ...value, context: value.context ?? {} };
}
export class CheckerService extends TaskService<
  CheckerRequest,
  PreparedChecker,
  CheckerResult,
  never,
  CheckerEvidence
> {
  readonly environment: Readonly<Record<string, string>>;
  constructor(
    readonly repository: ContractRepository,
    readonly materializer: CheckerMaterializer,
    readonly kernel: CheckKernel,
    readonly languages: readonly string[] = ["en", "zh-CN"],
  ) {
    super(
      {
        normalize: normalizeCheckerRequest,
        authorize(request, scope) {
          repository.authorize({ kind: "checker", ...request.checker }, scope);
        },
        async prepare(request, scope, signal) {
          const resolved = await repository.resolve(
            { kind: "checker", ...request.checker },
            scope,
            signal,
          );
          if (!("entry" in resolved.manifest)) throw new Error("Expected Checker.");
          const runtime = runtimeEvidence(kernel.limits);
          try {
            assertRuntime(resolved.manifest, runtime);
          } catch {
            throw new TaskProtocolError(422, {
              code: "runtime_unavailable",
              stage: "validate",
              message: "Declared Checker runtime is unsupported or below its minimum version.",
            });
          }
          if (!validateArtifactSubject(resolved.manifest, request.subject))
            throw new Error("Invalid Checker subject.");
          const language = selectServiceLanguage(
            resolved.manifest.languages,
            languages,
            request.language,
          );
          const capsule = await materializer.prepare(resolved);
          signal.throwIfAborted();
          return {
            resolved: resolved as PreparedChecker["resolved"],
            artifact: resolved.metadata,
            capsule,
            runtime,
            language,
            compatibility: canonicalJson({
              digest: resolved.digest,
              source: request.checker.url,
              subject: request.subject,
              context: request.context ?? {},
              language,
              runtime: { ...runtime },
              revision: capsule.revision,
              policy: "checker-v3",
            }),
          };
        },
        execute(prepared, request, context) {
          return new Promise((resolve, reject) => {
            const cancel = () => {
              try {
                kernel.cancel(context.id);
              } catch {
                /* Kernel admission may still be pending. */
              }
            };
            context.signal.addEventListener("abort", cancel, { once: true });
            void kernel
              .executeCheck(
                {
                  checkId: context.id,
                  ...prepared.capsule,
                  subject: request.subject,
                  context: { ...request.context, language: prepared.language },
                },
                {
                  started() {
                    if (context.signal.aborted) {
                      cancel();
                      return;
                    }
                    try {
                      context.start();
                    } catch (error) {
                      cancel();
                      reject(error);
                    }
                  },
                  finished(state, stage) {
                    context.signal.removeEventListener("abort", cancel);
                    try {
                      context.signal.throwIfAborted();
                      if (state.state !== "Completed")
                        throw new TaskProtocolError(502, {
                          code: stage === "cleanup" ? "cleanup_failed" : "execution_failed",
                          stage: stage ?? "observe",
                          message: "Checker execution failed.",
                        });
                      let result: CheckerResult;
                      try {
                        result = parseCheckerResult(state.result, prepared.resolved.manifest);
                      } catch {
                        throw new TaskProtocolError(502, {
                          code: "invalid_result",
                          stage: "verify",
                          message: "Checker result violates the uniform result contract.",
                        });
                      }
                      resolve({
                        result,
                        evidence: {
                          runtime: prepared.runtime,
                          revision: prepared.capsule.revision,
                        },
                      });
                    } catch (error) {
                      reject(error);
                    }
                  },
                },
              )
              .then(
                () => {
                  if (context.signal.aborted) cancel();
                },
                (error) => {
                  context.signal.removeEventListener("abort", cancel);
                  reject(error);
                },
              );
          });
        },
      },
      {
        ...serviceLimits,
        timeoutMs: 30_000,
        maxTimeoutMs: 120_000,
        executionMs: kernel.limits.deadlineMs + kernel.limits.cleanupMs,
      },
    );
    this.environment = Object.freeze({ ...runtimeEvidence(kernel.limits) });
  }
  async reference(digest: string, id: string, scope: string, requested?: string) {
    const artifact = await this.repository.artifact(digest, scope);
    const language = selectServiceLanguage(artifact.manifest.languages, this.languages, requested);
    const page = artifact.pages[language]?.[id];
    if (!page)
      throw new TaskProtocolError(404, {
        code: "reference_not_found",
        stage: "resolve",
        message: "Reference page not found.",
      });
    return structuredClone(page);
  }
  override async close() {
    await super.close();
    await this.kernel.close();
    await this.materializer.close();
  }
}
