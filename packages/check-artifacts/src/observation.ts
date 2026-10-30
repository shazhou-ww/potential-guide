import {
  canonicalJson,
  composeObjectivePages,
  selectLanguage,
  validateArtifactSubject,
  type ArtifactReference,
  type CheckerManifest,
  type ContractArtifact,
  type Json,
  type JsonObject,
  type ObjectiveArtifactManifest,
} from "./contracts.js";
import { parseCheckerResult, type CheckerProblem, type CheckerResult } from "./contract-result.js";
import { mapSubject } from "./mapping.js";

export interface PreparedObjective {
  artifact: ContractArtifact<ObjectiveArtifactManifest>;
  checkers: Record<string, ContractArtifact<CheckerManifest>>;
  pages: ContractArtifact["pages"];
  language: string;
}
export type ExactObjective = ArtifactReference & { kind: "objective"; digest: string };
export interface ObservationInput {
  objective: { url: string; digest?: string };
  subject: JsonObject;
  context?: JsonObject;
  bindings?: Record<string, string>;
  targetLevel?: "initial";
}
export interface ObjectiveObservation {
  current: { objective: ExactObjective; levelId: string };
  problems: {
    objective: ExactObjective;
    levelId: string;
    checker: string;
    problem: CheckerProblem;
  }[];
  gapSummary: string;
  observedAt: string;
  bindings: Record<string, string>;
}
export interface ObservationProgress {
  id: string;
  parentInvocation?: string;
  objective: ExactObjective;
  currentLevel: string;
  attainedLevel: string;
  levels: { id: string; state: "pending" | "running" | "passed" | "blocked" }[];
}
export interface InvocationProgress {
  id: string;
  observationId: string;
  objective: ExactObjective;
  level: string;
  checker: string;
  taskId?: string;
  executionId?: string;
  state: string;
}
export interface ObservationProgressSet {
  observations: ObservationProgress[];
  invocations: InvocationProgress[];
}
export interface CheckObservation {
  kind: "check";
  invocationId: string;
  observationId: string;
  objective: ExactObjective;
  level: string;
  checker: string;
  reference: ArtifactReference & { kind: "checker"; digest: string };
  subject: JsonObject;
  language: string;
  context: JsonObject;
}
export type ObservationEffect =
  | { kind: "resolve"; reference: ArtifactReference }
  | CheckObservation;
export interface CheckObservationResult {
  result: CheckerResult;
  taskId?: string;
  executionId?: string;
}
export interface ObservationPolicy {
  maxDepth: number;
  maxObservations: number;
  maxChecks: number;
}
export const observationDefaults: ObservationPolicy = {
  maxDepth: 8,
  maxObservations: 64,
  maxChecks: 128,
};

/** Shared artifact preparation, with IO supplied by the owning task adapter. */
export async function prepareObjective(
  reference: ArtifactReference,
  resolve: (reference: ArtifactReference) => Promise<ContractArtifact>,
  languages: readonly string[],
  requested?: string,
  languageSelection = selectLanguage,
): Promise<PreparedObjective> {
  const artifact = await resolve(reference);
  if (
    !("checkers" in artifact.manifest) ||
    (reference.digest && reference.digest !== artifact.digest)
  )
    throw new Error("Invalid Objective binding.");
  const language = languageSelection(artifact.manifest.languages, languages, requested);
  const checkers: PreparedObjective["checkers"] = {};
  for (const [ref, binding] of Object.entries(artifact.manifest.checkers)) {
    const checker = await resolve({ kind: "checker", url: binding.url, digest: binding.digest });
    if (!("entry" in checker.manifest) || checker.digest !== binding.digest)
      throw new Error("Invalid Checker binding.");
    checkers[ref] = checker as ContractArtifact<CheckerManifest>;
  }
  const objective = artifact as PreparedObjective["artifact"];
  return {
    artifact: objective,
    checkers,
    pages: composeObjectivePages(objective, checkers),
    language,
  };
}

/**
 * The existing ObjectiveService interpretation, expressed as a deterministic
 * effect iterator. Live adapters and evidence replay use the same business truth.
 */
export function* observeObjective(
  root: PreparedObjective,
  request: ObservationInput,
  options: {
    languages: readonly string[];
    observedAt: string;
    policy?: ObservationPolicy;
    id?: () => string;
    progress?: (progress: ObservationProgressSet) => void;
  },
): Generator<ObservationEffect, ObjectiveObservation, PreparedObjective | CheckObservationResult> {
  const policy = options.policy ?? observationDefaults;
  const bindings = { ...request.bindings, [request.objective.url]: root.artifact.digest };
  const cache = new Map<string, PreparedObjective>([
    [`${request.objective.url}\0${root.artifact.digest}`, root],
  ]);
  const progress: ObservationProgressSet = { observations: [], invocations: [] };
  const active = new Set<string>();
  let sequence = 0;
  const id = options.id ?? (() => String(++sequence));
  const emit = () => options.progress?.(progress);
  function* resolve(
    reference: ArtifactReference,
  ): Generator<ObservationEffect, PreparedObjective, PreparedObjective | CheckObservationResult> {
    const pinned = bindings[reference.url];
    if (pinned && reference.digest && pinned !== reference.digest)
      throw new Error("Dependency binding conflict.");
    const digest = pinned ?? reference.digest;
    const previous = digest ? cache.get(`${reference.url}\0${digest}`) : undefined;
    if (previous) return previous;
    const prepared = (yield {
      kind: "resolve",
      reference: { ...reference, ...(digest ? { digest } : {}) },
    }) as PreparedObjective;
    if (digest && prepared.artifact.digest !== digest) throw new Error("Dependency changed.");
    bindings[reference.url] = prepared.artifact.digest;
    cache.set(`${reference.url}\0${prepared.artifact.digest}`, prepared);
    return prepared;
  }
  function* leaf(
    prepared: PreparedObjective,
    subject: JsonObject,
    level: string,
    ref: string,
    observation: ObservationProgress,
    resolutions?: Json[],
  ): Generator<
    ObservationEffect,
    { result: CheckerResult; invocation: InvocationProgress },
    PreparedObjective | CheckObservationResult
  > {
    if (progress.invocations.length >= policy.maxChecks)
      throw new Error("Invocation budget exhausted.");
    const binding = prepared.artifact.manifest.checkers[ref];
    const checker = prepared.checkers[ref];
    if (!binding || !checker) throw new Error("Missing Checker binding.");
    const invocation: InvocationProgress = {
      id: id(),
      observationId: observation.id,
      objective: observation.objective,
      level,
      checker: ref,
      state: "mapping",
    };
    progress.invocations.push(invocation);
    emit();
    const mapped = mapSubject(binding.subjectMapping, subject);
    if (!validateArtifactSubject(checker.manifest, mapped))
      throw new Error("Mapped subject violates Checker schema.");
    const response = (yield {
      kind: "check",
      invocationId: invocation.id,
      observationId: observation.id,
      objective: observation.objective,
      level,
      checker: ref,
      reference: { kind: "checker", url: binding.url, digest: binding.digest },
      subject: mapped,
      language: selectLanguage(checker.manifest.languages, [
        root.language,
        ...options.languages,
        ...checker.manifest.languages,
      ]),
      context: { ...request.context, ...(resolutions ? { resolutions } : {}) },
    }) as CheckObservationResult;
    const result = parseCheckerResult(
      { status: 200, message: "", payload: response.result },
      checker.manifest,
    );
    if (response.taskId) invocation.taskId = response.taskId;
    if (response.executionId) invocation.executionId = response.executionId;
    invocation.state = "completed";
    emit();
    return { result, invocation };
  }
  function* observe(
    prepared: PreparedObjective,
    url: string,
    subject: JsonObject,
    depth: number,
    parentInvocation?: string,
  ): Generator<
    ObservationEffect,
    ObjectiveObservation,
    PreparedObjective | CheckObservationResult
  > {
    if (depth > policy.maxDepth || progress.observations.length >= policy.maxObservations)
      throw new Error("Dependency observation budget exhausted.");
    if (!validateArtifactSubject(prepared.artifact.manifest, subject))
      throw new Error("Invalid dependency subject.");
    const key = canonicalJson({ url, digest: prepared.artifact.digest, subject });
    if (active.has(key)) throw new Error("Dependency observation cycle.");
    active.add(key);
    const objective: ExactObjective = { kind: "objective", url, digest: prepared.artifact.digest };
    const observation: ObservationProgress = {
      id: id(),
      ...(parentInvocation ? { parentInvocation } : {}),
      objective,
      currentLevel: "initial",
      attainedLevel: "initial",
      levels: prepared.artifact.manifest.levels.map((level) => ({
        id: level.id,
        state: "pending",
      })),
    };
    progress.observations.push(observation);
    emit();
    try {
      const problems: ObjectiveObservation["problems"] = [];
      for (const level of request.targetLevel === "initial" && depth === 0
        ? []
        : prepared.artifact.manifest.levels) {
        observation.currentLevel = level.id;
        const status = observation.levels.find((item) => item.id === level.id)!;
        status.state = "running";
        emit();
        for (const ref of level.checks) {
          let check = yield* leaf(prepared, subject, level.id, ref, observation);
          const resolutions = [];
          for (const requirement of check.result.requirements ?? []) {
            const dependency = yield* resolve(requirement.objective);
            const rank = (id: string) =>
              id === "initial"
                ? 0
                : id === "terminal"
                  ? dependency.artifact.manifest.levels.length
                  : dependency.artifact.manifest.levels.findIndex((level) => level.id === id) + 1;
            if (
              requirement.expectedLevelId !== "initial" &&
              rank(requirement.expectedLevelId) === 0
            )
              throw new Error("Unknown dependency target.");
            const observed = yield* observe(
              dependency,
              requirement.objective.url,
              requirement.subject,
              depth + 1,
              check.invocation.id,
            );
            const ok = rank(observed.current.levelId) >= rank(requirement.expectedLevelId);
            resolutions.push({
              requirement,
              result: {
                ok,
                problems: ok
                  ? []
                  : [
                      {
                        kind: "dependency",
                        ...requirement,
                        objective: observed.current.objective,
                        currentLevelId: observed.current.levelId,
                      },
                    ],
              },
            });
          }
          if (resolutions.length) {
            check = yield* leaf(
              prepared,
              subject,
              level.id,
              ref,
              observation,
              resolutions as unknown as Json[],
            );
            if (check.result.requirements?.length)
              throw new Error("Unresolved dependency requirements after recheck.");
          }
          for (const problem of check.result.problems) {
            if (
              problem.kind === "dependency" &&
              !resolutions.some((resolution) =>
                resolution.result.problems.some(
                  (candidate) =>
                    canonicalJson(candidate as unknown as Json) ===
                    canonicalJson(problem as unknown as Json),
                ),
              )
            )
              throw new Error("Dependency evidence does not match this observation.");
            problems.push({ objective, levelId: level.id, checker: ref, problem });
          }
        }
        status.state = problems.length ? "blocked" : "passed";
        if (!problems.length) observation.attainedLevel = level.id;
        emit();
        if (problems.length) break;
      }
      return {
        current: { objective, levelId: observation.attainedLevel },
        problems,
        gapSummary: problems.length ? `${problems.length} problem(s)` : "",
        observedAt: options.observedAt,
        bindings: { ...bindings },
      };
    } finally {
      active.delete(key);
    }
  }
  const result = yield* observe(root, request.objective.url, request.subject, 0);
  result.bindings = { ...bindings };
  return result;
}
