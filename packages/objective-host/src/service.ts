import { randomUUID } from "node:crypto";
import {
  type ArtifactReference,
  type CheckerManifest,
  type CheckerResult,
  type ContractArtifact,
  type DependencyRequirement,
  type Json,
  type JsonObject,
  type ObjectiveArtifactManifest,
  canonicalJson,
  composeObjectivePages,
  digestPattern,
  jsonObject,
  mapSubject,
  selectLanguage,
  validateArtifactReference,
  validateArtifactSubject,
} from "@potential-guide/check-artifacts";
import {
  type CheckerRequest,
  type CheckerSnapshot,
  type ContractRepository,
  type ExecutionContext,
  type PreparedTask,
  type ResolvedContract,
  type ServiceEvent,
  type CheckerEvidence,
  type TaskAdapter,
  TaskProtocolError,
  TaskService,
  selectServiceLanguage,
  serviceTerminal,
} from "@potential-guide/checker-host";
import type {
  ExactObjective,
  InvocationProgress,
  ObjectiveObservation,
  ObservationProgress,
  ProbeEvidence,
  ProbeProgress,
  ProbeRequest,
} from "./types.js";

export interface CheckServicePort {
  readonly environment: Readonly<Record<string, string>>;
  accept(request: CheckerRequest, scope: string): CheckerSnapshot;
  snapshot(id: string, scope: string): CheckerSnapshot;
  cancel(id: string, scope: string): CheckerSnapshot;
  subscribe(
    ids: readonly string[],
    scope: string,
    send: (event: ServiceEvent<CheckerResult, never, CheckerEvidence>) => void,
  ): () => unknown;
}
interface PreparedObjective extends PreparedTask {
  resolved: ResolvedContract & { manifest: ObjectiveArtifactManifest };
  checkers: Record<string, ContractArtifact<CheckerManifest>>;
  pages: ContractArtifact["pages"];
}
function normalize(request: ProbeRequest): ProbeRequest {
  if (
    !jsonObject(request) ||
    Object.keys(request).some(
      (key) =>
        ![
          "objective",
          "subject",
          "context",
          "language",
          "bindings",
          "targetLevel",
          "freshness",
          "timeoutMs",
        ].includes(key),
    ) ||
    !jsonObject(request.objective) ||
    Object.keys(request.objective).some((key) => !["url", "digest"].includes(key)) ||
    typeof request.objective.url !== "string" ||
    (request.objective.digest !== undefined && typeof request.objective.digest !== "string") ||
    !jsonObject(request.subject) ||
    (request.context !== undefined && !jsonObject(request.context)) ||
    (request.language !== undefined && typeof request.language !== "string") ||
    (request.targetLevel !== undefined && request.targetLevel !== "initial") ||
    (request.bindings !== undefined && !jsonObject(request.bindings))
  )
    throw new TaskProtocolError(400, {
      code: "invalid_request",
      stage: "validate",
      message: "Invalid Probe request.",
    });
  if (request.context && Object.hasOwn(request.context, "resolutions"))
    throw new TaskProtocolError(400, {
      code: "reserved_context",
      stage: "validate",
      message: "Dependency resolutions are owned by the Observation Execution.",
    });
  if (request.bindings)
    for (const [url, digest] of Object.entries(request.bindings)) {
      if (typeof digest !== "string") throw new Error("Invalid binding.");
      validateArtifactReference({ kind: "objective", url, digest });
    }
  if (Object.keys(request.bindings ?? {}).length > 128)
    throw new TaskProtocolError(400, {
      code: "binding_capacity",
      stage: "validate",
      message: "Too many exact bindings.",
    });
  return { ...request, context: request.context ?? {}, bindings: request.bindings ?? {} };
}
export class ObjectiveService extends TaskService<
  ProbeRequest,
  PreparedObjective,
  ObjectiveObservation,
  ProbeProgress,
  ProbeEvidence
> {
  constructor(
    readonly repository: ContractRepository,
    readonly checks: CheckServicePort,
    readonly languages: readonly string[] = ["en", "zh-CN"],
  ) {
    const environment = checks.environment;
    const prepare = async (
      reference: ArtifactReference,
      scope: string,
      signal: AbortSignal,
      requested?: string,
    ): Promise<PreparedObjective> => {
      const resolved = await repository.resolve(reference, scope, signal);
      if (!("checkers" in resolved.manifest)) throw new Error("Expected Objective.");
      const language = selectServiceLanguage(resolved.manifest.languages, languages, requested);
      const checkers: Record<string, ContractArtifact<CheckerManifest>> = {};
      for (const [ref, binding] of Object.entries(resolved.manifest.checkers)) {
        const checker = await repository.resolve(
          { kind: "checker", url: binding.url, digest: binding.digest },
          scope,
          signal,
        );
        if (!("entry" in checker.manifest) || checker.digest !== binding.digest)
          throw new Error("Invalid Checker binding.");
        checkers[ref] = checker as ContractArtifact<CheckerManifest>;
      }
      const objective = resolved as PreparedObjective["resolved"];
      const pages = composeObjectivePages(objective, checkers);
      return {
        resolved: objective,
        artifact: resolved.metadata,
        checkers,
        pages,
        language,
        compatibility: "",
      };
    };
    const adapter: TaskAdapter<
      ProbeRequest,
      PreparedObjective,
      ObjectiveObservation,
      ProbeProgress,
      ProbeEvidence
    > = {
      normalize,
      authorize(request, scope) {
        repository.authorize({ kind: "objective", ...request.objective }, scope);
        for (const [url, digest] of Object.entries(request.bindings ?? {}))
          repository.authorize({ kind: "objective", url, digest }, scope);
      },
      async prepare(request, scope, signal) {
        const pinned = request.bindings?.[request.objective.url];
        if (pinned && request.objective.digest && pinned !== request.objective.digest)
          throw new Error("Root binding conflict.");
        const prepared = await prepare(
          { kind: "objective", ...request.objective, ...(pinned ? { digest: pinned } : {}) },
          scope,
          signal,
          request.language,
        );
        if (!validateArtifactSubject(prepared.resolved.manifest, request.subject))
          throw new Error("Invalid Objective subject.");
        prepared.compatibility = canonicalJson({
          digest: prepared.resolved.digest,
          source: request.objective.url,
          subject: request.subject,
          context: request.context ?? {},
          bindings: request.bindings ?? {},
          language: prepared.language,
          target: request.targetLevel ?? "complete",
          environment: { ...environment },
          policy: "objective-v1",
        });
        return prepared;
      },
      async execute(root, request, execution) {
        execution.start();
        const bindings = { ...request.bindings };
        bindings[request.objective.url] = root.resolved.digest;
        const evidence: ProbeEvidence = { bindings, checks: [] };
        const progress: ProbeProgress = { observations: [], invocations: [] };
        const active = new Set<string>();
        const owned = new Set<string>();
        const emit = () => execution.progress(progress);
        const cancel = () => {
          for (const id of owned) checks.cancel(id, execution.scope);
        };
        execution.signal.addEventListener("abort", cancel, { once: true });
        const cache = new Map<string, PreparedObjective>([
          [`${request.objective.url}\0${root.resolved.digest}`, root],
        ]);
        async function resolve(reference: ArtifactReference) {
          const pinned = bindings[reference.url];
          if (pinned && reference.digest && pinned !== reference.digest)
            throw new Error("Dependency binding conflict.");
          const digest = pinned ?? reference.digest;
          if (digest && !new RegExp(digestPattern).test(digest))
            throw new Error("Invalid dependency digest.");
          const previous = digest ? cache.get(`${reference.url}\0${digest}`) : undefined;
          if (previous) return previous;
          const prepared = await prepare(
            { ...reference, ...(digest ? { digest } : {}) },
            execution.scope,
            execution.signal,
            root.language,
          );
          if (digest && prepared.resolved.digest !== digest) throw new Error("Dependency changed.");
          bindings[reference.url] = prepared.resolved.digest;
          cache.set(`${reference.url}\0${prepared.resolved.digest}`, prepared);
          return prepared;
        }
        async function leaf(
          prepared: PreparedObjective,
          subject: JsonObject,
          level: string,
          ref: string,
          observation: ObservationProgress,
          resolutions?: Json[],
        ) {
          execution.signal.throwIfAborted();
          if (progress.invocations.length >= 128) throw new Error("Invocation budget exhausted.");
          const binding = prepared.resolved.manifest.checkers[ref];
          const checker = prepared.checkers[ref];
          if (!binding || !checker) throw new Error("Missing Checker binding.");
          const invocation: InvocationProgress = {
            id: randomUUID(),
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
          const remaining = Math.floor(execution.deadline - performance.now());
          if (remaining < 1) throw new Error("Observation deadline expired.");
          // Each child is accepted only after the parent Execution's start boundary.
          const accepted = checks.accept(
            {
              checker: { url: binding.url, digest: binding.digest },
              subject: mapped,
              language: selectLanguage(checker.manifest.languages, [
                root.language,
                ...languages,
                ...checker.manifest.languages,
              ]),
              context: { ...request.context, ...(resolutions ? { resolutions } : {}) },
              freshness: "started-after-request",
              timeoutMs: Math.min(120_000, remaining),
            },
            execution.scope,
          );
          owned.add(accepted.taskId);
          invocation.taskId = accepted.taskId;
          try {
            const snapshot = await waitForCheck(checks, accepted.taskId, execution, (state) => {
              invocation.state = state.state;
              if (state.executionId) invocation.executionId = state.executionId;
              emit();
            });
            evidence.checks.push({ invocationId: invocation.id, snapshot });
            if (!snapshot.result || !snapshot.evidence)
              throw new Error("Missing child execution evidence.");
            return { result: snapshot.result, invocation };
          } finally {
            owned.delete(accepted.taskId);
          }
        }
        async function observe(
          prepared: PreparedObjective,
          url: string,
          subject: JsonObject,
          depth: number,
          parentInvocation?: string,
        ): Promise<ObjectiveObservation> {
          execution.signal.throwIfAborted();
          if (depth > 8 || progress.observations.length >= 64)
            throw new Error("Dependency observation budget exhausted.");
          if (!validateArtifactSubject(prepared.resolved.manifest, subject))
            throw new Error("Invalid dependency subject.");
          const key = canonicalJson({ url, digest: prepared.resolved.digest, subject });
          if (active.has(key)) throw new Error("Dependency observation cycle.");
          active.add(key);
          const objective: ExactObjective = {
            kind: "objective",
            url,
            digest: prepared.resolved.digest,
          };
          const observation: ObservationProgress = {
            id: randomUUID(),
            ...(parentInvocation ? { parentInvocation } : {}),
            objective,
            currentLevel: "initial",
            attainedLevel: "initial",
            levels: prepared.resolved.manifest.levels.map((level) => ({
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
              : prepared.resolved.manifest.levels) {
              observation.currentLevel = level.id;
              const status = observation.levels.find((item) => item.id === level.id);
              if (!status) throw new Error("Missing level progress.");
              status.state = "running";
              emit();
              for (const ref of level.checks) {
                let check = await leaf(prepared, subject, level.id, ref, observation);
                const resolutions: { requirement: DependencyRequirement; result: CheckerResult }[] =
                  [];
                for (const requirement of check.result.requirements ?? []) {
                  const dependency = await resolve(requirement.objective);
                  const rank = (id: string) =>
                    id === "initial"
                      ? 0
                      : id === "terminal"
                        ? dependency.resolved.manifest.levels.length
                        : dependency.resolved.manifest.levels.findIndex(
                            (level) => level.id === id,
                          ) + 1;
                  if (
                    requirement.expectedLevelId !== "initial" &&
                    rank(requirement.expectedLevelId) === 0
                  )
                    throw new Error("Unknown dependency target.");
                  const observed = await observe(
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
                  check = await leaf(
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
                          candidate.kind === "dependency" &&
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
              observedAt: new Date().toISOString(),
              bindings: { ...bindings },
            };
          } finally {
            active.delete(key);
          }
        }
        try {
          const result = await observe(root, request.objective.url, request.subject, 0);
          result.bindings = { ...bindings };
          return { result, evidence };
        } finally {
          execution.signal.removeEventListener("abort", cancel);
          cancel();
        }
      },
    };
    super(adapter);
    this.environment = Object.freeze({ ...environment });
    this.prepareReference = prepare;
  }
  readonly environment: Readonly<Record<string, string>>;
  private readonly prepareReference: (
    reference: ArtifactReference,
    scope: string,
    signal: AbortSignal,
    requested?: string,
  ) => Promise<PreparedObjective>;
  describe(reference: ArtifactReference, scope: string, signal: AbortSignal, language?: string) {
    return this.prepareReference(reference, scope, signal, language);
  }
  async reference(digest: string, id: string, scope: string, requested?: string) {
    const artifact = await this.repository.artifact(digest, scope);
    if (!("checkers" in artifact.manifest)) throw new Error("Expected Objective.");
    const language = selectServiceLanguage(artifact.manifest.languages, this.languages, requested);
    const checkers: Record<string, ContractArtifact<CheckerManifest>> = {};
    for (const [ref, binding] of Object.entries(artifact.manifest.checkers)) {
      const checker = await this.repository.resolve(
        { kind: "checker", url: binding.url, digest: binding.digest },
        scope,
        AbortSignal.timeout(30_000),
      );
      if (!("entry" in checker.manifest)) throw new Error("Expected Checker.");
      checkers[ref] = checker as ContractArtifact<CheckerManifest>;
    }
    const pages = composeObjectivePages(
      artifact as ContractArtifact<ObjectiveArtifactManifest>,
      checkers,
    );
    const page = pages[language]?.[id];
    if (!page)
      throw new TaskProtocolError(404, {
        code: "reference_not_found",
        stage: "resolve",
        message: "Reference page not found.",
      });
    return structuredClone(page);
  }
}
function waitForCheck(
  checks: CheckServicePort,
  id: string,
  execution: ExecutionContext<ProbeProgress, ProbeEvidence>,
  update: (snapshot: CheckerSnapshot) => void,
): Promise<CheckerSnapshot> {
  return new Promise((resolve, reject) => {
    let release: (() => unknown) | undefined;
    let settled = false;
    const cleanup = () => {
      settled = true;
      release?.();
      execution.signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(execution.signal.reason);
    };
    execution.signal.addEventListener("abort", abort, { once: true });
    if (execution.signal.aborted) {
      abort();
      return;
    }
    try {
      release = checks.subscribe([id], execution.scope, ({ snapshot }) => {
        update(snapshot);
        if (!serviceTerminal(snapshot)) return;
        cleanup();
        if (snapshot.state === "completed") resolve(snapshot);
        else
          reject(
            new TaskProtocolError(
              502,
              snapshot.error ?? {
                code: "child_failed",
                stage: "observe",
                message: "Child Check failed.",
              },
            ),
          );
      });
      if (settled) release();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
