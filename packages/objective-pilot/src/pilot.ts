import type { SubscriptionRef } from "@potential-guide/effects";
import { activate, Effect } from "@potential-guide/effects";
import { compileSubjectProjection } from "./projection.js";
import { canonicalManifestUri, validateReferences } from "./resources.js";
import type {
  CheckResult,
  Envelope,
  LevelRef,
  PilotInput,
  PilotObservation,
  PilotRuntime,
  PilotSpec,
  Problem,
  ReferencePage,
  ResourceResolver,
} from "./types.js";
import {
  compileDomain,
  fields,
  identifier,
  immutable,
  json,
  ObjectiveConfigurationError,
  ObjectiveOperationError,
  parseManifest,
  record,
  validateSubject,
} from "./validation.js";

export async function loadPilotSpec(uri: string, resources: ResourceResolver): Promise<PilotSpec> {
  if (!resources.version.trim())
    throw new ObjectiveConfigurationError("A source version is required.");
  async function load(input: string, ancestors: readonly string[]): Promise<PilotSpec> {
    const objectiveId = canonicalManifestUri(input);
    const rootIdentity = canonicalManifestUri(uri).split("#")[0];
    if (
      objectiveId.startsWith("git+") &&
      objectiveId.split("#")[0] !== rootIdentity &&
      resources.versionFor === undefined
    ) {
      throw new ObjectiveConfigurationError(
        "Cross-repository prerequisites require per-Objective source versions.",
      );
    }
    if (ancestors.includes(objectiveId)) {
      throw new ObjectiveConfigurationError(
        `Cyclic prerequisite: ${[...ancestors, objectiveId].join(" -> ")}.`,
      );
    }
    const manifest = parseManifest(await resources.readText(objectiveId));
    const version =
      resources.versionFor === undefined
        ? resources.version
        : await resources.versionFor(objectiveId);
    if (!version.trim())
      throw new ObjectiveConfigurationError("An Objective source version is required.");
    compileDomain(manifest.domainSchema);
    const prerequisite =
      manifest.prerequisite === undefined
        ? undefined
        : await load(canonicalManifestUri(manifest.prerequisite.manifestUri, objectiveId), [
            ...ancestors,
            objectiveId,
          ]);
    if (manifest.prerequisite !== undefined) {
      compileSubjectProjection(manifest.prerequisite.subject);
      const minimum = manifest.prerequisite.minimumLevelId ?? "terminal";
      if (
        minimum !== "terminal" &&
        !prerequisite?.manifest.levels.some(({ id }) => id === minimum)
      ) {
        throw new ObjectiveConfigurationError(`Unknown prerequisite minimum level: ${minimum}.`);
      }
    }
    const source = canonicalManifestUri("references/", objectiveId);
    const locales = Object.fromEntries(
      [...validateReferences(await resources.readPages(source), source, manifest)].map(
        ([language, locale]) => [language, Object.fromEntries(locale.pages)],
      ),
    );
    return immutable({
      objectiveId,
      version,
      manifest,
      locales,
      ...(prerequisite === undefined ? {} : { prerequisite }),
    });
  }
  return load(uri, []);
}

export function describeLevels(spec: PilotSpec): readonly LevelRef[] {
  const own = [
    ...spec.manifest.levels.map(({ id }) => ({ objectiveId: spec.objectiveId, levelId: id })),
    {
      objectiveId: spec.objectiveId,
      levelId: "terminal",
    },
  ];
  if (spec.prerequisite === undefined) return own;
  const levels = describeLevels(spec.prerequisite);
  const minimum = spec.manifest.prerequisite?.minimumLevelId ?? "terminal";
  const index = levels.findIndex(
    (ref) => ref.objectiveId === spec.prerequisite?.objectiveId && ref.levelId === minimum,
  );
  if (index < 0) throw new ObjectiveConfigurationError("Unknown prerequisite minimum level.");
  return [...levels.slice(0, index), ...own];
}

export function readPage(
  spec: PilotSpec,
  pageId: string,
  language = spec.manifest.defaultLanguage,
): ReferencePage {
  if (!pageId.trim()) throw new ObjectiveOperationError("Page ID must be nonempty.");
  const pages = spec.locales[language];
  if (pages === undefined)
    throw new ObjectiveConfigurationError(`Unsupported language: ${language}.`);
  const page = pages[pageId] ?? pages["system/404"];
  if (page === undefined) throw new ObjectiveConfigurationError("Missing 404 reference page.");
  return page;
}

export function searchPages(
  spec: PilotSpec,
  query: string,
  language = spec.manifest.defaultLanguage,
) {
  if (typeof query !== "string")
    throw new ObjectiveOperationError("Search query must be a string.");
  const pages = spec.locales[language];
  if (pages === undefined)
    throw new ObjectiveConfigurationError(`Unsupported language: ${language}.`);
  const needle = query.trim().toLocaleLowerCase(language);
  return Object.values(pages)
    .filter(({ title, description, content }) =>
      `${title}\n${description}\n${content}`.toLocaleLowerCase(language).includes(needle),
    )
    .map(({ id, title }) => ({ id, title }));
}

export function parseCheckEnvelope(value: unknown): Envelope<CheckResult> {
  if (
    !record(value) ||
    !Number.isInteger(value.status) ||
    Number(value.status) < 100 ||
    Number(value.status) > 599
  )
    throw new ObjectiveOperationError("Invalid check envelope status.");
  fields(value, ["status", "payload", "message"]);
  if (typeof value.message !== "string")
    throw new ObjectiveOperationError("Envelope message must be a string.");
  if (value.payload === null) {
    if (value.status === 200 || !value.message.trim())
      throw new ObjectiveOperationError("Invalid invocation error envelope.");
    return { status: Number(value.status), payload: null, message: value.message };
  }
  if (value.status !== 200 || !record(value.payload))
    throw new ObjectiveOperationError("Successful check invocation requires status 200.");
  const result = value.payload;
  fields(result, ["ok", "problems"]);
  if (
    typeof result.ok !== "boolean" ||
    !Array.isArray(result.problems) ||
    (result.ok ? result.problems.length !== 0 : result.problems.length === 0)
  ) {
    throw new ObjectiveOperationError("Check result must contain ok and consistent problems.");
  }
  const problems = result.problems.map((entry: unknown) => {
    if (!record(entry)) throw new ObjectiveOperationError("Invalid problem.");
    fields(entry, ["id", "parameters"]);
    if (!identifier(entry.id) || !record(entry.parameters) || !json(entry.parameters))
      throw new ObjectiveOperationError("Invalid problem ID or parameters.");
    return { id: entry.id, parameters: entry.parameters };
  });
  if (result.ok)
    return { status: 200, payload: { ok: true, problems: [] }, message: value.message };
  const [first, ...remaining] = problems;
  if (first === undefined)
    throw new ObjectiveOperationError("A failed check must report problems.");
  return {
    status: 200,
    payload: { ok: false, problems: [first, ...remaining] },
    message: value.message,
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function observe(
  input: PilotInput,
  runtime: PilotRuntime,
): Effect.Effect<Envelope<PilotObservation>, Error> {
  return Effect.callback<Envelope<PilotObservation>, Error>((resume, signal) => {
    const pending = (async (): Promise<Envelope<PilotObservation>> => {
      signal.throwIfAborted();
      const concurrency = runtime.checkConcurrency ?? 1;
      if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
        throw new ObjectiveConfigurationError("Check concurrency must be a positive safe integer.");
      }
      const versions: Record<string, string> = {};
      const language = input.language ?? input.spec.manifest.defaultLanguage;
      // Validate and project the complete chain before starting any probe.
      function prepare(
        spec: PilotSpec,
        subject: unknown,
      ): () => Promise<Envelope<PilotObservation>> {
        if (
          !spec.objectiveId.startsWith("git+") ||
          canonicalManifestUri(spec.objectiveId) !== spec.objectiveId ||
          !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(spec.version)
        ) {
          throw new ObjectiveConfigurationError(
            "Observation requires a stable Git Objective URI and an exact commit version; static working-tree specifications cannot be probed.",
          );
        }
        const manifest = parseManifest(JSON.stringify(spec.manifest));
        const issues = validateSubject(subject, compileDomain(manifest.domainSchema));
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
        const child = spec.prerequisite;
        const prerequisite = manifest.prerequisite;
        if ((prerequisite === undefined) !== (child === undefined))
          throw new ObjectiveConfigurationError("Mismatched prerequisite specification.");
        const childProbe =
          child === undefined || prerequisite === undefined
            ? undefined
            : prepare(child, compileSubjectProjection(prerequisite.subject)(stableSubject));
        return async () => {
          signal.throwIfAborted();
          if (child !== undefined && childProbe !== undefined) {
            const previous = await childProbe();
            if (previous.payload === null) return previous;
            const minimum = manifest.prerequisite?.minimumLevelId ?? "terminal";
            const childLevels = [...child.manifest.levels.map(({ id }) => id), "terminal"];
            const target = childLevels.indexOf(minimum);
            if (target < 0)
              throw new ObjectiveConfigurationError("Unknown prerequisite minimum level.");
            if (
              previous.payload.current.objectiveId !== child.objectiveId ||
              childLevels.indexOf(previous.payload.current.levelId) < target
            )
              return previous;
          }
          for (const level of manifest.levels) {
            signal.throwIfAborted();
            const results = await Effect.runPromise(
              Effect.forEach(
                level.advancement.checks,
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
                          if (!check.problems.includes(problem.id))
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
              const check = level.advancement.checks[index];
              if (check === undefined)
                throw new ObjectiveOperationError("Unexpected check result index.");
              return result.payload === null
                ? []
                : result.payload.problems.map((problem) => ({
                    ref: {
                      objectiveId: spec.objectiveId,
                      levelId: level.id,
                      checkId: check.id,
                      problemId: problem.id,
                    },
                    parameters: problem.parameters,
                  }));
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
            }),
          };
        };
      }
      const result = await prepare(input.spec, input.subject)();
      runtime.onObservation?.(result);
      return result;
    })();
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
