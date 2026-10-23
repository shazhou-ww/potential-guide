import { AsyncLocalStorage } from "node:async_hooks";
import { Effect } from "@potential-guide/effects";
import { attainedLevelRank, levelRank } from "@potential-guide/pilot-protocol";
import { observe } from "./pilot.js";
import { validateGitPilotSource } from "./resources.js";
import type {
  CheckProbe,
  CheckResult,
  DependencyProblem,
  DependencyResolution,
  Envelope,
  GitObjectiveSource,
  PilotInput,
  PilotObservation,
  PilotRuntime,
  PilotSpec,
  Subject,
} from "./types.js";
import {
  compileDomain,
  json,
  ObjectiveOperationError,
  record,
  validateSubject,
} from "./validation.js";

export interface ObjectiveLevelCheckInput extends PilotInput {
  readonly expectedLevelId: string;
}
export interface ObjectiveLevelCheck {
  readonly passed: boolean;
  readonly observation: PilotObservation;
}
export interface DependencyObservationContext {
  readonly recordObservation: (input: PilotInput, observation: PilotObservation) => void;
}
export type ObjectiveDependencyTarget = Omit<ObjectiveLevelCheckInput, "subject">;
export interface ObjectiveDependencySource {
  readonly objectiveId: string;
  readonly expectedLevelId: string;
  readonly language?: string;
}

function canonical(value: unknown): string {
  if (!json(value)) throw new ObjectiveOperationError("Expected finite JSON data.");
  function sort(entry: unknown): unknown {
    if (Array.isArray(entry)) return entry.map(sort);
    if (record(entry))
      return Object.fromEntries(
        Object.keys(entry)
          .sort()
          .map((key) => [key, sort(entry[key])]),
      );
    return entry;
  }
  return JSON.stringify(sort(value));
}
function rank(spec: PilotSpec, level: string): number {
  return levelRank(spec, level);
}
interface Scope {
  readonly versions: Record<string, string>;
  readonly sources: Record<string, GitObjectiveSource>;
  readonly bindings: Map<
    string,
    Promise<{ readonly spec: PilotSpec; readonly runtime: PilotRuntime }>
  >;
  readonly observations: Map<PilotRuntime, Map<string, Envelope<PilotObservation>>>;
  readonly resources: Map<string, Promise<unknown>>;
  readonly releases: (() => Promise<void>)[];
  readonly stack: readonly string[];
  readonly evidence: Map<
    string,
    { readonly spec: PilotSpec; readonly observation: PilotObservation }
  >;
  readonly budget: {
    remaining: number;
    executed: number;
    reused: number;
    readonly deadline: number;
    readonly maxDepth: number;
  };
  readonly runtime: PilotRuntime;
  readonly signal: AbortSignal;
}
const scopes = new AsyncLocalStorage<Scope>();
const workerResolutions = new AsyncLocalStorage<readonly DependencyResolution[]>();
export function withDependencyResolutions<T>(
  resolutions: readonly DependencyResolution[],
  use: () => T,
): T {
  return workerResolutions.run(resolutions, use);
}
function mergeVersion(versions: Record<string, string>, id: string, version: string) {
  if (
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(version) ||
    (versions[id] !== undefined && versions[id] !== version)
  )
    throw new ObjectiveOperationError(
      `Conflicting content version or missing exact tree for ${id}.`,
    );
  versions[id] = version;
}

export async function observationScope<T>(
  input: PilotInput,
  runtime: PilotRuntime,
  signal: AbortSignal,
  use: (
    versions: Record<string, string>,
    signal: AbortSignal,
    sources: Record<string, GitObjectiveSource>,
  ) => Promise<T>,
  reused = false,
): Promise<T> {
  const started = performance.now();
  const parent = scopes.getStore();
  const limits = runtime.observationBudget ?? {
    timeoutMs: 30_000,
    maxDepth: 32,
    maxObservations: 128,
  };
  if (
    !Object.values(limits).every((value) => Number.isSafeInteger(value) && value > 0) ||
    limits.timeoutMs > 2_147_483_647
  )
    throw new ObjectiveOperationError("Invalid observation budget.");
  const budget = parent?.budget ?? {
    remaining: limits.maxObservations,
    executed: 0,
    reused: 0,
    deadline: Date.now() + limits.timeoutMs,
    maxDepth: limits.maxDepth,
  };
  const key = canonical([input.spec.objectiveId, input.subject, input.targetLevel ?? null]);
  const stack = parent?.stack ?? [];
  if (stack.includes(key))
    throw new ObjectiveOperationError(
      `Recursive dependency observation: ${[...stack, key].join(" -> ")}.`,
    );
  if (stack.length >= budget.maxDepth || --budget.remaining < 0 || Date.now() >= budget.deadline)
    throw new ObjectiveOperationError(
      `observation-budget: ${input.spec.objectiveId}: budget exhausted: ${
        stack.length >= budget.maxDepth
          ? "maximum dependency depth exceeded"
          : budget.remaining < 0
            ? "maximum logical observations exceeded"
            : "total observation deadline exceeded"
      }.`,
    );
  if (reused) budget.reused++;
  else budget.executed++;
  const versions = parent?.versions ?? {};
  const sources = parent?.sources ?? {};
  mergeVersion(versions, input.spec.objectiveId, input.spec.version);
  if (input.spec.source !== undefined) {
    validateGitPilotSource(input.spec.objectiveId, input.spec.version, input.spec.source);
    sources[input.spec.objectiveId] = input.spec.source;
  }
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, ...(parent ? [parent.signal] : []), timeout.signal]);
  const timer = setTimeout(
    () =>
      timeout.abort(
        new ObjectiveOperationError(
          `observation-timeout: ${input.spec.objectiveId}: total observation deadline exceeded (${limits.timeoutMs}ms budget).`,
        ),
      ),
    budget.deadline - Date.now(),
  );
  const resources = parent?.resources ?? new Map<string, Promise<unknown>>();
  const releases = parent?.releases ?? [];
  let outcome: { value: T } | { error: unknown };
  try {
    combined.throwIfAborted();
    const value = await scopes.run(
      {
        versions,
        sources,
        bindings: parent?.bindings ?? new Map(),
        observations: parent?.observations ?? new Map(),
        resources,
        releases,
        stack: [...stack, key],
        evidence: new Map(),
        budget,
        runtime,
        signal: combined,
      },
      () => use(versions, combined, sources),
    );
    combined.throwIfAborted();
    outcome = { value };
  } catch (error) {
    outcome = { error: combined.aborted ? combined.reason : error };
  } finally {
    clearTimeout(timer);
  }
  if (parent === undefined) {
    await Promise.allSettled(resources.values());
    const exits = await Promise.allSettled(releases.map((release) => release()));
    const errors = exits.flatMap((exit) => (exit.status === "rejected" ? [exit.reason] : []));
    if (errors.length)
      throw new AggregateError(
        [...("error" in outcome ? [outcome.error] : []), ...errors],
        "Observation input-view cleanup failed.",
        "error" in outcome ? { cause: outcome.error } : undefined,
      );
    if (process.env.PGUIDE_TIMINGS === "1")
      process.stderr.write(
        `${JSON.stringify({
          type: "pguide-timing",
          phase: "observation",
          objectiveId: input.spec.objectiveId,
          durationMs: Math.round(performance.now() - started),
          executedObservations: budget.executed,
          reusedObservations: budget.reused,
          logicalObservations: budget.executed + budget.reused,
          inputViewResources: resources.size,
        })}\n`,
      );
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

/** Host-owned resources live for one complete observation, not the source binding. */
export async function observationResource<T>(
  key: string,
  acquire: (signal: AbortSignal) => Promise<T>,
  release: (value: T) => Promise<void>,
): Promise<T> {
  const scope = scopes.getStore();
  if (!scope) throw new ObjectiveOperationError("Input views require an active observation.");
  scope.signal.throwIfAborted();
  let pending = scope.resources.get(key);
  if (pending === undefined) {
    pending = acquire(scope.signal).then((value) => {
      scope.releases.push(() => release(value));
      return value;
    });
    scope.resources.set(key, pending);
  }
  return pending as Promise<T>;
}

export function recordDependencyObservation(
  input: PilotInput,
  observation: PilotObservation,
): void {
  const scope = scopes.getStore();
  if (!scope)
    throw new ObjectiveOperationError("Dependency evidence requires an active observation.");
  scope.signal.throwIfAborted();
  if (
    observation.current.objectiveId !== input.spec.objectiveId ||
    observation.versions[input.spec.objectiveId] !== input.spec.version
  )
    throw new ObjectiveOperationError("Dependency evidence has mismatched source identity.");
  attainedLevelRank(input.spec, observation.current.levelId);
  if (input.spec.source !== undefined) {
    for (const [id, version] of Object.entries(observation.versions))
      validateGitPilotSource(id, version, observation.sources?.[id]);
    if (observation.sources?.[input.spec.objectiveId]?.commit !== input.spec.source.commit)
      throw new ObjectiveOperationError("Dependency observation snapshot mismatch.");
  }
  for (const [id, version] of Object.entries(observation.versions))
    mergeVersion(scope.versions, id, version);
  for (const [id, source] of Object.entries(observation.sources ?? {})) {
    validateGitPilotSource(id, observation.versions[id] ?? "", source);
    const prior = scope.sources[id];
    if (
      prior !== undefined &&
      (prior.tree !== source.tree || prior.repositoryTree !== source.repositoryTree)
    )
      throw new ObjectiveOperationError(`Conflicting source content evidence for ${id}.`);
    scope.sources[id] = source;
  }
  scope.evidence.set(
    canonical([input.spec.objectiveId, input.subject, observation.current.levelId]),
    { spec: input.spec, observation },
  );
}

export function validateDependencyEvidence(problem: DependencyProblem): void {
  const evidence = scopes
    .getStore()
    ?.evidence.get(canonical([problem.objectiveId, problem.subject, problem.currentLevelId]));
  if (
    !evidence ||
    evidence.observation.current.levelId !== problem.currentLevelId ||
    validateSubject(problem.subject, compileDomain(evidence.spec.manifest.subjectSchema)) !==
      null ||
    rank(evidence.spec, problem.currentLevelId) >= rank(evidence.spec, problem.expectedLevelId)
  )
    throw new ObjectiveOperationError(
      "Dependency requires matching same-observation source and level evidence.",
    );
}

export function checkObjectiveLevel(
  input: ObjectiveLevelCheckInput,
  runtime: PilotRuntime,
): Effect.Effect<Envelope<ObjectiveLevelCheck>, Error> {
  return Effect.gen(function* () {
    const expected = yield* Effect.try(() => rank(input.spec, input.expectedLevelId));
    const request = {
      ...input,
      ...(input.expectedLevelId === "initial" ? { targetLevel: "initial" as const } : {}),
    };
    const scope = scopes.getStore();
    const revision =
      scope && input.expectedLevelId !== "initial"
        ? yield* Effect.tryPromise({
            try: () =>
              runtime.observationRevision?.(request, scope.signal) ?? Promise.resolve(undefined),
            catch: (error) =>
              error instanceof Error ? error : new ObjectiveOperationError(String(error)),
          })
        : undefined;
    const key =
      revision === undefined
        ? undefined
        : canonical([
            input.spec,
            input.subject,
            input.language ?? input.spec.manifest.defaultLanguage,
            request.targetLevel ?? null,
            revision,
          ]);
    const observations = scope?.observations.get(runtime);
    const prior = key === undefined ? undefined : observations?.get(key);
    const result =
      prior === undefined || scope === undefined
        ? yield* observe(request, runtime)
        : yield* Effect.tryPromise({
            try: () => observationScope(request, runtime, scope.signal, async () => prior, true),
            catch: (error) =>
              error instanceof Error ? error : new ObjectiveOperationError(String(error)),
          });
    if (prior === undefined && key !== undefined && scope && result.payload !== null) {
      const after = yield* Effect.tryPromise({
        try: () =>
          runtime.observationRevision?.(request, scope.signal) ?? Promise.resolve(undefined),
        catch: (error) =>
          error instanceof Error ? error : new ObjectiveOperationError(String(error)),
      });
      scope.signal.throwIfAborted();
      if (after === revision) {
        const entries = observations ?? new Map<string, Envelope<PilotObservation>>();
        entries.set(key, result);
        scope.observations.set(runtime, entries);
      }
    }
    if (result.payload === null) return result;
    const observation = result.payload;
    const current = yield* Effect.try(() => {
      if (observation.current.objectiveId !== input.spec.objectiveId)
        throw new ObjectiveOperationError("Observation belongs to a different Objective.");
      return attainedLevelRank(input.spec, observation.current.levelId);
    });
    return {
      status: 200,
      message: result.message,
      payload: { passed: current >= expected, observation },
    };
  });
}

export function createObjectiveDependencyProbe(
  target: ObjectiveDependencyTarget,
  runtime: PilotRuntime,
  context: DependencyObservationContext,
): CheckProbe {
  return async (subject, signal) => {
    try {
      const input = { ...target, subject };
      const result = await Effect.runPromise(checkObjectiveLevel(input, runtime), { signal });
      signal.throwIfAborted();
      if (result.payload === null) return result;
      context.recordObservation(input, result.payload.observation);
      return {
        status: 200,
        message: "",
        payload: result.payload.passed
          ? { ok: true, problems: [] }
          : {
              ok: false,
              problems: [
                {
                  kind: "dependency",
                  objectiveId: target.spec.objectiveId,
                  subject,
                  expectedLevelId: target.expectedLevelId,
                  currentLevelId: result.payload.observation.current.levelId,
                },
              ],
            },
      };
    } catch (cause) {
      signal.throwIfAborted();
      return {
        status: 502,
        payload: null,
        message: `dependency-observation: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  };
}

// Capturing the observation also binds IPC replies to the spawning check, not a later run.
export function bindDependencyRequest() {
  const scope = scopes.getStore();
  return async (
    target: ObjectiveDependencySource,
    subject: Subject,
    signal: AbortSignal,
  ): Promise<Envelope<CheckResult>> => {
    if (!scope?.runtime.resolveObjective)
      throw new ObjectiveOperationError("No source binding for dependency observations.");
    const resolveObjective = scope.runtime.resolveObjective;
    return scopes.run(scope, async () => {
      const combined = AbortSignal.any([scope.signal, signal]);
      combined.throwIfAborted();
      let binding = scope.bindings.get(target.objectiveId);
      if (!binding) {
        binding = resolveObjective(
          target.objectiveId,
          scope.versions[target.objectiveId],
          combined,
          scope.sources[target.objectiveId],
        );
        scope.bindings.set(target.objectiveId, binding);
      }
      const { spec, runtime } = await binding;
      combined.throwIfAborted();
      if (spec.objectiveId !== target.objectiveId)
        throw new ObjectiveOperationError("Resolved dependency identity mismatch.");
      mergeVersion(scope.versions, spec.objectiveId, spec.version);
      return createObjectiveDependencyProbe(
        {
          spec,
          expectedLevelId: target.expectedLevelId,
          ...(target.language === undefined ? {} : { language: target.language }),
        },
        runtime,
        { recordObservation: recordDependencyObservation },
      )(subject, combined);
    });
  };
}

export function createSourceObjectiveDependencyProbe(
  target: ObjectiveDependencySource,
): CheckProbe {
  return async (subject, signal) => {
    signal.throwIfAborted();
    const requirement = {
      objectiveId: target.objectiveId,
      subject,
      expectedLevelId: target.expectedLevelId,
    };
    const resolved = workerResolutions
      .getStore()
      ?.find((entry) => canonical(entry.requirement) === canonical(requirement));
    return {
      status: 200,
      message: "",
      payload: resolved?.result ?? { ok: false, problems: [], requirements: [requirement] },
    };
  };
}
