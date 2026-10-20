import { Effect, SubscriptionRef } from "@potential-guide/effects";
import {
  compileSubjectProjection,
  type Envelope,
  type PilotObservation,
} from "@potential-guide/objective-pilot";
import {
  canonicalJson,
  levelRank,
  ObjectivePortfolioError,
  objectiveKey,
  reached,
  validateGoal,
  validatePlan,
} from "./decisions.js";
import type {
  CoordinatorEvent,
  ObjectiveGoal,
  PlannerPolicyInput,
  PlannerState,
  PortfolioPlanner,
  PortfolioPlannerOptions,
  PriorityQueueSnapshot,
  QueueDemand,
} from "./types.js";

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }

  return value;
}

function goalRecipe(goal: ObjectiveGoal): string {
  return canonicalJson([
    goal.pilot,
    goal.subject,
    goal.targetLevel,
    goal.requirements ?? [],
    goal.language ?? null,
  ]);
}

export async function createPortfolioPlanner(
  options: PortfolioPlannerOptions,
): Promise<PortfolioPlanner> {
  const queue = await Effect.runPromise(
    SubscriptionRef.make<PriorityQueueSnapshot>({ revision: 0, demands: [] }),
  );
  const state = await Effect.runPromise(
    SubscriptionRef.make<PlannerState>({ goals: [], observations: {} }),
  );
  let goals = new Map<string, ObjectiveGoal>();
  const observations: Record<string, Envelope<PilotObservation>> = {};
  const due = new Map<string, number>();
  const revisions = new Map<string, number>();
  const needsWork = new Set<string>();
  const dependencies = new Map<string, string>();
  const derived = new Map<string, ObjectiveGoal>();
  let current: PriorityQueueSnapshot = { revision: 0, demands: [] };
  let nextRevision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const controller = new AbortController();
  let pending = Promise.resolve();
  const policy =
    options.policy ??
    (async (input: PlannerPolicyInput) => ({
      directives: input.candidates.map((goal) => ({ goalId: goal.id, priority: goal.priority })),
    }));

  function schedule() {
    clearTimeout(timer);
    if (closed || options.periodic === false || goals.size === 0) return;
    const wait = Math.max(
      1,
      Math.min(...[...goals.keys()].map((id) => due.get(id) ?? 0)) - Date.now(),
    );
    timer = setTimeout(() => {
      void enqueue(() => reconcile([])).catch(() => undefined);
    }, wait);
  }
  function enqueue(action: () => Promise<void>): Promise<void> {
    if (closed) return Promise.reject(new ObjectivePortfolioError("Planner is closed."));
    const operation = pending
      .then(action)
      .catch(async (error: unknown) => {
        await Effect.runPromise(
          SubscriptionRef.set(state, {
            goals: [...goals.values()],
            observations: structuredClone(observations),
            error,
          }),
        );
        throw error;
      })
      .finally(schedule);
    pending = operation.catch(() => undefined);
    return operation;
  }
  function demandRevision(id: string) {
    const revision = ++nextRevision;
    revisions.set(id, revision);
    return revision;
  }
  function markObserved(goal: ObjectiveGoal, observation: Envelope<PilotObservation>) {
    observations[goal.id] = structuredClone(observation);
    if (observation.status !== 200 || observation.payload === null)
      throw new ObjectivePortfolioError(
        `Observation failed for ${goal.id}: ${observation.message}`,
      );
    const needed = !reached(goal, observation.payload);
    if (needed && !needsWork.has(goal.id)) demandRevision(goal.id);
    if (needed) needsWork.add(goal.id);
    else {
      needsWork.delete(goal.id);
      for (const [root, child] of dependencies) {
        if (child === goal.id) {
          dependencies.delete(root);
          due.set(root, 0);
          demandRevision(root);
        }
      }
    }
    due.set(goal.id, Date.now() + goal.observationIntervalMs);
  }
  async function reconcile(events: readonly CoordinatorEvent[]) {
    if (closed) return;
    for (const goal of goals.values()) {
      if ((due.get(goal.id) ?? 0) <= Date.now()) {
        // Advance the deadline before I/O so failed probes never produce a busy retry loop.
        due.set(goal.id, Date.now() + goal.observationIntervalMs);
        const observation = await options.observe(
          immutable(structuredClone(goal)),
          controller.signal,
        );
        if (closed) return;
        markObserved(goal, observation);
      }
    }
    const candidates = [...goals.values()].filter((goal) => {
      const dependency = dependencies.get(goal.id);
      return needsWork.has(goal.id) && (dependency === undefined || !needsWork.has(dependency));
    });
    const input: PlannerPolicyInput = immutable(
      structuredClone({
        goals: [...goals.values()],
        candidates,
        observations,
        previousQueue: current,
        events,
      }),
    );
    const plan = validatePlan(await policy(input), input);
    if (closed) return;
    const demands: QueueDemand[] = plan.directives.map((directive) => {
      const goal = goals.get(directive.goalId);
      if (goal === undefined)
        throw new ObjectivePortfolioError(`Unknown directive goal: ${directive.goalId}.`);
      const next = {
        ...goal,
        priority: directive.priority,
        targetLevel: directive.targetLevel ?? goal.targetLevel,
        requirements: [
          ...new Set([...(goal.requirements ?? []), ...(directive.requirements ?? [])]),
        ],
      };
      const previous = current.demands.find((entry) => entry.id === goal.id);
      if (
        previous &&
        (previous.targetLevel !== next.targetLevel ||
          canonicalJson(previous.requirements ?? []) !== canonicalJson(next.requirements))
      )
        demandRevision(goal.id);
      return { ...next, revision: revisions.get(goal.id) ?? demandRevision(goal.id) };
    });
    if (canonicalJson(demands) !== canonicalJson(current.demands)) {
      current = immutable({ revision: current.revision + 1, demands });
      await Effect.runPromise(SubscriptionRef.set(queue, current));
    }
    await Effect.runPromise(
      SubscriptionRef.set(
        state,
        immutable({ goals: [...goals.values()], observations: structuredClone(observations) }),
      ),
    );
  }

  function merge(entries: readonly ObjectiveGoal[]): Map<string, ObjectiveGoal> {
    const byKey = new Map<string, ObjectiveGoal>();
    const ids = new Set<string>();
    for (const source of entries) {
      validateGoal(source);
      if (ids.has(source.id)) throw new ObjectivePortfolioError(`Duplicate goal ID: ${source.id}.`);
      ids.add(source.id);
      const goal = structuredClone(source);
      const key = objectiveKey(goal);
      const previous = byKey.get(key);
      if (previous) {
        if (canonicalJson(previous.pilot) !== canonicalJson(goal.pilot))
          throw new ObjectivePortfolioError(
            "Conflicting specifications for the same objective and subject.",
          );
        byKey.set(key, {
          ...previous,
          targetLevel:
            levelRank(goal.pilot, goal.targetLevel) >
            levelRank(previous.pilot, previous.targetLevel)
              ? goal.targetLevel
              : previous.targetLevel,
          priority: Math.min(previous.priority, goal.priority),
          observationIntervalMs: Math.min(
            previous.observationIntervalMs,
            goal.observationIntervalMs,
          ),
          requirements: [
            ...new Set([...(previous.requirements ?? []), ...(goal.requirements ?? [])]),
          ],
        });
      } else byKey.set(key, goal);
    }
    return new Map([...byKey.values()].map((goal) => [goal.id, immutable(goal)]));
  }

  const planner: PortfolioPlanner = {
    queue,
    state,
    updateGoals(entries) {
      const stable = merge(entries);
      return enqueue(async () => {
        for (const [id, old] of goals) {
          if (derived.has(id)) continue;
          const next = stable.get(id);
          if (!next || goalRecipe(old) !== goalRecipe(next)) {
            delete observations[id];
            due.delete(id);
            dependencies.delete(id);
            needsWork.delete(id);
            demandRevision(id);
          } else if (next.observationIntervalMs !== old.observationIntervalMs) {
            due.set(id, Math.min(due.get(id) ?? 0, Date.now() + next.observationIntervalMs));
          }
        }
        // Derived demands are owned by current roots, never orphaned portfolio work.
        const retained = new Set<string>();
        for (const root of stable.keys()) {
          let child = dependencies.get(root);
          while (child !== undefined && !retained.has(child)) {
            retained.add(child);
            child = dependencies.get(child);
          }
        }
        for (const [id, goal] of derived) {
          if (stable.has(id)) derived.delete(id);
          else if (retained.has(id)) stable.set(id, goal);
          else {
            derived.delete(id);
            dependencies.delete(id);
            needsWork.delete(id);
            due.delete(id);
            delete observations[id];
          }
        }
        for (const id of retained) {
          if (stable.has(id)) continue;
          const required = goals.get(id);
          if (required) {
            stable.set(id, required);
            derived.set(id, required);
          }
        }
        for (const [id, child] of derived) {
          const parents = [...dependencies]
            .filter(([, dependency]) => dependency === id)
            .flatMap(([parent]) => {
              const owner = stable.get(parent);
              return owner ? [owner] : [];
            });
          if (parents.length > 0) {
            const updated = immutable({
              ...child,
              priority: Math.min(...parents.map((parent) => parent.priority)),
            });
            stable.set(id, updated);
            derived.set(id, updated);
          }
        }
        goals = stable;
        await reconcile([]);
      });
    },
    feedback(event) {
      return enqueue(async () => {
        const goal = goals.get(event.demand.id);
        if (!goal || revisions.get(goal.id) !== event.demand.revision) return;
        if (event.type === "result") {
          if (event.outcome.stopReason === "prerequisite-unmet") {
            const requirement = event.outcome.prerequisite;
            const child = goal.pilot.prerequisite;
            const declaration = goal.pilot.manifest.prerequisite;
            if (
              !requirement ||
              !child ||
              !declaration ||
              canonicalJson(requirement.spec) !== canonicalJson(child) ||
              canonicalJson(requirement.subject) !==
                canonicalJson(compileSubjectProjection(declaration.subject)(goal.subject))
            )
              throw new ObjectivePortfolioError(
                "Prerequisite feedback must identify the known direct child and projected subject.",
              );
            levelRank(child, requirement.minimumLevelId);
            if (
              declaration.minimumLevelId !== undefined &&
              levelRank(child, requirement.minimumLevelId) <
                levelRank(child, declaration.minimumLevelId)
            )
              throw new ObjectivePortfolioError(
                "Prerequisite feedback cannot weaken the declared minimum.",
              );
            const candidate: ObjectiveGoal = {
              id: `prerequisite:${objectiveKey({ pilot: child, subject: requirement.subject })}`,
              pilot: child,
              subject: requirement.subject,
              targetLevel: requirement.minimumLevelId,
              priority: event.demand.priority,
              observationIntervalMs: goal.observationIntervalMs,
              ...(goal.language === undefined ? {} : { language: goal.language }),
            };
            const shared = [...goals.values()].find(
              (entry) => objectiveKey(entry) === objectiveKey(candidate),
            );
            if (!shared && goals.has(candidate.id))
              throw new ObjectivePortfolioError(
                "Generated prerequisite ID conflicts with a registered goal.",
              );
            const merged = shared
              ? {
                  ...shared,
                  targetLevel:
                    levelRank(child, shared.targetLevel) >= levelRank(child, candidate.targetLevel)
                      ? shared.targetLevel
                      : candidate.targetLevel,
                  priority: Math.min(shared.priority, candidate.priority),
                }
              : candidate;
            if (!shared || canonicalJson(shared) !== canonicalJson(merged))
              demandRevision(merged.id);
            goals.set(merged.id, immutable(merged));
            if (!shared || derived.has(shared.id)) derived.set(merged.id, merged);
            needsWork.add(merged.id);
            due.set(merged.id, 0);
            dependencies.set(goal.id, merged.id);
            needsWork.add(goal.id);
            due.set(goal.id, Date.now() + goal.observationIntervalMs);
          } else {
            if (
              event.outcome.stopReason === "exhausted" &&
              event.outcome.latestObservation.payload === null
            ) {
              observations[goal.id] = structuredClone(event.outcome.latestObservation);
              due.set(goal.id, Date.now() + goal.observationIntervalMs);
            } else markObserved(goal, event.outcome.latestObservation);
            if (
              event.outcome.stopReason === "exhausted" ||
              event.outcome.stopReason === "authorization-required"
            )
              needsWork.add(goal.id);
            else {
              needsWork.delete(goal.id);
              for (const [root, child] of dependencies) {
                if (child === goal.id) {
                  dependencies.delete(root);
                  due.set(root, 0);
                  demandRevision(root);
                }
              }
            }
          }
        }
        await reconcile([event]);
      });
    },
    refresh: () =>
      enqueue(async () => {
        for (const id of goals.keys()) due.set(id, 0);
        await reconcile([]);
      }),
    async close() {
      closed = true;
      clearTimeout(timer);
      controller.abort();
      await pending;
    },
  };
  try {
    await planner.updateGoals(options.goals);
  } catch (error) {
    await planner.close();
    throw error;
  }
  return planner;
}
