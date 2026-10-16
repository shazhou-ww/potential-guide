import { startEffect } from "@potential-guide/effects";
import {
  describeLevels,
  type LevelRef,
  observe,
  type PilotObservation,
} from "@potential-guide/objective-pilot";
import {
  type AgentExecutionLimits,
  makeRegulatorSpec,
  type RegulationInput,
  type RegulationOutcome,
  type RegulationRuntime,
  regulate,
} from "@potential-guide/objective-regulator";

export type ObjectiveRegistrationId = string;
export interface ObjectiveSafetyThresholds {
  defensiveThresholdId: string;
  defensiveTargetLevelId: string;
}
export interface ObjectiveRegistration {
  id: ObjectiveRegistrationId;
  input: RegulationInput;
  runtime: RegulationRuntime;
  safety: ObjectiveSafetyThresholds;
}
export interface ObjectivePortfolioEntry {
  registrationId: ObjectiveRegistrationId;
  observation: PilotObservation;
  safety: ObjectiveSafetyThresholds;
}
export interface ObjectivePortfolioObservation {
  entries: readonly ObjectivePortfolioEntry[];
}
export type RegulationTrigger = "defensive" | "opportunistic";
export interface RegulationDirective {
  registrationId: ObjectiveRegistrationId;
  targetLevelId: string;
  trigger: RegulationTrigger;
  rationale: string;
  agentExecutionLimits: AgentExecutionLimits;
}
export interface DeferredObjective {
  registrationId: ObjectiveRegistrationId;
  reason: string;
}
export interface ObjectivePortfolioPlan {
  directives: readonly RegulationDirective[];
  deferred: readonly DeferredObjective[];
}
export type ObjectivePortfolioPolicy = (
  observation: ObjectivePortfolioObservation,
) => Promise<ObjectivePortfolioPlan>;
export interface ObjectivePortfolioRunResult {
  results: readonly { registrationId: ObjectiveRegistrationId; result: RegulationOutcome }[];
}
export interface ObjectivePortfolioSupervisor {
  observe(signal?: AbortSignal): Promise<ObjectivePortfolioObservation>;
  plan(observation: ObjectivePortfolioObservation): Promise<ObjectivePortfolioPlan>;
  execute(plan: ObjectivePortfolioPlan, signal?: AbortSignal): Promise<ObjectivePortfolioRunResult>;
}
export class ObjectivePortfolioError extends TypeError {}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function ownLevel(registration: ObjectiveRegistration, id: string): number {
  return describeLevels(registration.input.spec.pilot).findIndex(
    (level) =>
      level.objectiveId === registration.input.spec.pilot.objectiveId && level.levelId === id,
  );
}
function currentLevel(registration: ObjectiveRegistration, current: LevelRef): number {
  const index = describeLevels(registration.input.spec.pilot).findIndex(
    (level) => level.objectiveId === current.objectiveId && level.levelId === current.levelId,
  );
  if (index < 0)
    throw new ObjectivePortfolioError(
      "Portfolio observation contains a level outside its registration.",
    );
  return index;
}
function limits(value: unknown): AgentExecutionLimits {
  if (
    !object(value) ||
    !exact(value, ["timeoutMs"]) ||
    !Number.isSafeInteger(value.timeoutMs) ||
    Number(value.timeoutMs) < 1
  )
    throw new ObjectivePortfolioError(
      "Directive requires positive per-Agent execution limits; cross-round budgets are unsupported.",
    );
  return Object.freeze({ timeoutMs: Number(value.timeoutMs) });
}

export function createObjectivePortfolioSupervisor(
  registrations: readonly ObjectiveRegistration[],
  policy: ObjectivePortfolioPolicy,
): ObjectivePortfolioSupervisor {
  if (!Array.isArray(registrations) || registrations.length === 0 || typeof policy !== "function")
    throw new ObjectivePortfolioError("Registrations and a portfolio policy are required.");
  const byId = new Map<string, ObjectiveRegistration>();
  for (const registration of registrations) {
    const validated = registration;
    if (
      !object(registration) ||
      !text(registration.id) ||
      !object(registration.input) ||
      !object(registration.input.spec) ||
      !object(registration.runtime) ||
      !object(registration.runtime.pilot) ||
      typeof registration.runtime.pilot.resolveCheck !== "function" ||
      typeof registration.runtime.executeAgent !== "function" ||
      !object(registration.safety) ||
      !text(registration.safety.defensiveThresholdId) ||
      !text(registration.safety.defensiveTargetLevelId)
    )
      throw new ObjectivePortfolioError("Invalid Pilot regulation registration.");
    if (byId.has(registration.id))
      throw new ObjectivePortfolioError(`Duplicate Objective registration: ${registration.id}.`);
    let input: RegulationInput;
    try {
      const snapshot = structuredClone(validated.input);
      input = freeze({
        ...snapshot,
        spec: makeRegulatorSpec(snapshot.spec.pilot, snapshot.spec.strategy, snapshot.spec.binding),
      });
    } catch (cause) {
      throw new ObjectivePortfolioError(
        `Registration requires a serializable and valid Pilot regulation input: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
    const stable: ObjectiveRegistration = Object.freeze({
      id: validated.id,
      input,
      runtime: Object.freeze({
        ...validated.runtime,
        pilot: Object.freeze({ ...validated.runtime.pilot }),
      }),
      safety: Object.freeze({ ...validated.safety }),
    });
    if (
      ownLevel(stable, stable.safety.defensiveThresholdId) < 0 ||
      ownLevel(stable, stable.safety.defensiveTargetLevelId) <=
        ownLevel(stable, stable.safety.defensiveThresholdId)
    )
      throw new ObjectivePortfolioError(
        `Registration ${registration.id} has invalid defensive thresholds.`,
      );
    byId.set(stable.id, stable);
  }

  function validateObservation(
    candidate: ObjectivePortfolioObservation,
  ): Map<string, ObjectivePortfolioEntry> {
    if (
      !object(candidate) ||
      !exact(candidate, ["entries"]) ||
      !Array.isArray(candidate.entries) ||
      candidate.entries.length !== byId.size
    )
      throw new ObjectivePortfolioError(
        "Portfolio observation must cover every registration exactly once.",
      );
    const entries = new Map<string, ObjectivePortfolioEntry>();
    for (const entry of candidate.entries) {
      const validated = entry;
      if (
        !object(entry) ||
        !text(entry.registrationId) ||
        !object(entry.observation) ||
        !object(entry.observation.current) ||
        !Array.isArray(entry.observation.problems) ||
        typeof entry.observation.gapSummary !== "string" ||
        !object(entry.safety)
      )
        throw new ObjectivePortfolioError("Invalid portfolio observation entry.");
      const registration = byId.get(entry.registrationId);
      if (
        registration === undefined ||
        entries.has(entry.registrationId) ||
        entry.safety.defensiveThresholdId !== registration.safety.defensiveThresholdId ||
        entry.safety.defensiveTargetLevelId !== registration.safety.defensiveTargetLevelId
      )
        throw new ObjectivePortfolioError("Portfolio observation does not match its registration.");
      currentLevel(registration, validated.observation.current);
      entries.set(validated.registrationId, validated);
    }
    return entries;
  }

  function validatePlan(
    candidate: ObjectivePortfolioPlan,
    entries?: Map<string, ObjectivePortfolioEntry>,
  ): ObjectivePortfolioPlan {
    if (
      !object(candidate) ||
      !exact(candidate, ["directives", "deferred"]) ||
      !Array.isArray(candidate.directives) ||
      !Array.isArray(candidate.deferred)
    )
      throw new ObjectivePortfolioError("Portfolio policy returned an invalid plan.");
    const covered = new Set<string>();
    const directives = candidate.directives.map((value: unknown): RegulationDirective => {
      if (
        !object(value) ||
        !exact(value, [
          "registrationId",
          "targetLevelId",
          "trigger",
          "rationale",
          "agentExecutionLimits",
        ]) ||
        !text(value.registrationId) ||
        !text(value.targetLevelId) ||
        !text(value.rationale) ||
        (value.trigger !== "defensive" && value.trigger !== "opportunistic")
      )
        throw new ObjectivePortfolioError("Portfolio policy returned an invalid directive.");
      const registration = byId.get(value.registrationId);
      if (registration === undefined || covered.has(value.registrationId))
        throw new ObjectivePortfolioError("Plan contains an unknown or repeated registration.");
      if (ownLevel(registration, value.targetLevelId) < 0)
        throw new ObjectivePortfolioError("Directive target does not belong to its registration.");
      if (
        value.trigger === "defensive" &&
        value.targetLevelId !== registration.safety.defensiveTargetLevelId
      )
        throw new ObjectivePortfolioError(
          "Defensive directives must target the registration's defensive target.",
        );
      covered.add(value.registrationId);
      return Object.freeze({
        registrationId: value.registrationId,
        targetLevelId: value.targetLevelId,
        trigger: value.trigger,
        rationale: value.rationale,
        agentExecutionLimits: limits(value.agentExecutionLimits),
      });
    });
    const deferred = candidate.deferred.map((value: unknown): DeferredObjective => {
      if (
        !object(value) ||
        !exact(value, ["registrationId", "reason"]) ||
        !text(value.registrationId) ||
        !text(value.reason) ||
        !byId.has(value.registrationId) ||
        covered.has(value.registrationId)
      )
        throw new ObjectivePortfolioError(
          "Plan contains an invalid or repeated deferred registration.",
        );
      covered.add(value.registrationId);
      return Object.freeze({ registrationId: value.registrationId, reason: value.reason });
    });
    if (covered.size !== byId.size)
      throw new ObjectivePortfolioError(
        "Plan must direct or defer every registration exactly once.",
      );
    let opportunistic = false;
    for (const directive of directives) {
      if (directive.trigger === "opportunistic") opportunistic = true;
      else if (opportunistic)
        throw new ObjectivePortfolioError(
          "Defensive directives must precede opportunistic directives.",
        );
    }
    for (const [id, entry] of entries ?? []) {
      const registration = byId.get(id)!;
      if (
        currentLevel(registration, entry.observation.current) <=
          ownLevel(registration, registration.safety.defensiveThresholdId) &&
        !directives.some(
          (directive) => directive.registrationId === id && directive.trigger === "defensive",
        )
      )
        throw new ObjectivePortfolioError(`Registration ${id} requires a defensive directive.`);
    }
    return Object.freeze({
      directives: Object.freeze(directives),
      deferred: Object.freeze(deferred),
    });
  }

  return Object.freeze({
    async observe(signal?: AbortSignal) {
      const entries: ObjectivePortfolioEntry[] = [];
      for (const registration of byId.values()) {
        const input = registration.input;
        const result = await startEffect(
          observe(
            {
              spec: input.spec.pilot,
              subject: input.subject,
              ...(input.language === undefined ? {} : { language: input.language }),
            },
            registration.runtime.pilot,
          ),
          signal,
        ).await();
        if (result.status !== 200 || result.payload === null)
          throw new ObjectivePortfolioError(
            `Pilot invocation failed for ${registration.id}: ${result.message}`,
          );
        currentLevel(registration, result.payload.current);
        entries.push(
          Object.freeze({
            registrationId: registration.id,
            observation: result.payload,
            safety: registration.safety,
          }),
        );
      }
      return Object.freeze({ entries: Object.freeze(entries) });
    },
    async plan(observation: ObjectivePortfolioObservation) {
      return validatePlan(await policy(observation), validateObservation(observation));
    },
    async execute(plan: ObjectivePortfolioPlan, signal?: AbortSignal) {
      const validated = validatePlan(plan);
      const results: { registrationId: string; result: RegulationOutcome }[] = [];
      for (const directive of validated.directives) {
        const registration = byId.get(directive.registrationId)!;
        const prior = registration.input.spec;
        const spec = makeRegulatorSpec(
          prior.pilot,
          {
            ...prior.strategy,
            targetLevel: directive.targetLevelId,
            agentExecutionLimits: directive.agentExecutionLimits,
          },
          prior.binding,
        );
        const result = await startEffect(
          regulate({ ...registration.input, spec }, registration.runtime),
          signal,
        ).await();
        results.push(Object.freeze({ registrationId: registration.id, result }));
      }
      return Object.freeze({ results: Object.freeze(results) });
    },
  });
}
