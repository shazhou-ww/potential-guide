import {
  canonicalJson,
  composeObjectivePages,
  inspectContractFiles,
  jsonObject,
  selectLanguage,
  validateArtifactReference,
  validateArtifactSubject,
  type ArtifactReference,
  type ContractArtifact,
  type JsonObject,
} from "@potential-guide/check-artifacts/contracts";
import {
  observeObjective,
  type ObservationInput,
  type ObservationEffect,
  type ObservationPolicy,
  type ObjectiveObservation,
  type PreparedObjective,
} from "@potential-guide/check-artifacts/observation";
import {
  json,
  matchesExecutionTime,
  TaskError,
  timestamp,
  ulid,
  type Json,
  type TaskSnapshot,
} from "@potential-guide/task-protocol";

export interface ProbeInput extends ObservationInput {
  objective: ArtifactReference & { kind: "objective" };
  language?: string;
}
export interface ObjectiveContent {
  reference: ArtifactReference & { kind: "objective"; digest: string };
  files: Record<string, string>;
  checkers: Record<string, Record<string, string>>;
  language: string;
}
export interface ProbePrepared {
  input: ProbeInput;
  root: ObjectiveContent;
  environment: string;
}
export type ProbeEffectEvidence =
  | { request: Extract<ObservationEffect, { kind: "resolve" }>; content: ObjectiveContent }
  | {
      request: Extract<ObservationEffect, { kind: "check" }>;
      snapshot: TaskSnapshot;
      environment: string;
    };
export interface ProbeResult {
  observation: ObjectiveObservation;
  references: PreparedObjective["pages"];
  evidence: {
    parentExecutionId: string;
    startedAt: string;
    environment: string;
    operations: ProbeEffectEvidence[];
  };
}
export interface ProbePolicy extends ObservationPolicy {
  languages: readonly string[];
  checkEnvironment: string;
}
export function exact(value: unknown, required: string[], optional: string[] = []): JsonObject {
  if (
    !jsonObject(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TaskError("invalid_probe", "Invalid Probe fields.");
  return value;
}
export function validateProbeInput(value: unknown): ProbeInput {
  const record = exact(
    value,
    ["objective", "subject"],
    ["context", "bindings", "targetLevel", "language"],
  );
  const ref = exact(record.objective, ["kind", "url"], ["digest"]);
  validateArtifactReference(ref as unknown as ArtifactReference);
  if (
    ref.kind !== "objective" ||
    !jsonObject(record.subject) ||
    (record.context !== undefined &&
      (!jsonObject(record.context) || Object.hasOwn(record.context, "resolutions"))) ||
    (record.targetLevel !== undefined && record.targetLevel !== "initial") ||
    (record.language !== undefined && typeof record.language !== "string")
  )
    throw new TaskError("invalid_probe", "Invalid Objective observation input.");
  if (record.bindings !== undefined) {
    if (!jsonObject(record.bindings) || Object.keys(record.bindings).length > 128)
      throw new TaskError("invalid_probe", "Invalid binding budget.");
    for (const [url, digest] of Object.entries(record.bindings)) {
      if (typeof digest !== "string") throw new TaskError("invalid_probe", "Invalid digest.");
      validateArtifactReference({ kind: "objective", url, digest });
    }
  }
  const input = value as ProbeInput;
  const pinned = input.bindings?.[input.objective.url];
  if (pinned && input.objective.digest && pinned !== input.objective.digest)
    throw new TaskError("invalid_probe", "Root binding conflict.");
  return input;
}
export function encodeFiles(artifact: ContractArtifact): Record<string, string> {
  return Object.fromEntries(
    [...artifact.files].map(([path, bytes]) => [path, bytes.toString("base64")]),
  );
}
function inspect(files: unknown): ContractArtifact {
  if (!jsonObject(files)) throw new TaskError("artifact_invalid", "Missing exact artifact bytes.");
  return inspectContractFiles(
    new Map(
      Object.entries(files).map(([path, text]) => {
        if (typeof text !== "string" || Buffer.from(text, "base64").toString("base64") !== text)
          throw new TaskError("artifact_invalid", "Invalid exact artifact bytes.");
        return [path, Buffer.from(text, "base64")];
      }),
    ),
  );
}
export function encodeObjective(value: PreparedObjective, url: string): ObjectiveContent {
  return {
    reference: { kind: "objective", url, digest: value.artifact.digest },
    files: encodeFiles(value.artifact),
    checkers: Object.fromEntries(
      Object.entries(value.checkers).map(([key, artifact]) => [key, encodeFiles(artifact)]),
    ),
    language: value.language,
  };
}
export function decodeObjective(
  value: ObjectiveContent,
  reference: ArtifactReference,
  languages: readonly string[],
  requested?: string,
): PreparedObjective {
  exact(value, ["reference", "files", "checkers", "language"]);
  exact(value.reference, ["kind", "url", "digest"]);
  validateArtifactReference(value.reference);
  const artifact = inspect(value.files);
  if (
    value.reference.kind !== "objective" ||
    value.reference.url !== reference.url ||
    artifact.digest !== value.reference.digest ||
    (reference.digest && reference.digest !== artifact.digest) ||
    !("checkers" in artifact.manifest) ||
    selectLanguage(artifact.manifest.languages, languages, requested) !== value.language
  )
    throw new TaskError("artifact_invalid", "Exact Objective content or language differs.");
  exact(value.checkers, Object.keys(artifact.manifest.checkers));
  const checkers: PreparedObjective["checkers"] = {};
  for (const [ref, binding] of Object.entries(artifact.manifest.checkers)) {
    const checker = inspect(value.checkers[ref]);
    if (!("entry" in checker.manifest) || checker.digest !== binding.digest)
      throw new TaskError("artifact_invalid", "Exact static Checker differs.");
    checkers[ref] = checker as PreparedObjective["checkers"][string];
  }
  const objective = artifact as PreparedObjective["artifact"];
  return {
    artifact: objective,
    checkers,
    language: value.language,
    pages: composeObjectivePages(objective, checkers),
  };
}
export function decodePrepared(
  value: ProbePrepared,
  environment: string,
  policy: ProbePolicy,
): PreparedObjective {
  exact(value, ["input", "root", "environment"]);
  validateProbeInput(value.input);
  if (value.environment !== environment)
    throw new TaskError("unsupported_environment", "Prepared Probe environment differs.");
  const pinned = value.input.bindings?.[value.input.objective.url];
  const root = decodeObjective(
    value.root,
    { ...value.input.objective, ...(pinned ? { digest: pinned } : {}) },
    policy.languages,
    value.input.language,
  );
  if (!validateArtifactSubject(root.artifact.manifest, value.input.subject))
    throw new TaskError("invalid_probe", "Invalid Objective subject.");
  return root;
}
export function validateProbeResult(value: unknown): Json {
  const record = exact(value, ["observation", "references", "evidence"]);
  const evidence = exact(record.evidence, [
    "parentExecutionId",
    "startedAt",
    "environment",
    "operations",
  ]);
  ulid(evidence.parentExecutionId);
  if (
    typeof evidence.startedAt !== "string" ||
    !Number.isFinite(Date.parse(evidence.startedAt)) ||
    typeof evidence.environment !== "string" ||
    !Array.isArray(evidence.operations)
  )
    throw new TaskError("invalid_probe", "Invalid observation evidence.");
  return json(value, 96 * 1024 * 1024);
}
/** Replay consumes no IO; every result is checked against the exact captured manifests. */
export function replayResult(
  value: unknown,
  prepared: ProbePrepared,
  environment: string,
  policy: ProbePolicy,
): Json {
  validateProbeResult(value);
  const result = value as ProbeResult;
  const root = decodePrepared(prepared, environment, policy);
  const evidence = result.evidence;
  if (evidence.environment !== environment)
    throw new TaskError("invalid_probe", "Result environment differs.");
  const iterator = observeObjective(root, prepared.input, {
    languages: policy.languages,
    observedAt: evidence.startedAt,
    policy,
  });
  let next = iterator.next();
  const taskIds = new Set<string>();
  for (const entry of evidence.operations) {
    if (
      next.done ||
      canonicalJson(next.value as unknown as Json) !==
        canonicalJson(entry.request as unknown as Json)
    )
      throw new TaskError("invalid_probe", "Causal effect transcript differs.");
    if (next.value.kind === "resolve") {
      exact(entry, ["request", "content"]);
      if (!("content" in entry))
        throw new TaskError("invalid_probe", "Missing selection evidence.");
      next = iterator.next(
        decodeObjective(entry.content, next.value.reference, policy.languages, root.language),
      );
    } else {
      exact(entry, ["request", "snapshot", "environment"]);
      if (!("snapshot" in entry) || entry.environment !== policy.checkEnvironment)
        throw new TaskError("invalid_probe", "Child environment differs.");
      const snapshot = entry.snapshot;
      ulid(snapshot.taskId);
      ulid(snapshot.requestId);
      ulid(snapshot.execution?.executionId);
      timestamp(snapshot.execution?.startedAt);
      timestamp(snapshot.execution?.completedAt);
      timestamp(snapshot.receivedAt);
      timestamp(snapshot.eligibleAt);
      timestamp(snapshot.deadlineAt);
      if (
        taskIds.has(snapshot.taskId) ||
        snapshot.stage !== "completed" ||
        snapshot.canceledAt ||
        !snapshot.execution?.completedAt ||
        !snapshot.result ||
        !matchesExecutionTime("started-after-eligible", snapshot.eligibleAt, snapshot.execution) ||
        Date.parse(snapshot.execution.completedAt) > Date.parse(snapshot.deadlineAt)
      )
        throw new TaskError("invalid_probe", "Child completion evidence differs.");
      taskIds.add(snapshot.taskId);
      next = iterator.next({
        result: snapshot.result as never,
        taskId: snapshot.taskId,
        executionId: snapshot.execution.executionId,
      });
    }
  }
  if (
    !next.done ||
    canonicalJson(next.value as unknown as Json) !==
      canonicalJson(result.observation as unknown as Json) ||
    canonicalJson(root.pages as unknown as Json) !==
      canonicalJson(result.references as unknown as Json)
  )
    throw new TaskError("invalid_probe", "Observation differs from exact evidence replay.");
  return json(value, 96 * 1024 * 1024);
}
