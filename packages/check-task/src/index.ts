import { createHash } from "node:crypto";
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
  json,
  positive,
  TaskError,
  type JsonObject,
  type TaskType,
} from "@potential-guide/task-protocol";
import type { ArtifactSource } from "./prepare.js";
import { runChecker } from "./worker.js";
import { checkInputSchema, validateCheckInput } from "./input.js";
export {
  checkInputSchema,
  validateCheckInput,
  artifactReferenceSchema,
  artifactHttpsUrlSchema,
  artifactDigestSchema,
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

export function createCheckTaskType(options: CheckTaskOptions): TaskType<
  CheckInput,
  CheckPrepared
> & {
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
    configuration: canonicalJson({ variables, memoryMb, wallMs }),
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
      throw new TaskError("unsupported_environment", "Prepared execution binding differs.");
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
      });
    },
  });
  return {
    type: "check",
    version: options.version ?? "2",
    environment,
    inputSchema: checkInputSchema,
    authorize(input, context, prepared) {
      authorizeSync(() => options.source.authorize(input.checker, context.scope));
      if (prepared) authorizeSync(() => options.source.authorize(prepared.checker, context.scope));
    },
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
