import type {
  ObjectiveGuideInstance,
  ObjectiveLevelDescription,
  ObjectiveLevelId,
  ObjectiveObservation,
} from "@potential-guide/objective-guide";
import type {
  ObjectiveActionExecutor,
  ObjectiveRegulator,
  RegulationLimits,
  RegulationResult,
} from "@potential-guide/objective-regulator";

export type ObjectiveRegistrationId = string;

export interface ObjectiveSafetyThresholds {
  defensiveThresholdId: ObjectiveLevelId;
  defensiveTargetLevelId: ObjectiveLevelId;
}

export interface ObjectiveRegistration {
  id: ObjectiveRegistrationId;
  regulator: ObjectiveRegulator;
  safety: ObjectiveSafetyThresholds;
}

export interface ObjectivePortfolioEntry {
  registrationId: ObjectiveRegistrationId;
  instance: ObjectiveGuideInstance;
  observation: ObjectiveObservation;
  safety: ObjectiveSafetyThresholds;
}

export interface ObjectivePortfolioObservation {
  entries: readonly ObjectivePortfolioEntry[];
}

export type RegulationTrigger = "defensive" | "opportunistic";

export interface RegulationDirective {
  registrationId: ObjectiveRegistrationId;
  targetLevelId: ObjectiveLevelId;
  trigger: RegulationTrigger;
  rationale: string;
  limits: RegulationLimits;
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
  results: readonly {
    registrationId: ObjectiveRegistrationId;
    result: RegulationResult;
  }[];
}

export interface ObjectivePortfolioSupervisor {
  observe(): Promise<ObjectivePortfolioObservation>;
  plan(observation: ObjectivePortfolioObservation): Promise<ObjectivePortfolioPlan>;
  execute(
    plan: ObjectivePortfolioPlan,
    executeAction: ObjectiveActionExecutor,
  ): Promise<ObjectivePortfolioRunResult>;
}

export class ObjectivePortfolioError extends TypeError {}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectiveInstance(value: unknown): value is ObjectiveGuideInstance {
  return (
    object(value) && typeof value.describeLevels === "function" && typeof value.probe === "function"
  );
}

function objectiveRegulator(value: unknown): value is ObjectiveRegulator {
  return (
    object(value) &&
    objectiveInstance(value.instance) &&
    typeof value.probe === "function" &&
    typeof value.regulate === "function"
  );
}

function portfolioObservation(value: unknown): value is ObjectiveObservation {
  return (
    object(value) &&
    object(value.current) &&
    Array.isArray(value.problems) &&
    typeof value.gapSummary === "string"
  );
}

function safetyThresholds(value: unknown): value is ObjectiveSafetyThresholds {
  return object(value) && text(value.defensiveThresholdId) && text(value.defensiveTargetLevelId);
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return (
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

function validateLimits(value: unknown): RegulationLimits {
  if (
    !object(value) ||
    !exactFields(value, ["maxIterations", "timeoutMs", "maxStalledIterations"]) ||
    !Number.isSafeInteger(value.maxIterations) ||
    Number(value.maxIterations) < 0 ||
    !Number.isFinite(value.timeoutMs) ||
    Number(value.timeoutMs) <= 0 ||
    !Number.isSafeInteger(value.maxStalledIterations) ||
    Number(value.maxStalledIterations) < 1
  ) {
    throw new ObjectivePortfolioError("Directive contains invalid regulation limits.");
  }
  return Object.freeze({
    maxIterations: Number(value.maxIterations),
    timeoutMs: Number(value.timeoutMs),
    maxStalledIterations: Number(value.maxStalledIterations),
  });
}

function levelIndex(
  levels: readonly ObjectiveLevelDescription[],
  instance: ObjectiveGuideInstance,
  levelId: ObjectiveLevelId,
): number {
  return levels.findIndex(
    (description) => description.instance === instance && description.id === levelId,
  );
}

function observationIndex(
  levels: readonly ObjectiveLevelDescription[],
  observation: ObjectiveObservation,
): number {
  const index = levels.findIndex(
    (description) =>
      description === observation.current ||
      (description.instance === observation.current.instance &&
        description.id === observation.current.id),
  );
  if (index < 0) {
    throw new ObjectivePortfolioError(
      "Portfolio observation contains a level outside its registration.",
    );
  }
  return index;
}

export function createObjectivePortfolioSupervisor(
  registrations: readonly ObjectiveRegistration[],
  policy: ObjectivePortfolioPolicy,
): ObjectivePortfolioSupervisor {
  if (!Array.isArray(registrations) || registrations.length === 0) {
    throw new ObjectivePortfolioError("At least one Objective registration is required.");
  }
  if (typeof policy !== "function") {
    throw new ObjectivePortfolioError("An Objective portfolio policy is required.");
  }

  const registrationById = new Map<ObjectiveRegistrationId, ObjectiveRegistration>();
  for (const registration of registrations) {
    if (
      !object(registration) ||
      !text(registration.id) ||
      !objectiveRegulator(registration.regulator) ||
      !safetyThresholds(registration.safety)
    ) {
      throw new ObjectivePortfolioError("Invalid Objective registration.");
    }
    if (registrationById.has(registration.id)) {
      throw new ObjectivePortfolioError(`Duplicate Objective registration: ${registration.id}.`);
    }

    const levels = registration.regulator.instance.describeLevels();
    const thresholdIndex = levelIndex(
      levels,
      registration.regulator.instance,
      registration.safety.defensiveThresholdId,
    );
    const targetIndex = levelIndex(
      levels,
      registration.regulator.instance,
      registration.safety.defensiveTargetLevelId,
    );
    if (thresholdIndex < 0 || targetIndex <= thresholdIndex) {
      throw new ObjectivePortfolioError(
        `Registration ${registration.id} has invalid defensive thresholds.`,
      );
    }

    registrationById.set(
      registration.id,
      Object.freeze({
        id: registration.id,
        regulator: registration.regulator,
        safety: Object.freeze({ ...registration.safety }),
      }),
    );
  }

  function validateObservation(
    observation: ObjectivePortfolioObservation,
  ): ReadonlyMap<ObjectiveRegistrationId, ObjectivePortfolioEntry> {
    if (
      !object(observation) ||
      !exactFields(observation, ["entries"]) ||
      !Array.isArray(observation.entries) ||
      observation.entries.length !== registrationById.size
    ) {
      throw new ObjectivePortfolioError(
        "Portfolio observation must cover every registration exactly once.",
      );
    }

    const entries = new Map<ObjectiveRegistrationId, ObjectivePortfolioEntry>();
    for (const rawEntry of observation.entries as readonly unknown[]) {
      if (
        !object(rawEntry) ||
        !text(rawEntry.registrationId) ||
        !portfolioObservation(rawEntry.observation) ||
        !objectiveInstance(rawEntry.instance) ||
        !safetyThresholds(rawEntry.safety)
      ) {
        throw new ObjectivePortfolioError("Invalid portfolio observation entry.");
      }
      const entry: ObjectivePortfolioEntry = {
        registrationId: rawEntry.registrationId,
        instance: rawEntry.instance,
        observation: rawEntry.observation,
        safety: rawEntry.safety,
      };
      const registration = registrationById.get(entry.registrationId);
      if (
        registration === undefined ||
        entries.has(entry.registrationId) ||
        entry.instance !== registration.regulator.instance ||
        entry.safety.defensiveThresholdId !== registration.safety.defensiveThresholdId ||
        entry.safety.defensiveTargetLevelId !== registration.safety.defensiveTargetLevelId
      ) {
        throw new ObjectivePortfolioError("Portfolio observation does not match its registration.");
      }
      observationIndex(entry.instance.describeLevels(), entry.observation);
      entries.set(entry.registrationId, entry);
    }
    return entries;
  }

  function validatePlan(
    candidate: ObjectivePortfolioPlan,
    entries?: ReadonlyMap<ObjectiveRegistrationId, ObjectivePortfolioEntry>,
  ): ObjectivePortfolioPlan {
    if (
      !object(candidate) ||
      !exactFields(candidate, ["directives", "deferred"]) ||
      !Array.isArray(candidate.directives) ||
      !Array.isArray(candidate.deferred)
    ) {
      throw new ObjectivePortfolioError("Portfolio policy returned an invalid plan.");
    }

    const covered = new Set<ObjectiveRegistrationId>();
    const directives = candidate.directives.map((value: unknown) => {
      if (
        !object(value) ||
        !exactFields(value, [
          "registrationId",
          "targetLevelId",
          "trigger",
          "rationale",
          "limits",
        ]) ||
        !text(value.registrationId) ||
        !text(value.targetLevelId) ||
        (value.trigger !== "defensive" && value.trigger !== "opportunistic") ||
        !text(value.rationale)
      ) {
        throw new ObjectivePortfolioError("Portfolio policy returned an invalid directive.");
      }
      const registration = registrationById.get(value.registrationId);
      if (registration === undefined || covered.has(value.registrationId)) {
        throw new ObjectivePortfolioError("Plan contains an unknown or repeated registration.");
      }
      if (
        levelIndex(
          registration.regulator.instance.describeLevels(),
          registration.regulator.instance,
          value.targetLevelId,
        ) < 0
      ) {
        throw new ObjectivePortfolioError(
          `Directive target does not belong to registration ${value.registrationId}.`,
        );
      }
      if (
        value.trigger === "defensive" &&
        value.targetLevelId !== registration.safety.defensiveTargetLevelId
      ) {
        throw new ObjectivePortfolioError(
          "Defensive directives must target the registration's defensive target.",
        );
      }
      covered.add(value.registrationId);
      return Object.freeze({
        registrationId: value.registrationId,
        targetLevelId: value.targetLevelId,
        trigger: value.trigger as RegulationTrigger,
        rationale: value.rationale,
        limits: validateLimits(value.limits),
      });
    });

    const deferred = candidate.deferred.map((value: unknown) => {
      if (
        !object(value) ||
        !exactFields(value, ["registrationId", "reason"]) ||
        !text(value.registrationId) ||
        !text(value.reason) ||
        !registrationById.has(value.registrationId) ||
        covered.has(value.registrationId)
      ) {
        throw new ObjectivePortfolioError(
          "Plan contains an invalid or repeated deferred registration.",
        );
      }
      covered.add(value.registrationId);
      return Object.freeze({
        registrationId: value.registrationId,
        reason: value.reason,
      });
    });

    if (covered.size !== registrationById.size) {
      throw new ObjectivePortfolioError(
        "Plan must direct or defer every registration exactly once.",
      );
    }

    let opportunisticSeen = false;
    for (const directive of directives) {
      if (directive.trigger === "opportunistic") {
        opportunisticSeen = true;
      } else if (opportunisticSeen) {
        throw new ObjectivePortfolioError(
          "Defensive directives must precede opportunistic directives.",
        );
      }
    }

    if (entries !== undefined) {
      const directiveById = new Map(
        directives.map((directive) => [directive.registrationId, directive]),
      );
      for (const [registrationId, entry] of entries) {
        const registration = registrationById.get(registrationId);
        if (registration === undefined) {
          throw new ObjectivePortfolioError("Observation has an unknown registration.");
        }
        const levels = registration.regulator.instance.describeLevels();
        const currentIndex = observationIndex(levels, entry.observation);
        const thresholdIndex = levelIndex(
          levels,
          registration.regulator.instance,
          registration.safety.defensiveThresholdId,
        );
        if (currentIndex <= thresholdIndex) {
          const directive = directiveById.get(registrationId);
          if (
            directive?.trigger !== "defensive" ||
            directive.targetLevelId !== registration.safety.defensiveTargetLevelId
          ) {
            throw new ObjectivePortfolioError(
              `Registration ${registrationId} requires a defensive directive.`,
            );
          }
        }
      }
    }

    return Object.freeze({
      directives: Object.freeze(directives),
      deferred: Object.freeze(deferred),
    });
  }

  const supervisor: ObjectivePortfolioSupervisor = {
    async observe() {
      const entries: ObjectivePortfolioEntry[] = [];
      for (const registration of registrationById.values()) {
        const observation = await registration.regulator.probe();
        observationIndex(registration.regulator.instance.describeLevels(), observation);
        entries.push(
          Object.freeze({
            registrationId: registration.id,
            instance: registration.regulator.instance,
            observation,
            safety: registration.safety,
          }),
        );
      }
      return Object.freeze({ entries: Object.freeze(entries) });
    },
    async plan(observation) {
      const entries = validateObservation(observation);
      return validatePlan(await policy(observation), entries);
    },
    async execute(plan, executeAction) {
      if (typeof executeAction !== "function") {
        throw new ObjectivePortfolioError("An action executor is required.");
      }
      const validated = validatePlan(plan);
      const results: {
        registrationId: ObjectiveRegistrationId;
        result: RegulationResult;
      }[] = [];
      for (const directive of validated.directives) {
        const registration = registrationById.get(directive.registrationId);
        if (registration === undefined) {
          throw new ObjectivePortfolioError(`Unknown registration: ${directive.registrationId}.`);
        }
        results.push(
          Object.freeze({
            registrationId: directive.registrationId,
            result: await registration.regulator.regulate(
              {
                targetLevelId: directive.targetLevelId,
                limits: directive.limits,
              },
              executeAction,
            ),
          }),
        );
      }
      return Object.freeze({ results: Object.freeze(results) });
    },
  };

  return Object.freeze(supervisor);
}
