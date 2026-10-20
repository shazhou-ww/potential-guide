import type { SubscriptionRef } from "@potential-guide/effects";
import { activate, Effect } from "@potential-guide/effects";
import { parseCheckEnvelope, readPage } from "@potential-guide/pilot-protocol";
import { observationScope, validateDependencyEvidence } from "./dependency.js";
import { canonicalObjectiveUri } from "./resources.js";
import type {
  CheckResult,
  Envelope,
  PilotInput,
  PilotObservation,
  PilotRuntime,
  PilotSpec,
  Problem,
} from "./types.js";
import {
  compileDomain,
  fields,
  immutable,
  json,
  ObjectiveConfigurationError,
  ObjectiveOperationError,
  parseManifest,
  record,
  validateSubject,
} from "./validation.js";

export {
  describeLevels,
  loadPilotSpec,
  parseCheckEnvelope,
  parseDependencyProblem,
  readPage,
  searchPages,
} from "@potential-guide/pilot-protocol";

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function observe(
  input: PilotInput,
  runtime: PilotRuntime,
): Effect.Effect<Envelope<PilotObservation>, Error> {
  return Effect.callback<Envelope<PilotObservation>, Error>((resume, signal) => {
    const pending = observationScope(
      input,
      runtime,
      signal,
      async (versions, signal, sources): Promise<Envelope<PilotObservation>> => {
        signal.throwIfAborted();
        const concurrency = runtime.checkConcurrency ?? 1;
        if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
          throw new ObjectiveConfigurationError(
            "Check concurrency must be a positive safe integer.",
          );
        }
        const language = input.language ?? input.spec.manifest.defaultLanguage;
        function prepare(
          spec: PilotSpec,
          subject: unknown,
        ): () => Promise<Envelope<PilotObservation>> {
          if (!record(spec)) throw new ObjectiveConfigurationError("PilotSpec must be an object.");
          fields(spec, ["objectiveId", "version", "manifest", "locales"], ["source"]);
          if (
            !spec.objectiveId.startsWith("git+") ||
            canonicalObjectiveUri(spec.objectiveId) !== spec.objectiveId ||
            !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(spec.version)
          ) {
            throw new ObjectiveConfigurationError(
              "Observation requires a canonical Git Pilot directory and an exact content version; static working-tree specifications cannot be probed.",
            );
          }
          const manifest = parseManifest(JSON.stringify(spec.manifest));
          const issues = validateSubject(subject, compileDomain(manifest.subjectSchema));
          if (issues !== null || !record(subject) || !json(subject)) {
            throw new ObjectiveConfigurationError(
              `Invalid subject for ${spec.objectiveId}: ${JSON.stringify(issues)}.`,
            );
          }
          if (spec.locales[language] === undefined)
            throw new ObjectiveConfigurationError(
              `Unsupported language ${language} for ${spec.objectiveId}.`,
            );
          versions[spec.objectiveId] = spec.version;
          const stableSubject = immutable(structuredClone(subject));
          return async () => {
            signal.throwIfAborted();
            for (const level of manifest.levels) {
              signal.throwIfAborted();
              const results = await Effect.runPromise(
                Effect.forEach(
                  level.checks,
                  (check) =>
                    Effect.callback<Envelope<CheckResult>, Error>((resume, checkSignal) => {
                      const pending = (async (): Promise<Envelope<CheckResult>> => {
                        checkSignal.throwIfAborted();
                        const ref = {
                          objectiveId: spec.objectiveId,
                          levelId: level.id,
                          checkId: check.id,
                        };
                        try {
                          const envelope = parseCheckEnvelope(
                            await runtime.resolveCheck(ref)(stableSubject, checkSignal),
                          );
                          if (envelope.payload === null) return envelope;
                          for (const problem of envelope.payload.problems) {
                            if (problem.kind === "dependency") validateDependencyEvidence(problem);
                            else if (!check.problems.includes(problem.id))
                              throw new ObjectiveOperationError(
                                `Undeclared problem ${problem.id} in ${JSON.stringify(ref)}.`,
                              );
                          }
                          return envelope;
                        } catch (cause) {
                          checkSignal.throwIfAborted();
                          return {
                            status: 502,
                            payload: null,
                            message: `check-invocation: ${JSON.stringify(ref)}: ${errorMessage(cause)}`,
                          } as const;
                        }
                      })();
                      const settled = pending.then(
                        (value) => resume(Effect.succeed(value)),
                        (cause: unknown) =>
                          resume(
                            Effect.fail(
                              cause instanceof Error
                                ? cause
                                : new ObjectiveOperationError(String(cause)),
                            ),
                          ),
                      );
                      return Effect.promise(() => settled);
                    }),
                  { concurrency },
                ),
                { signal },
              );
              signal.throwIfAborted();
              const failure =
                results.find((result) => result.payload === null && result.status < 500) ??
                results.find((result) => result.payload === null);
              if (failure !== undefined && failure.payload === null) return failure;
              const problems: Problem[] = results.flatMap((result, index) => {
                const check = level.checks[index];
                if (check === undefined)
                  throw new ObjectiveOperationError("Unexpected check result index.");
                return result.payload === null
                  ? []
                  : result.payload.problems.map(
                      (problem): Problem =>
                        problem.kind === "dependency"
                          ? problem
                          : {
                              kind: "internal",
                              ref: {
                                objectiveId: spec.objectiveId,
                                levelId: level.id,
                                checkId: check.id,
                                problemId: problem.id,
                              },
                              parameters: problem.parameters,
                            },
                    );
              });
              if (problems.length > 0)
                return {
                  status: 200,
                  message: "",
                  payload: immutable({
                    current: { objectiveId: spec.objectiveId, levelId: level.id },
                    problems,
                    gapSummary: problems
                      .map((problem) => {
                        if (problem.kind === "dependency") {
                          return language.startsWith("zh")
                            ? `依赖 ${problem.objectiveId} ${JSON.stringify(problem.subject)}：需要 ${problem.expectedLevelId}，当前 ${problem.currentLevelId}。`
                            : `Dependency ${problem.objectiveId} ${JSON.stringify(problem.subject)}: requires ${problem.expectedLevelId}, current ${problem.currentLevelId}.`;
                        }
                        const detail = problem.parameters.description;
                        const scoped = `levels/${problem.ref.levelId}/checks/${problem.ref.checkId}/problems/${problem.ref.problemId}`;
                        return typeof detail === "string" && detail.trim()
                          ? detail
                          : readPage(
                              spec,
                              spec.locales[language]?.[scoped] === undefined
                                ? `problems/${problem.ref.problemId}`
                                : scoped,
                              language,
                            ).description;
                      })
                      .join("\n"),
                    observedAt: new Date().toISOString(),
                    versions: { ...versions },
                    sources: { ...sources },
                  }),
                };
            }
            return {
              status: 200,
              message: "",
              payload: immutable({
                current: { objectiveId: spec.objectiveId, levelId: "terminal" },
                problems: [],
                gapSummary: "",
                observedAt: new Date().toISOString(),
                versions: { ...versions },
                sources: { ...sources },
              }),
            };
          };
        }
        const result = await prepare(input.spec, input.subject)();
        runtime.onObservation?.(result);
        return result;
      },
    );
    const settled = pending.then(
      (value) => resume(Effect.succeed(value)),
      (cause: unknown) =>
        resume(
          Effect.fail(cause instanceof Error ? cause : new ObjectiveOperationError(String(cause))),
        ),
    );
    return Effect.promise(() => settled);
  });
}

export function pilotBehavior(
  source: SubscriptionRef.SubscriptionRef<PilotInput>,
  runtime: PilotRuntime,
) {
  return activate(
    source,
    (input) => JSON.stringify(input),
    (input) => observe(input, runtime),
  );
}
