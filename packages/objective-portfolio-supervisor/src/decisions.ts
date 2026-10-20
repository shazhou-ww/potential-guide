import {
  canonicalObjectiveUri,
  isJsonValue,
  type PilotObservation,
  type PilotSpec,
  validateGitPilotSource,
} from "@potential-guide/objective-pilot";
import type {
  ActiveRun,
  AgentResource,
  ObjectiveGoal,
  PlannerPlan,
  PlannerPolicyInput,
  QueueDemand,
} from "./types.js";

export class ObjectivePortfolioError extends TypeError {}

export function canonicalJson(value: unknown): string {
  if (!isJsonValue(value)) throw new ObjectivePortfolioError("Expected finite JSON data.");
  function normalize(entry: unknown): unknown {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry !== null && typeof entry === "object")
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, normalize(child)]),
      );
    return entry;
  }
  return JSON.stringify(normalize(value));
}

export function objectiveKey(goal: Pick<ObjectiveGoal, "objective" | "subject">): string {
  return canonicalJson([goal.objective.objectiveId, goal.subject]);
}

export function levelRank(objective: PilotSpec, level: string): number {
  if (level === "terminal") return objective.manifest.levels.length;
  const rank = objective.manifest.levels.findIndex(({ id }) => id === level);
  if (rank < 0) throw new ObjectivePortfolioError(`Unknown target level: ${level}.`);
  return rank;
}

export function reached(goal: ObjectiveGoal, observation: PilotObservation): boolean {
  return (
    observation.current.objectiveId === goal.objective.objectiveId &&
    levelRank(goal.objective, observation.current.levelId) >=
      levelRank(goal.objective, goal.targetLevel)
  );
}

export function validateGoal(goal: ObjectiveGoal): void {
  canonicalJson(goal);
  if (
    Object.keys(goal).some(
      (key) =>
        ![
          "id",
          "objective",
          "subject",
          "targetLevel",
          "priority",
          "observationIntervalMs",
          "requirements",
          "language",
          "bindingRevision",
          "sourceBindings",
          "revision",
        ].includes(key),
    ) ||
    !goal.id?.trim() ||
    !goal.objective?.objectiveId?.trim() ||
    !goal.subject ||
    typeof goal.subject !== "object" ||
    Array.isArray(goal.subject) ||
    !Number.isSafeInteger(goal.priority) ||
    goal.priority < 0 ||
    !Number.isSafeInteger(goal.observationIntervalMs) ||
    goal.observationIntervalMs < 1 ||
    goal.observationIntervalMs > 2_147_483_647 ||
    (goal.requirements !== undefined &&
      (!Array.isArray(goal.requirements) ||
        goal.requirements.some((value) => typeof value !== "string" || !value.trim())))
  )
    throw new ObjectivePortfolioError("Invalid objective goal.");
  if (
    !goal.objective.objectiveId.startsWith("git+") ||
    canonicalObjectiveUri(goal.objective.objectiveId) !== goal.objective.objectiveId ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(goal.objective.version)
  )
    throw new ObjectivePortfolioError(
      "Goal requires a canonical Pilot directory and exact content version.",
    );
  if (goal.objective.source !== undefined)
    validateGitPilotSource(
      goal.objective.objectiveId,
      goal.objective.version,
      goal.objective.source,
    );
  if (goal.sourceBindings !== undefined) {
    if (
      goal.sourceBindings === null ||
      typeof goal.sourceBindings !== "object" ||
      Array.isArray(goal.sourceBindings)
    )
      throw new ObjectivePortfolioError("Invalid source binding table.");
    for (const [id, source] of Object.entries(goal.sourceBindings))
      validateGitPilotSource(id, source.tree, source);
  }
  levelRank(goal.objective, goal.targetLevel);
}

export function validatePlan(plan: PlannerPlan, input: PlannerPolicyInput): PlannerPlan {
  if (
    !plan ||
    Object.keys(plan).some((key) => key !== "directives") ||
    !Array.isArray(plan.directives)
  )
    throw new ObjectivePortfolioError("Planner must return only a directives array.");
  const known = new Map(input.candidates.map((goal) => [goal.id, goal]));
  const seen = new Set<string>();
  for (const directive of plan.directives) {
    if (
      !directive ||
      Object.keys(directive).some(
        (key) => !["goalId", "priority", "targetLevel", "requirements"].includes(key),
      )
    )
      throw new ObjectivePortfolioError("Unsupported planner directive fields.");
    const goal = known.get(directive.goalId);
    if (
      !goal ||
      seen.has(goal.id) ||
      !Number.isSafeInteger(directive.priority) ||
      directive.priority < 0
    )
      throw new ObjectivePortfolioError(
        "Planner directive must identify a unique eligible goal and valid priority.",
      );
    seen.add(goal.id);
    if (
      directive.targetLevel !== undefined &&
      levelRank(goal.objective, directive.targetLevel) < levelRank(goal.objective, goal.targetLevel)
    )
      throw new ObjectivePortfolioError("Planner cannot weaken a required target.");
    if (
      directive.requirements !== undefined &&
      (!Array.isArray(directive.requirements) ||
        directive.requirements.some((entry: unknown) => typeof entry !== "string" || !entry.trim()))
    )
      throw new ObjectivePortfolioError(
        "Planner capability requirements must be nonempty strings.",
      );
  }
  return structuredClone(plan);
}

export function supports(resource: AgentResource, demand: ObjectiveGoal): boolean {
  return (demand.requirements ?? []).every((capability) =>
    resource.capabilities.includes(capability),
  );
}

export function chooseResource(
  demand: QueueDemand,
  resources: readonly AgentResource[],
  runs: readonly ActiveRun[],
  maxConcurrency: number,
): AgentResource | undefined {
  if (
    runs.length >= maxConcurrency ||
    runs.some((run) => objectiveKey(run.demand) === objectiveKey(demand))
  )
    return undefined;
  return resources
    .filter(
      (resource) =>
        supports(resource, demand) &&
        runs.filter((run) => run.resourceId === resource.id).length < resource.capacity,
    )
    .sort((a, b) => {
      const load = (resource: AgentResource) =>
        runs.filter((run) => run.resourceId === resource.id).length / resource.capacity;
      return load(a) - load(b) || a.id.localeCompare(b.id);
    })[0];
}

/** Pure minimum-victim decision; stopping runs still occupy capacity. */
export function preemptionVictims(
  demand: QueueDemand,
  resources: readonly AgentResource[],
  runs: readonly ActiveRun[],
  maxConcurrency: number,
): readonly ActiveRun[] {
  if (demand.priority !== 0 || chooseResource(demand, resources, runs, maxConcurrency)) return [];
  let best: ActiveRun[] | undefined;
  for (const resource of resources.filter((entry) => supports(entry, demand))) {
    const remaining = [...runs];
    const removed: ActiveRun[] = [];
    const remove = (run: ActiveRun | undefined): boolean => {
      if (!run || run.demand.priority === 0 || run.status === "stopping") return false;
      removed.push(run);
      remaining.splice(remaining.indexOf(run), 1);
      return true;
    };
    const same = remaining.find((run) => objectiveKey(run.demand) === objectiveKey(demand));
    if (same && !remove(same)) continue;
    const victims = () =>
      [...remaining]
        .filter((run) => run.demand.priority > 0 && run.status === "running")
        .sort((a, b) => b.demand.priority - a.demand.priority);
    while (remaining.filter((run) => run.resourceId === resource.id).length >= resource.capacity) {
      if (!remove(victims().find((run) => run.resourceId === resource.id))) break;
    }
    while (remaining.length >= maxConcurrency) {
      if (!remove(victims()[0])) break;
    }
    if (
      chooseResource(demand, [resource], remaining, maxConcurrency) &&
      (!best || removed.length < best.length)
    )
      best = removed;
  }
  return best ?? [];
}
