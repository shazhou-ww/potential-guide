import type {
  ObjectiveGuideInstance,
  ObjectiveLevelDescription,
  ObjectiveLevelId,
  ObjectiveObservation,
  ObservedProblem,
} from "@potential-guide/objective-guide";

export interface RegulationLimits {
  maxIterations: number;
  timeoutMs: number;
  maxStalledIterations: number;
}

export interface ObjectiveActionRequest {
  targetLevelId: ObjectiveLevelId;
  observation: ObjectiveObservation;
  problem: ObservedProblem;
}

export type ObjectiveActionResult =
  | {
      status: "completed";
      summary: string;
    }
  | {
      status: "blocked";
      reason: string;
    };

export type ObjectiveActionExecutor = (
  request: ObjectiveActionRequest,
) => Promise<ObjectiveActionResult>;

export interface RegulationRequest {
  targetLevelId: ObjectiveLevelId;
  limits: RegulationLimits;
  signal?: AbortSignal;
}

export type RegulationStatus =
  | "target-reached"
  | "no-actionable-problem"
  | "action-blocked"
  | "no-progress"
  | "max-iterations"
  | "timed-out";

export interface RegulationResult {
  status: RegulationStatus;
  targetLevelId: ObjectiveLevelId;
  iterations: number;
  latestObservation: ObjectiveObservation;
}

export interface ObjectiveRegulator {
  readonly instance: ObjectiveGuideInstance;
  probe(): Promise<ObjectiveObservation>;
  regulate(
    request: RegulationRequest,
    executeAction: ObjectiveActionExecutor,
  ): Promise<RegulationResult>;
}

export class ObjectiveRegulatorError extends TypeError {}

export class ObjectiveRegulatorTimeoutError extends Error {}

const timedOut = Symbol("timed-out");

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateLimits(limits: RegulationLimits): void {
  if (
    !Number.isSafeInteger(limits.maxIterations) ||
    limits.maxIterations < 0 ||
    !Number.isSafeInteger(limits.maxStalledIterations) ||
    limits.maxStalledIterations < 1 ||
    !Number.isFinite(limits.timeoutMs) ||
    limits.timeoutMs <= 0
  ) {
    throw new ObjectiveRegulatorError(
      "Regulation limits require nonnegative safe maxIterations, positive safe " +
        "maxStalledIterations, and positive finite timeoutMs.",
    );
  }
}

function validateActionResult(value: unknown): ObjectiveActionResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ObjectiveRegulatorError("Action executor returned an invalid result.");
  }
  const result = value as Record<string, unknown>;
  if (result.status === "completed" && Object.keys(result).length === 2 && text(result.summary)) {
    return { status: "completed", summary: result.summary };
  }
  if (result.status === "blocked" && Object.keys(result).length === 2 && text(result.reason)) {
    return { status: "blocked", reason: result.reason };
  }
  throw new ObjectiveRegulatorError("Action executor returned an invalid result.");
}

async function withinDeadline<T>(
  operation: Promise<T>,
  deadline: number,
): Promise<T | typeof timedOut> {
  const remaining = deadline - performance.now();
  if (remaining <= 0) {
    operation.catch(() => undefined);
    return timedOut;
  }
  return new Promise<T | typeof timedOut>((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const scheduleTimeout = () => {
      const nextRemaining = deadline - performance.now();
      if (nextRemaining <= 0) {
        resolve(timedOut);
        return;
      }
      timer = setTimeout(scheduleTimeout, Math.min(nextRemaining, 2_147_483_647));
    };
    scheduleTimeout();
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function descriptionIndex(
  levels: readonly ObjectiveLevelDescription[],
  description: ObjectiveLevelDescription,
): number {
  const index = levels.findIndex(
    (entry) =>
      entry === description ||
      (entry.instance === description.instance && entry.id === description.id),
  );
  if (index < 0) {
    throw new ObjectiveRegulatorError(
      "Observation refers to a level outside the regulator instance.",
    );
  }
  return index;
}

function result(
  status: RegulationStatus,
  targetLevelId: ObjectiveLevelId,
  iterations: number,
  latestObservation: ObjectiveObservation,
): RegulationResult {
  return Object.freeze({
    status,
    targetLevelId,
    iterations,
    latestObservation,
  });
}

export function createObjectiveRegulator(instance: ObjectiveGuideInstance): ObjectiveRegulator {
  if (
    instance === null ||
    typeof instance !== "object" ||
    typeof instance.probe !== "function" ||
    typeof instance.describeLevels !== "function"
  ) {
    throw new ObjectiveRegulatorError("A valid Objective Guide instance is required.");
  }

  const regulator: ObjectiveRegulator = {
    instance,
    probe: () => instance.probe(),
    async regulate(request, executeAction) {
      const { targetLevelId, limits } = request;
      if (!text(targetLevelId)) {
        throw new ObjectiveRegulatorError("Target level ID must be nonempty.");
      }
      if (typeof executeAction !== "function") {
        throw new ObjectiveRegulatorError("An action executor is required.");
      }
      validateLimits(limits);

      const levels = instance.describeLevels();
      const targetIndex = levels.findIndex(
        (description) => description.instance === instance && description.id === targetLevelId,
      );
      if (targetIndex < 0) {
        throw new ObjectiveRegulatorError(
          "Target level must be an explicit level or terminal of the regulator instance.",
        );
      }

      const deadline = performance.now() + limits.timeoutMs;
      const initial = await withinDeadline(instance.probe(request.signal), deadline);
      if (initial === timedOut) {
        throw new ObjectiveRegulatorTimeoutError(
          "Initial probe timed out before an observation was available.",
        );
      }

      let latestObservation = initial;
      let currentIndex = descriptionIndex(levels, latestObservation.current);
      let iterations = 0;
      let stalledIterations = 0;

      while (true) {
        if (currentIndex >= targetIndex) {
          return result("target-reached", targetLevelId, iterations, latestObservation);
        }
        const problem = latestObservation.problems[0];
        if (problem === undefined) {
          return result("no-actionable-problem", targetLevelId, iterations, latestObservation);
        }
        if (iterations >= limits.maxIterations) {
          return result("max-iterations", targetLevelId, iterations, latestObservation);
        }
        if (performance.now() >= deadline) {
          return result("timed-out", targetLevelId, iterations, latestObservation);
        }

        const actionRequest = Object.freeze({
          targetLevelId,
          observation: latestObservation,
          problem,
        });
        iterations += 1;
        const action = await withinDeadline(executeAction(actionRequest), deadline);
        if (action === timedOut) {
          return result("timed-out", targetLevelId, iterations, latestObservation);
        }
        const actionResult = validateActionResult(action);
        if (actionResult.status === "blocked") {
          return result("action-blocked", targetLevelId, iterations, latestObservation);
        }

        const observed = await withinDeadline(instance.probe(request.signal), deadline);
        if (observed === timedOut) {
          return result("timed-out", targetLevelId, iterations, latestObservation);
        }
        const nextIndex = descriptionIndex(levels, observed.current);
        stalledIterations = nextIndex > currentIndex ? 0 : stalledIterations + 1;
        latestObservation = observed;
        currentIndex = nextIndex;

        if (currentIndex >= targetIndex) {
          return result("target-reached", targetLevelId, iterations, latestObservation);
        }
        if (latestObservation.problems.length === 0) {
          return result("no-actionable-problem", targetLevelId, iterations, latestObservation);
        }
        if (stalledIterations >= limits.maxStalledIterations) {
          return result("no-progress", targetLevelId, iterations, latestObservation);
        }
      }
    },
  };

  return Object.freeze(regulator);
}
