import { AsyncLocalStorage } from "node:async_hooks";
import { Effect } from "@potential-guide/effects";
import { observe } from "./pilot.js";
import type {
  CheckProbe,
  CheckResult,
  DependencyProblem,
  Envelope,
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
  const index = [...spec.manifest.levels.map(({ id }) => id), "terminal"].indexOf(level);
  if (index < 0)
    throw new ObjectiveOperationError(`Unknown level ${level} for ${spec.objectiveId}.`);
  return index;
}
interface Scope {
  readonly versions: Record<string, string>;
  readonly bindings: Map<
    string,
    Promise<{ readonly spec: PilotSpec; readonly runtime: PilotRuntime }>
  >;
  readonly stack: readonly string[];
  readonly evidence: Map<
    string,
    { readonly spec: PilotSpec; readonly observation: PilotObservation }
  >;
  readonly budget: { remaining: number; readonly deadline: number; readonly maxDepth: number };
  readonly runtime: PilotRuntime;
  readonly signal: AbortSignal;
}
const scopes = new AsyncLocalStorage<Scope>();
function mergeVersion(versions: Record<string, string>, id: string, version: string) {
  if (
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(version) ||
    (versions[id] !== undefined && versions[id] !== version)
  )
    throw new ObjectiveOperationError(
      `Conflicting source version or missing exact commit for ${id}.`,
    );
  versions[id] = version;
}

export async function observationScope<T>(
  input: PilotInput,
  runtime: PilotRuntime,
  signal: AbortSignal,
  use: (versions: Record<string, string>, signal: AbortSignal) => Promise<T>,
): Promise<T> {
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
    deadline: Date.now() + limits.timeoutMs,
    maxDepth: limits.maxDepth,
  };
  const key = canonical([input.spec.objectiveId, input.subject]);
  const stack = parent?.stack ?? [];
  if (stack.includes(key))
    throw new ObjectiveOperationError(
      `Recursive dependency observation: ${[...stack, key].join(" -> ")}.`,
    );
  if (stack.length >= budget.maxDepth || --budget.remaining < 0 || Date.now() >= budget.deadline)
    throw new ObjectiveOperationError("Dependency observation budget exhausted.");
  const versions = parent?.versions ?? {};
  mergeVersion(versions, input.spec.objectiveId, input.spec.version);
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, ...(parent ? [parent.signal] : []), timeout.signal]);
  const timer = setTimeout(
    () => timeout.abort(new Error("Dependency observation deadline exceeded.")),
    budget.deadline - Date.now(),
  );
  try {
    return await scopes.run(
      {
        versions,
        bindings: parent?.bindings ?? new Map(),
        stack: [...stack, key],
        evidence: new Map(),
        budget,
        runtime,
        signal: combined,
      },
      () => use(versions, combined),
    );
  } finally {
    clearTimeout(timer);
  }
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
  rank(input.spec, observation.current.levelId);
  for (const [id, version] of Object.entries(observation.versions))
    mergeVersion(scope.versions, id, version);
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
    validateSubject(problem.subject, compileDomain(evidence.spec.manifest.domainSchema)) !== null ||
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
    const result = yield* observe(input, runtime);
    if (result.payload === null) return result;
    const observation = result.payload;
    const current = yield* Effect.try(() => {
      if (observation.current.objectiveId !== input.spec.objectiveId)
        throw new ObjectiveOperationError("Observation belongs to a different Objective.");
      return rank(input.spec, observation.current.levelId);
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
    if (!process.send || !process.connected)
      throw new ObjectiveOperationError(
        "A source dependency probe requires the owning process-probe IPC binding.",
      );
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const clean = () => {
        process.off("message", onMessage);
        process.off("disconnect", onDisconnect);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        clean();
        reject(signal.reason);
      };
      const onDisconnect = () => {
        clean();
        reject(new ObjectiveOperationError("Dependency source binding disconnected."));
      };
      const onMessage = (value: unknown) => {
        if (
          !record(value) ||
          value.type !== "pguide.dependency.result" ||
          value.requestId !== requestId
        )
          return;
        clean();
        if (typeof value.error === "string")
          resolve({
            status: 502,
            payload: null,
            message: `dependency-observation: ${value.error}`,
          });
        else {
          // The ordinary parser is imported lazily to keep the pilot/dependency module cycle inert.
          void import("./pilot.js")
            .then(({ parseCheckEnvelope }) => resolve(parseCheckEnvelope(value.envelope)))
            .catch(reject);
        }
      };
      process.on("message", onMessage);
      process.once("disconnect", onDisconnect);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) return onAbort();
      process.send?.({ type: "pguide.dependency.request", requestId, target, subject }, (error) => {
        if (error) {
          clean();
          reject(error);
        }
      });
    });
  };
}
