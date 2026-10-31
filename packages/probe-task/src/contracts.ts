import {
  type ArtifactReference,
  type ContractArtifact,
  canonicalJson,
  composeObjectivePages,
  inspectContractFiles,
  type JsonObject,
  jsonObject,
  selectLanguage,
  validateArtifactReference,
  validateArtifactSubject,
} from "@potential-guide/check-artifacts/contracts";
import {
  type ObjectiveObservation,
  type ObservationEffect,
  type ObservationInput,
  type ObservationPolicy,
  observeObjective,
  type PreparedObjective,
} from "@potential-guide/check-artifacts/observation";
import {
  artifactDigestSchema,
  artifactHttpsUrlSchema,
  artifactReferenceSchema,
} from "@potential-guide/check-task";
import {
  compileInputSchema,
  freeze,
  type Json,
  json,
  matchesRunTime,
  TaskError,
  type TaskSnapshot,
  timestamp,
  ulid,
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
    parentRunId: string;
    prepared: ProbePrepared;
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
export const probeInputSchema = freeze({
  type: "object",
  properties: {
    objective: artifactReferenceSchema("objective"),
    subject: { type: "object" },
    context: { type: "object", propertyNames: { not: { const: "resolutions" } } },
    bindings: {
      type: "object",
      maxProperties: 128,
      propertyNames: artifactHttpsUrlSchema,
      additionalProperties: artifactDigestSchema,
    },
    targetLevel: { const: "initial" },
    language: { type: "string" },
  },
  required: ["objective", "subject"],
  additionalProperties: false,
});
export const validateProbeInput = compileInputSchema<ProbeInput>(probeInputSchema, {
  maxInputBytes: 96 * 1024 * 1024,
}).validate;
export function validateProbeConsistency(input: ProbeInput): void {
  validateArtifactReference(input.objective);
  for (const [url, digest] of Object.entries(input.bindings ?? {}))
    validateArtifactReference({ kind: "objective", url, digest });
  const pinned = input.bindings?.[input.objective.url];
  if (pinned && input.objective.digest && pinned !== input.objective.digest)
    throw new TaskError("invalid_probe", "Root binding conflict.");
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
  validateProbeConsistency(value.input);
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
    "parentRunId",
    "prepared",
    "startedAt",
    "environment",
    "operations",
  ]);
  ulid(evidence.parentRunId);
  if (
    typeof evidence.startedAt !== "string" ||
    !Number.isFinite(Date.parse(evidence.startedAt)) ||
    typeof evidence.environment !== "string" ||
    !Array.isArray(evidence.operations)
  )
    throw new TaskError("invalid_probe", "Invalid observation evidence.");
  return json(value, 96 * 1024 * 1024);
}

export function probeResultReferences(value: unknown): ArtifactReference[] {
  const result = validateProbeResult(value);
  if (
    !jsonObject(result) ||
    !jsonObject(result.evidence) ||
    !Array.isArray(result.evidence.operations)
  )
    throw new TaskError("invalid_probe", "Invalid observation evidence.");
  const reference = (value: unknown): ArtifactReference => {
    const ref = exact(value, ["kind", "url"], ["digest"]);
    if (
      (ref.kind !== "checker" && ref.kind !== "objective") ||
      typeof ref.url !== "string" ||
      (ref.digest !== undefined && typeof ref.digest !== "string")
    )
      throw new TaskError("invalid_probe", "Invalid observation resource reference.");
    return validateArtifactReference({
      kind: ref.kind,
      url: ref.url,
      ...(ref.digest === undefined ? {} : { digest: ref.digest }),
    });
  };
  const references: ArtifactReference[] = [];
  for (const value of result.evidence.operations) {
    if (!jsonObject(value) || !jsonObject(value.request))
      throw new TaskError("invalid_probe", "Invalid observation operation.");
    if (value.request.kind === "resolve") {
      exact(value, ["request", "content"]);
      if (!jsonObject(value.content))
        throw new TaskError("invalid_probe", "Missing selection evidence.");
      references.push(reference(value.request.reference), reference(value.content.reference));
    } else if (value.request.kind === "check") {
      exact(value, ["request", "snapshot", "environment"]);
      references.push(reference(value.request.reference));
    } else throw new TaskError("invalid_probe", "Invalid observation operation.");
  }
  return references;
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
      ulid(snapshot.run?.runId);
      timestamp(snapshot.run?.startedAt);
      timestamp(snapshot.run?.completedAt);
      timestamp(snapshot.receivedAt);
      timestamp(snapshot.eligibleAt);
      timestamp(snapshot.deadlineAt);
      if (
        taskIds.has(snapshot.taskId) ||
        snapshot.stage !== "completed" ||
        snapshot.canceledAt ||
        !snapshot.run?.completedAt ||
        !snapshot.result ||
        !matchesRunTime("started-after-eligible", snapshot.eligibleAt, snapshot.run) ||
        Date.parse(snapshot.run.completedAt) > Date.parse(snapshot.deadlineAt)
      )
        throw new TaskError("invalid_probe", "Child completion evidence differs.");
      taskIds.add(snapshot.taskId);
      next = iterator.next({
        result: (snapshot.result as unknown as { result: unknown }).result as never,
        taskId: snapshot.taskId,
        executionId: (
          snapshot.result as unknown as { evidence: { execution: { executionId: string } } }
        ).evidence.execution.executionId,
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
export const probeResultSchema = {
  oneOf: [
    {
      type: "object",
      properties: { kind: { const: "probe-prepared" }, prepared: { type: "object" } },
      required: ["kind", "prepared"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "probe-progress" }, progress: {} },
      required: ["kind", "progress"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        observation: { type: "object" },
        references: { type: "object" },
        evidence: { type: "object" },
      },
      required: ["observation", "references", "evidence"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { failure: { type: "object" }, evidence: { type: "object" } },
      required: ["failure", "evidence"],
      additionalProperties: false,
    },
  ],
};
