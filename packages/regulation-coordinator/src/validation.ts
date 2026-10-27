import {
  attainedLevelRank,
  compileDomain,
  type Envelope,
  type ObjectiveSource,
  objectiveSourceVersion,
  type PilotObservation,
  type PilotSpec,
  parseDependencyProblem,
  validatePilotSource,
  validateSubject,
} from "@potential-guide/objective-pilot";
import { canonicalJson, validateGoal } from "@potential-guide/objective-portfolio-supervisor";
import { makeRegulatorSpec, type RegulationOutcome } from "@potential-guide/objective-regulator";
import type { AgentResource, Regulation } from "./types.js";

export function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError(`Expected only ${[...required, ...optional].join(", ")}.`);
}

export function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}

export function timestamp(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new TypeError("Expected a finite RFC 3339 timestamp.");
}

export function immutable<A>(value: A): A {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export function priority(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateRegulation(regulation: Regulation): void {
  fields(
    regulation,
    ["id", "objective", "subject", "targetLevel", "priority"],
    ["requirements", "language", "sourceBindings"],
  );
  if (typeof regulation.id !== "string" || regulation.id.startsWith("$dependency:"))
    throw new TypeError("Invalid or reserved Regulation ID.");
  validateGoal({ ...regulation, observationIntervalMs: 1 });
  validateSpec(regulation.objective, regulation.subject);
  if (
    regulation.language !== undefined &&
    !regulation.objective.manifest.languages.includes(regulation.language)
  )
    throw new TypeError("Unsupported Regulation language.");
  mergeSources(
    regulation.objective.source === undefined
      ? {}
      : { [regulation.objective.objectiveId]: regulation.objective.source },
    regulation.sourceBindings ?? {},
  );
}

export function validateSpec(spec: PilotSpec, subject: Regulation["subject"]): void {
  makeRegulatorSpec(
    spec,
    {
      targetLevel: "terminal",
      quota: { timeoutMs: 1, maxAgentRuns: 1, maxStallRuns: 1 },
      agentExecutionLimits: { timeoutMs: 1 },
    },
    { id: "validation" },
  );
  validatePilotSource(spec.objectiveId, spec.version, spec.source);
  if (validateSubject(subject, compileDomain(spec.manifest.subjectSchema)) !== null)
    throw new TypeError("Subject does not satisfy provider schema.");
}

export function identity(regulation: Regulation): string {
  return canonicalJson([
    regulation.objective.objectiveId,
    regulation.objective.version,
    regulation.objective.source,
    regulation.subject,
    regulation.language ?? regulation.objective.manifest.defaultLanguage,
  ]);
}

export function mergeSources(
  left: Readonly<Record<string, ObjectiveSource>>,
  right: Readonly<Record<string, ObjectiveSource>>,
): Record<string, ObjectiveSource> {
  const merged = { ...left };
  for (const [id, source] of Object.entries(right)) {
    validatePilotSource(id, objectiveSourceVersion(source), source);
    if (merged[id] && canonicalJson(merged[id]) !== canonicalJson(source))
      throw new TypeError(`Conflicting exact source for ${id}.`);
    merged[id] = source;
  }
  return merged;
}

export function validateObservation(
  regulation: Regulation,
  envelope: Envelope<PilotObservation>,
): PilotObservation {
  fields(envelope, ["status", "payload", "message"]);
  canonicalJson(envelope);
  const value = envelope.payload;
  if (
    envelope.status !== 200 ||
    !value ||
    value.current.objectiveId !== regulation.objective.objectiveId ||
    value.versions[regulation.objective.objectiveId] !== regulation.objective.version
  )
    throw new TypeError("Invalid observation envelope, objective or exact version.");
  fields(value, ["current", "problems", "gapSummary", "observedAt", "versions"], ["sources"]);
  fields(value.current, ["objectiveId", "levelId"]);
  if (
    typeof envelope.message !== "string" ||
    typeof value.gapSummary !== "string" ||
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    !Array.isArray(value.problems) ||
    value.versions === null ||
    typeof value.versions !== "object" ||
    Array.isArray(value.versions)
  )
    throw new TypeError("Invalid observation fields or timestamp.");
  for (const problem of value.problems) {
    if (problem.kind === "dependency") {
      const dependency = parseDependencyProblem(problem);
      validatePilotSource(
        dependency.objectiveId,
        value.versions[dependency.objectiveId] ?? "",
        value.sources?.[dependency.objectiveId],
      );
    } else {
      fields(problem, ["kind", "ref", "parameters"]);
      fields(problem.ref, ["objectiveId", "levelId", "checkId", "problemId"]);
      if (
        problem.kind !== "internal" ||
        Object.values(problem.ref).some((entry) => typeof entry !== "string" || !entry.trim()) ||
        problem.parameters === null ||
        typeof problem.parameters !== "object" ||
        Array.isArray(problem.parameters)
      )
        throw new TypeError("Invalid observed problem.");
    }
  }
  const rank = attainedLevelRank(regulation.objective, value.current.levelId);
  for (const problem of value.problems) {
    if (problem.kind !== "internal") continue;
    const next = regulation.objective.manifest.levels[rank];
    if (
      next === undefined ||
      problem.ref.objectiveId !== regulation.objective.objectiveId ||
      problem.ref.levelId !== next?.id ||
      !next.checks.some(
        ({ id, problems }) =>
          id === problem.ref.checkId && problems.includes(problem.ref.problemId),
      )
    )
      throw new TypeError("Problem must belong to the next unattained business level.");
  }
  for (const [id, version] of Object.entries(value.versions))
    validatePilotSource(id, version, value.sources?.[id]);
  for (const [id, source] of Object.entries(value.sources ?? {}))
    validatePilotSource(id, value.versions[id] ?? "", source);
  const sources = mergeSources(regulation.sourceBindings ?? {}, value.sources ?? {});
  if (
    canonicalJson(sources[regulation.objective.objectiveId]) !==
    canonicalJson(regulation.objective.source)
  )
    throw new TypeError("Observation source does not match execution source.");
  return value;
}

export function observation(regulation: Regulation, outcome: RegulationOutcome): PilotObservation {
  const value = validateObservation(regulation, outcome.latestObservation);
  if (
    !Number.isSafeInteger(outcome.iterations) ||
    outcome.iterations < 0 ||
    !Number.isSafeInteger(outcome.stalledRuns) ||
    outcome.stalledRuns < 0
  )
    throw new TypeError("Invalid execution accounting.");
  if (
    outcome.stopReason === "dependency-required" &&
    (!outcome.dependencies.length ||
      canonicalJson(outcome.dependencies) !==
        canonicalJson(value.problems.filter((problem) => problem.kind === "dependency")))
  )
    throw new TypeError("Dependency payload differs from observed problems.");
  return value;
}

export function validateResources(resources: readonly AgentResource[]): void {
  if (!Array.isArray(resources)) throw new TypeError("Expected resource array.");
  const ids = new Set<string>();
  for (const resource of resources) {
    fields(resource, ["id", "binding", "capacity", "capabilities"]);
    fields(resource.binding, ["id"], ["configuration"]);
    canonicalJson(resource);
    if (
      typeof resource.id !== "string" ||
      !resource.id.trim() ||
      ids.has(resource.id) ||
      typeof resource.binding.id !== "string" ||
      !resource.binding.id.trim() ||
      (resource.binding.configuration !== undefined &&
        (resource.binding.configuration === null ||
          typeof resource.binding.configuration !== "object" ||
          Array.isArray(resource.binding.configuration))) ||
      !positive(resource.capacity) ||
      !Array.isArray(resource.capabilities) ||
      resource.capabilities.some((item: unknown) => typeof item !== "string" || !item.trim())
    )
      throw new TypeError("Invalid resource identity, binding, capacity or capabilities.");
    ids.add(resource.id);
  }
}
