import type { ObjectiveService, ProbeSnapshot } from "@potential-guide/objective-host";
import type { CheckerRequest } from "@potential-guide/checker-host";
import {
  parseManifest,
  sameObjectiveSource,
  validatePilotSource,
  type Envelope,
  type JsonObject,
  type ObjectiveSource,
  type PilotObservation,
  type PilotRuntime,
  type PilotSpec,
  type ReferencePage,
  type ServiceObjectiveSource,
} from "@potential-guide/pilot-protocol";

/** Explicit bridge: legacy business APIs retain their shapes, new wire contracts do not. */
export async function bindObjectiveService(
  service: ObjectiveService,
  reference: { url: string; digest?: string },
  options: {
    scope: string;
    language?: string;
    signal?: AbortSignal;
    source?: ServiceObjectiveSource;
    timeoutMs?: number;
  },
): Promise<{ spec: PilotSpec; runtime: PilotRuntime }> {
  const bindings: Record<string, string> = { ...options.source?.bindings };
  const bound = new Map<string, PilotSpec>();
  const scope = options.scope;
  const signal = options.signal ?? new AbortController().signal;
  const environment = { ...service.environment };
  async function bind(
    url: string,
    digest?: string,
    expected?: ObjectiveSource,
  ): Promise<PilotSpec> {
    const pinned = bindings[url];
    if (pinned && digest && pinned !== digest) throw new Error("Objective binding conflict.");
    const exact = pinned ?? digest;
    const prepared = await service.describe(
      { kind: "objective", url, ...(exact ? { digest: exact } : {}) },
      scope,
      signal,
      options.language,
    );
    const objectiveId = `objective:${url}`;
    const source: ServiceObjectiveSource = {
      kind: "artifact-service-v1",
      url,
      digest: prepared.resolved.digest,
      environment,
      bindings: expected?.kind === "artifact-service-v1" ? { ...expected.bindings } : {},
    };
    validatePilotSource(objectiveId, source.digest, source);
    if (expected && !sameObjectiveSource(expected, source))
      throw new Error("Exact Objective execution environment/source changed.");
    bindings[url] = source.digest;
    const manifest = parseManifest(
      JSON.stringify({
        $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
        subjectSchema: prepared.resolved.manifest.subjectSchema,
        languages: prepared.resolved.manifest.languages,
        defaultLanguage: prepared.language,
        levels: prepared.resolved.manifest.levels.map((level) => ({
          id: level.id,
          checks: level.checks.map((id) => ({
            id,
            problems: prepared.checkers[id]?.manifest.problems ?? [],
          })),
        })),
      }),
    );
    const locales = Object.fromEntries(
      Object.entries(prepared.pages).map(([language, pages]) => [
        language,
        Object.fromEntries(
          Object.entries(pages).map(([id, page]) => {
            const { language: _language, ...reference } = page;
            return [id, reference satisfies ReferencePage];
          }),
        ),
      ]),
    );
    const spec = { objectiveId, version: source.digest, source, manifest, locales };
    bound.set(objectiveId, spec);
    return spec;
  }
  const spec = await bind(
    reference.url,
    reference.digest ?? options.source?.digest,
    options.source,
  );
  const runtime: PilotRuntime = {
    boundObjectives: () => [...bound.values()],
    resolveCheck() {
      throw new Error("Service-backed Pilot checks must run within an Observation Execution.");
    },
    async resolveObjective(id, version, childSignal, source) {
      childSignal.throwIfAborted();
      if (!id.startsWith("objective:https://")) throw new Error("Expected typed Objective source.");
      const child = await bind(id.slice(10), version, source);
      return { spec: child, runtime };
    },
    async observeObjective(input, abort): Promise<Envelope<PilotObservation>> {
      if (
        input.spec.source?.kind !== "artifact-service-v1" ||
        !sameObjectiveSource(bound.get(input.spec.objectiveId)?.source, input.spec.source)
      )
        throw new Error("Pilot service binding differs.");
      const task = service.accept(
        {
          objective: { url: input.spec.source.url, digest: input.spec.version },
          subject: structuredClone(input.subject) as CheckerRequest["subject"],
          bindings: { ...bindings },
          language: input.language ?? input.spec.manifest.defaultLanguage,
          ...(input.targetLevel ? { targetLevel: input.targetLevel } : {}),
          ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        },
        scope,
      );
      const completed = await waitForProbe(service, task.taskId, scope, abort);
      const observation = completed.result;
      if (!observation || !completed.evidence)
        throw new Error("Missing Objective observation evidence.");
      const sources: Record<string, ObjectiveSource> = {};
      const versions: Record<string, string> = {};
      for (const [url, digest] of Object.entries(observation.bindings)) {
        const existing = bindings[url];
        if (existing && existing !== digest)
          throw new Error("Observation changed an exact dependency.");
        bindings[url] = digest;
        const id = `objective:${url}`;
        versions[id] = digest;
        sources[id] = bound.get(id)?.source ?? {
          kind: "artifact-service-v1",
          url,
          digest,
          environment,
          bindings: {},
        };
      }
      return {
        status: 200,
        message: "",
        payload: {
          current: {
            objectiveId: `objective:${observation.current.objective.url}`,
            levelId: observation.current.levelId,
          },
          problems: observation.problems.map(({ objective, levelId, checker, problem }) =>
            problem.kind === "internal"
              ? {
                  kind: "internal",
                  ref: {
                    objectiveId: `objective:${objective.url}`,
                    levelId,
                    checkId: checker,
                    problemId: problem.id,
                  },
                  parameters: problem.parameters,
                }
              : {
                  kind: "dependency",
                  objectiveId: `objective:${problem.objective.url}`,
                  subject: problem.subject,
                  expectedLevelId: problem.expectedLevelId,
                  currentLevelId: problem.currentLevelId,
                },
          ),
          gapSummary: observation.gapSummary,
          observedAt: observation.observedAt,
          versions,
          sources,
          executionEvidence: structuredClone(completed.evidence) as unknown as JsonObject,
        },
      };
    },
  };
  return { spec, runtime };
}
function waitForProbe(
  service: ObjectiveService,
  id: string,
  scope: string,
  signal: AbortSignal,
): Promise<ProbeSnapshot> {
  return new Promise((resolve, reject) => {
    let release: (() => unknown) | undefined;
    let settled = false;
    const cleanup = () => {
      settled = true;
      release?.();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      service.cancel(id, scope);
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    release = service.subscribe([id], scope, ({ snapshot }) => {
      if (!["completed", "failed", "cancelled"].includes(snapshot.state)) return;
      cleanup();
      if (snapshot.state === "completed") resolve(snapshot);
      else reject(new Error(snapshot.error?.code ?? "Probe failed."));
    });
    if (settled) release();
  });
}
