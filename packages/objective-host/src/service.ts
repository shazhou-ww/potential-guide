import { randomUUID } from "node:crypto";
import {
  type ArtifactReference,
  type CheckerResult,
  canonicalJson,
  jsonObject,
  validateArtifactReference,
  validateArtifactSubject,
} from "@potential-guide/check-artifacts";
import {
  observeObjective,
  prepareObjective,
  type PreparedObjective as ObservationPrepared,
  type CheckObservationResult,
} from "@potential-guide/check-artifacts/observation";
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
  serviceTerminal,
  selectServiceLanguage,
} from "@potential-guide/checker-host";
import type { ObjectiveObservation, ProbeEvidence, ProbeProgress, ProbeRequest } from "./types.js";

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
  resolved: ResolvedContract & { manifest: ObservationPrepared["artifact"]["manifest"] };
  checkers: ObservationPrepared["checkers"];
  pages: ObservationPrepared["pages"];
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
      const prepared = await prepareObjective(
        reference,
        (reference) => repository.resolve(reference, scope, signal),
        languages,
        requested,
        selectServiceLanguage,
      );
      const resolved = prepared.artifact as PreparedObjective["resolved"];
      return {
        resolved,
        artifact: resolved.metadata,
        checkers: prepared.checkers,
        pages: prepared.pages,
        language: prepared.language,
        compatibility: "",
      };
    };
    const shared = (value: PreparedObjective): ObservationPrepared => ({
      artifact: value.resolved,
      checkers: value.checkers,
      pages: value.pages,
      language: value.language,
    });
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
        const evidence: ProbeEvidence = { bindings: {}, checks: [] };
        const owned = new Set<string>();
        let progress: ProbeProgress = { observations: [], invocations: [] };
        const cancel = () => {
          for (const id of owned) checks.cancel(id, execution.scope);
        };
        execution.signal.addEventListener("abort", cancel, { once: true });
        const iterator = observeObjective(shared(root), request, {
          languages,
          observedAt: new Date().toISOString(),
          id: randomUUID,
          progress(value) {
            progress = value as ProbeProgress;
            execution.progress(progress);
          },
        });
        try {
          let next = iterator.next();
          while (!next.done) {
            execution.signal.throwIfAborted();
            const effect = next.value;
            if (effect.kind === "resolve") {
              next = iterator.next(
                shared(
                  await prepare(effect.reference, execution.scope, execution.signal, root.language),
                ),
              );
              continue;
            }
            const remaining = Math.floor(execution.deadline - performance.now());
            if (remaining < 1) throw new Error("Observation deadline expired.");
            const accepted = checks.accept(
              {
                checker: { url: effect.reference.url, digest: effect.reference.digest },
                subject: effect.subject,
                language: effect.language,
                context: effect.context,
                freshness: "started-after-request",
                timeoutMs: Math.min(120_000, remaining),
              },
              execution.scope,
            );
            owned.add(accepted.taskId);
            try {
              const invocation = progress.invocations.find(
                (item) => item.id === effect.invocationId,
              )!;
              invocation.taskId = accepted.taskId;
              const snapshot = await waitForCheck(checks, accepted.taskId, execution, (state) => {
                invocation.state = state.state;
                if (state.executionId) invocation.executionId = state.executionId;
                execution.progress(progress);
              });
              evidence.checks.push({ invocationId: effect.invocationId, snapshot });
              if (!snapshot.result || !snapshot.evidence)
                throw new Error("Missing child execution evidence.");
              const response: CheckObservationResult = {
                result: snapshot.result,
                taskId: snapshot.taskId,
                ...(snapshot.executionId ? { executionId: snapshot.executionId } : {}),
              };
              next = iterator.next(response);
            } finally {
              owned.delete(accepted.taskId);
            }
          }
          evidence.bindings = { ...next.value.bindings };
          next.value.observedAt = new Date().toISOString();
          return { result: next.value, evidence };
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
    const prepared = await prepareObjective(
      { kind: "objective", url: artifact.metadata.source, digest },
      async (reference) =>
        reference.kind === "objective"
          ? artifact
          : repositoryResolve(this.repository, reference, scope),
      this.languages,
      requested,
      selectServiceLanguage,
    );
    const page = prepared.pages[prepared.language]?.[id];
    if (!page)
      throw new TaskProtocolError(404, {
        code: "reference_not_found",
        stage: "resolve",
        message: "Reference page not found.",
      });
    return structuredClone(page);
  }
}
function repositoryResolve(
  repository: ContractRepository,
  reference: ArtifactReference,
  scope: string,
) {
  return repository.resolve(reference, scope, AbortSignal.timeout(30_000));
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
