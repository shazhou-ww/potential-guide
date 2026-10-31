import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type ArtifactReference,
  assertRuntime,
  type CheckerManifest,
  type ContractArtifact,
  canonicalJson,
  finiteJson,
  inspectContractFiles,
  jsonObject,
  parseCheckerResult,
  selectLanguage,
  validateArtifactReference,
  validateArtifactSubject,
} from "@potential-guide/check-artifacts/contracts";
import { createExecutorPool } from "@potential-guide/task-engine/pool";
import {
  authorizeSync,
  type ExecuteOptions,
  type Json,
  type JsonObject,
  json,
  type PreparationOptions,
  positive,
  RunFailure,
  type RunTracking,
  TaskError,
  type TaskType,
} from "@potential-guide/task-protocol";
import { checkInputSchema, checkResultSchema, validateCheckInput } from "./input.js";
import type { ArtifactSource } from "./prepare.js";
import { runChecker } from "./worker.js";

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

export interface CheckInput {
  checker: ArtifactReference & { kind: "checker" };
  subject: JsonObject;
  context?: JsonObject;
  language?: string;
}
export interface CheckPrepared {
  input: CheckInput;
  checker: ArtifactReference & { kind: "checker"; digest: string };
  files: Record<string, string>;
  language: string;
  environment: string;
  workerRevision: string;
}
export interface CheckTaskOptions {
  source: ArtifactSource;
  directory: string;
  version?: string;
  languages?: readonly string[];
  workers?: number;
  wallMs?: number;
  cleanupMs?: number;
  graceMs?: number;
  memoryMb?: number;
  /** Explicitly injected environment, never request-selected or implicitly inherited. */
  environment?: Readonly<Record<string, string>>;
}
function exact(value: unknown, required: string[], optional: string[] = []) {
  const record = boundedObject(value);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TaskError("invalid_check", "Invalid Check fields.");
  return record;
}
function boundedObject(value: unknown, maxBytes = 96 * 1024 * 1024): JsonObject {
  const parsed = json(value, maxBytes);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TaskError("invalid_check", "Expected a finite JSON object.");
  return parsed;
}
function inspect(prepared: CheckPrepared): ContractArtifact<CheckerManifest> {
  const files = new Map<string, Buffer>();
  for (const [path, text] of Object.entries(boundedObject(prepared.files))) {
    if (typeof text !== "string" || Buffer.from(text, "base64").toString("base64") !== text)
      throw new TaskError("artifact_invalid", "Invalid recoverable artifact bytes.");
    files.set(path, Buffer.from(text, "base64"));
  }
  let artifact: ContractArtifact;
  try {
    artifact = inspectContractFiles(files);
  } catch {
    throw new TaskError("artifact_invalid", "Recoverable artifact validation failed.");
  }
  if (
    !("entry" in artifact.manifest) ||
    artifact.digest !== prepared.checker.digest ||
    (prepared.input.checker.digest && artifact.digest !== prepared.input.checker.digest)
  )
    throw new TaskError(
      "artifact_digest_mismatch",
      "Prepared content differs from selected Checker.",
    );
  if (!validateArtifactSubject(artifact.manifest, prepared.input.subject))
    throw new TaskError("invalid_check", "Subject does not satisfy Checker schema.");
  return artifact as ContractArtifact<CheckerManifest>;
}

interface CheckImplementation {
  type: string;
  version: string;
  environment: string;
  inputSchema: typeof checkInputSchema;
  prepare(input: CheckInput, options: PreparationOptions): Promise<CheckPrepared>;
  validatePrepared(value: unknown): CheckPrepared;
  validateResult(value: unknown): Json;
  validateExecutionResult(value: unknown, prepared: CheckPrepared): Json;
  validateProgress(value: unknown): Json;
  execute(prepared: CheckPrepared, options: ExecuteOptions): Promise<RunTracking>;
}
interface Resources {
  invoke(context: object, action: string, value: Json): Promise<Json>;
}
type Configuration = Omit<CheckTaskOptions, "source">;
export function createIsolatedCheck(
  configuration: Configuration,
  resources: Resources,
): TaskType<CheckInput, Json> {
  const identities = new WeakMap<AbortSignal, object>();
  const starts = new Map<string, () => void>();
  const implementation = createCheckImplementation(
    {
      ...configuration,
      source: {
        authorize() {},
        async resolve(reference, _scope, signal) {
          const id = identities.get(signal);
          if (!id) throw new TaskError("forbidden", "资源请求缺少当前 Run。");
          const response = boundedObject(await resources.invoke(id, "resolve", json(reference)));
          const files = response.files as Record<string, string>;
          return inspectContractFiles(
            new Map(
              Object.entries(files).map(([path, bytes]) => [path, Buffer.from(bytes, "base64")]),
            ),
          );
        },
      },
    },
    (runId) => starts.get(runId)?.(),
  );
  return {
    type: implementation.type,
    version: implementation.version,
    inputSchema: implementation.inputSchema,
    resultSchema: checkResultSchema,
    messageSchema: false,
    async run(input, context) {
      identities.set(context.signal, context);
      let prepared: CheckPrepared | undefined;
      const businessProgress: Json[] = [];
      const execution = { executionId: randomUUID(), startedAt: "", completedAt: "" };
      let progress: Promise<void> = Promise.resolve();
      starts.set(context.runId, () => {
        execution.startedAt = new Date().toISOString();
        progress = progress.then(() =>
          context.progress({ stage: "execution", message: "Checker 实际执行开始。" }),
        );
        void progress.catch(() => {});
      });
      try {
        const identity = boundedObject(await resources.invoke(context, "identity", null));
        await context.progress({ stage: "preparation", message: "准备 Checker。" });
        prepared = await implementation.prepare(input, {
          signal: context.signal,
          deadlineAt: new Date(Date.now() + (configuration.wallMs ?? 60_000)).toISOString(),
          context: {
            type: "check",
            version: configuration.version ?? "3",
            environment: implementation.environment,
            scope: context.scope,
          },
        });
        await context.checkpoint({
          kind: "check-prepared",
          prepared: json(prepared, 96 * 1024 * 1024),
        });
        await context.progress({ stage: "allocation", message: "等待 Checker 资源。" });
        await resources.invoke(context, "authorize", json(prepared.checker));
        const candidate = await resources.invoke(context, "replacement", null);
        let result: unknown, failure: unknown;
        const tracking = await implementation.execute(prepared, {
          signal: context.signal,
          context: {
            type: "check",
            version: configuration.version ?? "3",
            environment: implementation.environment,
            scope: context.scope,
          },
          ...(candidate && typeof candidate === "object" && !Array.isArray(candidate)
            ? { replaceRunId: String(candidate.runId) }
            : {}),
          authorizeReplacement: (runId, generation) =>
            resources
              .invoke(context, "authorize-replacement", { runId, generation })
              .then((value) => value === true),
          start: () => {
            return {
              runId: context.runId,
              generation: String(identity.generation),
              startedAt: new Date().toISOString(),
              progress(value) {
                if (businessProgress.length >= 1024)
                  throw new TaskError("capacity_exceeded", "业务进度证据容量已满。");
                businessProgress.push(json(value, 1024 * 1024));
                progress = progress.then(async () => {
                  await context.checkpoint({
                    kind: "check-progress",
                    progress: json(value, 1024 * 1024),
                  });
                  await context.progress({ stage: "execution", message: "Checker 上报业务进度。" });
                });
                void progress.catch(() => {});
              },
              complete(value) {
                result = value;
                execution.completedAt = new Date().toISOString();
              },
              fail(error) {
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
          await progress;
          if (failure) throw failure;
          return verifyIsolatedCheck(
            configuration,
            json({ result, evidence: { prepared, execution, businessProgress } }, 96 * 1024 * 1024),
          );
        } finally {
          context.signal.removeEventListener("abort", abort);
        }
      } catch (error) {
        const failure = {
          code: error instanceof TaskError ? error.code : "check_failed",
          message: error instanceof Error ? error.message : "Check 失败。",
        };
        throw new RunFailure(
          failure.code,
          failure.message,
          json(
            {
              failure,
              evidence: {
                ...(prepared ? { prepared } : {}),
                ...(execution.startedAt ? { execution } : {}),
                businessProgress,
              },
            },
            96 * 1024 * 1024,
          ),
        );
      } finally {
        identities.delete(context.signal);
        starts.delete(context.runId);
      }
    },
  };
}
export async function verifyIsolatedCheck(
  configuration: Configuration,
  value: unknown,
  mode = "historical",
): Promise<Json> {
  const implementation = createCheckImplementation({
    ...configuration,
    source: {
      authorize() {},
      async resolve() {
        throw new Error("历史复验不执行资源 IO。");
      },
    },
  });
  try {
    if (value && typeof value === "object" && Object.hasOwn(value, "kind")) {
      const record = boundedObject(value);
      if (mode === "terminal")
        throw new TaskError("invalid_check", "checkpoint 不能充当最终 Result。");
      if (record.kind === "check-prepared") implementation.validatePrepared(record.prepared);
      else if (record.kind === "check-progress") implementation.validateProgress(record.progress);
      else throw new TaskError("invalid_check", "未知 Check checkpoint。");
      return json(value, 96 * 1024 * 1024);
    }
    if (value && typeof value === "object" && Object.hasOwn(value, "failure")) {
      const record = exact(value, ["failure", "evidence"]);
      const failure = exact(record.failure, ["code", "message"]);
      const evidence = exact(record.evidence, ["businessProgress"], ["prepared", "execution"]);
      if (
        typeof failure.code !== "string" ||
        typeof failure.message !== "string" ||
        !Array.isArray(evidence.businessProgress)
      )
        throw new TaskError("invalid_check", "失败证据格式无效。");
      if (evidence.prepared !== undefined) implementation.validatePrepared(evidence.prepared);
      return json(value, 96 * 1024 * 1024);
    }
    const record = exact(value, ["result", "evidence"]);
    const evidence = exact(record.evidence, ["prepared", "execution", "businessProgress"]);
    const prepared = implementation.validatePrepared(evidence.prepared);
    implementation.validateExecutionResult(record.result, prepared);
    if (!Array.isArray(evidence.businessProgress))
      throw new TaskError("invalid_check", "业务进度证据缺失。");
    const execution = exact(evidence.execution, ["executionId", "startedAt", "completedAt"]);
    if (
      typeof execution.executionId !== "string" ||
      typeof execution.startedAt !== "string" ||
      typeof execution.completedAt !== "string"
    )
      throw new TaskError("invalid_check", "业务 Execution 身份缺失。");
    return json(value, 96 * 1024 * 1024);
  } finally {
    await implementation.close();
  }
}
export function createCheckImplementation(
  options: CheckTaskOptions,
  onStart?: (runId: string) => void,
): CheckImplementation & {
  close(): Promise<void>;
  readonly diagnostics: { queued: number; idle: number; running: number; quarantined: number };
} {
  const workers = positive(options.workers ?? 4, "workers");
  if (workers > 128) throw new TaskError("invalid_config", "At most 128 Checker workers.");
  const wallMs = positive(options.wallMs ?? 60_000, "wallMs");
  const cleanupMs = positive(options.cleanupMs ?? 5_000, "cleanupMs");
  const memoryMb = positive(options.memoryMb ?? 256, "memoryMb");
  const variables = Object.freeze({ ...options.environment });
  const runtime = {
    type: "node" as const,
    version: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    adapter: "node-commonjs-v1",
    adapterRevision: createHash("sha256")
      .update(
        readFileSync(new URL(import.meta.resolve("@potential-guide/check-runtime-files/worker"))),
      )
      .update(
        readFileSync(
          new URL(import.meta.resolve("@potential-guide/check-runtime-files/worker-json")),
        ),
      )
      .update(
        readFileSync(
          new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url),
        ),
      )
      .digest("hex"),
    configuration: createHash("sha256")
      .update(canonicalJson({ variables, memoryMb, wallMs }))
      .digest("hex"),
  };
  const environment = canonicalJson(runtime);
  const validatePrepared = (value: unknown): CheckPrepared => {
    const record = exact(value, [
      "input",
      "checker",
      "files",
      "language",
      "environment",
      "workerRevision",
    ]);
    validateCheckInput(record.input);
    exact(record.checker, ["kind", "url", "digest"]);
    const prepared = value as CheckPrepared;
    validateArtifactReference(prepared.checker);
    if (
      prepared.checker.kind !== "checker" ||
      typeof prepared.checker.digest !== "string" ||
      prepared.checker.url !== prepared.input.checker.url ||
      prepared.environment !== environment ||
      typeof prepared.language !== "string"
    )
      throw new TaskError("unsupported_environment", "Prepared run binding differs.");
    const artifact = inspect(prepared);
    if (
      prepared.workerRevision !==
      createHash("sha256").update(artifact.files.get(artifact.manifest.entry)!).digest("hex")
    )
      throw new TaskError("artifact_digest_mismatch", "Prepared worker bytes differ.");
    try {
      assertRuntime(artifact.manifest, runtime);
    } catch {
      throw new TaskError("unsupported_runtime", "Checker runtime is unavailable.");
    }
    if (
      selectLanguage(
        artifact.manifest.languages,
        options.languages ?? ["en"],
        prepared.input.language,
      ) !== prepared.language
    )
      throw new TaskError("invalid_check", "Prepared language differs.");
    return prepared;
  };
  const pool = createExecutorPool<CheckPrepared>({
    resources: Array.from({ length: workers }, () => environment),
    resourceKey: () => environment,
    graceMs: options.graceMs ?? 100,
    reclaimMs: cleanupMs,
    run(prepared, permit) {
      const artifact = inspect(validatePrepared(prepared));
      return runChecker(prepared, artifact, permit, {
        directory: options.directory,
        wallMs,
        cleanupMs,
        memoryMb,
        environment: variables,
        onStart: () => onStart?.(permit.runId),
      });
    },
  });
  return {
    type: "check",
    version: options.version ?? "2",
    environment,
    inputSchema: checkInputSchema,
    async prepare(input, context) {
      validateCheckInput(input);
      validateArtifactReference(input.checker);
      if (!context.context)
        throw new TaskError("invalid_config", "Trusted preparation context is required.");
      authorizeSync(() => options.source.authorize(input.checker, context.context!.scope));
      const artifact = await options.source.resolve(
        input.checker,
        context.context.scope,
        context.signal,
      );
      context.signal.throwIfAborted();
      if (!("entry" in artifact.manifest))
        throw new TaskError("artifact_invalid", "Expected Checker.");
      return validatePrepared({
        input,
        checker: { ...input.checker, digest: artifact.digest },
        files: Object.fromEntries(
          [...artifact.files].map(([path, bytes]) => [path, bytes.toString("base64")]),
        ),
        language: selectLanguage(
          artifact.manifest.languages,
          options.languages ?? ["en"],
          input.language,
        ),
        environment,
        workerRevision: createHash("sha256")
          .update(artifact.files.get(artifact.manifest.entry)!)
          .digest("hex"),
      });
    },
    validatePrepared,
    validateResult(value) {
      const payload = boundedObject(value, 4 * 1024 * 1024);
      const problems = Array.isArray(payload.problems)
        ? payload.problems.flatMap((item) =>
            jsonObject(item) && item.kind === "internal" && typeof item.id === "string"
              ? [item.id]
              : [],
          )
        : [];
      parseCheckerResult({ status: 200, message: "", payload }, { problems } as CheckerManifest);
      return json(value, 4 * 1024 * 1024);
    },
    validateExecutionResult(value, prepared) {
      const { manifest } = inspect(validatePrepared(prepared));
      parseCheckerResult({ status: 200, message: "", payload: value }, manifest);
      return json(value, 4 * 1024 * 1024);
    },
    validateProgress(value) {
      if (!finiteJson(value))
        throw new TaskError("invalid_progress", "Progress must be finite JSON.");
      return json(value, 1024 * 1024);
    },
    async execute(prepared, context) {
      validatePrepared(prepared);
      authorizeSync(() => options.source.authorize(prepared.checker, context.context.scope));
      context.signal.throwIfAborted();
      return pool.execute(prepared, context);
    },
    close: () => pool.close(),
    get diagnostics() {
      return pool.stats;
    },
  };
}
