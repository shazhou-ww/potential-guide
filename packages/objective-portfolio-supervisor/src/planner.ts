import { Effect, SubscriptionRef } from "@potential-guide/effects";
import {
  compileDomain,
  type Envelope,
  type PilotObservation,
  type PilotSpec,
  parseDependencyProblem,
  validateGitPilotSource,
  validateSubject,
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
function recipe(goal: ObjectiveGoal): string {
  return canonicalJson([
    goal.objective,
    goal.subject,
    goal.targetLevel,
    goal.requirements ?? [],
    goal.language ?? null,
    goal.bindingRevision ?? null,
    goal.sourceBindings ?? null,
  ]);
}
interface Wait {
  readonly provider: string;
  readonly minimum: string;
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
  let roots = new Map<string, ObjectiveGoal>();
  let goals = new Map<string, ObjectiveGoal>();
  const derived = new Map<string, ObjectiveGoal>();
  const waits = new Map<string, readonly Wait[]>();
  const observations: Record<string, Envelope<PilotObservation>> = {};
  const due = new Map<string, number>();
  const revisions = new Map<string, number>();
  const needsWork = new Set<string>();
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
  const revision = (id: string) => {
    const value = ++nextRevision;
    revisions.set(id, value);
    return value;
  };

  function schedule() {
    clearTimeout(timer);
    if (closed || options.periodic === false || goals.size === 0) return;
    timer = setTimeout(
      () => {
        void enqueue(() => reconcile([])).catch(() => undefined);
      },
      Math.max(1, Math.min(...[...goals.keys()].map((id) => due.get(id) ?? 0)) - Date.now()),
    );
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
        if (canonicalJson(previous.objective) !== canonicalJson(goal.objective))
          throw new ObjectivePortfolioError(
            "Conflicting specifications for the same objective and subject.",
          );
        byKey.set(key, {
          ...previous,
          targetLevel:
            levelRank(goal.objective, goal.targetLevel) >
            levelRank(previous.objective, previous.targetLevel)
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
  function checkCycles(graph: ReadonlyMap<string, readonly Wait[]>) {
    const visited = new Set<string>();
    function walk(id: string, path: readonly string[]) {
      if (path.includes(id))
        throw new ObjectivePortfolioError(`Dependency wait cycle: ${[...path, id].join(" -> ")}.`);
      if (visited.has(id)) return;
      for (const wait of graph.get(id) ?? []) walk(wait.provider, [...path, id]);
      visited.add(id);
    }
    for (const id of graph.keys()) walk(id, []);
  }
  async function rebuild() {
    const live = new Set<string>();
    function retain(id: string) {
      if (live.has(id)) return;
      live.add(id);
      for (const wait of waits.get(id) ?? []) retain(wait.provider);
    }
    for (const id of roots.keys()) retain(id);
    const next = new Map(roots);
    for (const id of live) {
      if (!next.has(id)) {
        const goal = derived.get(id) ?? goals.get(id);
        if (!goal) throw new ObjectivePortfolioError(`Missing dependency provider ${id}.`);
        next.set(id, goal);
      }
    }
    for (const [id, goal] of next) {
      const consumers = [...waits]
        .filter(([consumer]) => live.has(consumer))
        .flatMap(([consumer, entries]) =>
          entries.filter((wait) => wait.provider === id).map((wait) => ({ consumer, wait })),
        );
      if (consumers.length === 0) continue;
      const base = roots.get(id);
      const minimums = [
        ...(base ? [base.targetLevel] : []),
        ...consumers.map(({ wait }) => wait.minimum),
      ];
      const targetLevel = minimums.reduce((a, b) =>
        levelRank(goal.objective, a) >= levelRank(goal.objective, b) ? a : b,
      );
      const updated = immutable({
        ...goal,
        targetLevel,
        observationIntervalMs: Math.min(
          base?.observationIntervalMs ?? Infinity,
          ...consumers.map(
            ({ consumer }) =>
              next.get(consumer)?.observationIntervalMs ?? goal.observationIntervalMs,
          ),
        ),
        requirements: [
          ...new Set([
            ...(base?.requirements ?? []),
            ...consumers.flatMap(({ consumer }) => next.get(consumer)?.requirements ?? []),
          ]),
        ],
        priority: Math.min(
          base?.priority ?? Infinity,
          ...consumers.map(({ consumer }) => next.get(consumer)?.priority ?? goal.priority),
        ),
      });
      if (recipe(updated) !== recipe(goals.get(id) ?? goal)) {
        revision(id);
        due.set(id, 0);
      }
      if (updated.observationIntervalMs < goal.observationIntervalMs)
        due.set(id, Math.min(due.get(id) ?? 0, Date.now() + updated.observationIntervalMs));
      next.set(id, updated);
    }
    const removed = [...goals].filter(([id]) => !next.has(id));
    goals = next;
    for (const [id] of removed) {
      waits.delete(id);
      derived.delete(id);
      needsWork.delete(id);
      due.delete(id);
      delete observations[id];
      revision(id);
    }
    for (const [, goal] of removed) {
      if (
        ![...goals.values()].some(
          (entry) => canonicalJson(entry.objective) === canonicalJson(goal.objective),
        )
      )
        await options.releaseObjective?.(goal.objective);
    }
  }
  function markObserved(goal: ObjectiveGoal, observation: Envelope<PilotObservation>) {
    observations[goal.id] = structuredClone(observation);
    if (observation.status !== 200 || observation.payload === null)
      throw new ObjectivePortfolioError(
        `Observation failed for ${goal.id}: ${observation.message}`,
      );
    if (
      observation.payload.current.objectiveId !== goal.objective.objectiveId ||
      observation.payload.versions[goal.objective.objectiveId] !== goal.objective.version
    )
      throw new ObjectivePortfolioError(`Observation source mismatch for ${goal.id}.`);
    if (goal.objective.source !== undefined) {
      for (const [id, version] of Object.entries(observation.payload.versions))
        validateGitPilotSource(id, version, observation.payload.sources?.[id]);
      if (
        observation.payload.sources?.[goal.objective.objectiveId]?.commit !==
        goal.objective.source.commit
      )
        throw new ObjectivePortfolioError(`Observation snapshot mismatch for ${goal.id}.`);
    }
    const previousWaits = waits.get(goal.id);
    if (previousWaits) {
      const dependencies = observation.payload.problems.filter(
        (problem) => problem.kind === "dependency",
      );
      const matches = (wait: Wait, dependency: (typeof dependencies)[number]) => {
        const provider = goals.get(wait.provider);
        return (
          provider !== undefined &&
          provider.objective.objectiveId === dependency.objectiveId &&
          canonicalJson(provider.subject) === canonicalJson(dependency.subject) &&
          wait.minimum === dependency.expectedLevelId &&
          observation.payload?.versions[dependency.objectiveId] === provider.objective.version
        );
      };
      const retained = previousWaits.filter((wait) =>
        dependencies.some((dependency) => matches(wait, dependency)),
      );
      const changedRequirement = dependencies.some(
        (dependency) => !previousWaits.some((wait) => matches(wait, dependency)),
      );
      if (retained.length !== previousWaits.length || changedRequirement) {
        if (retained.length && !changedRequirement) waits.set(goal.id, retained);
        else waits.delete(goal.id);
        revision(goal.id);
      }
    }
    const needed = !reached(goal, observation.payload);
    if (needed && !needsWork.has(goal.id)) revision(goal.id);
    if (needed) needsWork.add(goal.id);
    else {
      needsWork.delete(goal.id);
      waits.delete(goal.id);
    }
    for (const [consumer, entries] of waits) {
      const remaining = entries.filter(
        (wait) =>
          wait.provider !== goal.id ||
          levelRank(goal.objective, observation.payload?.current.levelId ?? "") <
            levelRank(goal.objective, wait.minimum),
      );
      if (remaining.length === entries.length) continue;
      if (remaining.length) waits.set(consumer, remaining);
      else {
        waits.delete(consumer);
        due.set(consumer, 0);
        revision(consumer);
      }
    }
    due.set(goal.id, Date.now() + goal.observationIntervalMs);
  }
  async function reconcile(events: readonly CoordinatorEvent[]) {
    if (closed) return;
    for (const goal of [...goals.values()]) {
      if ((due.get(goal.id) ?? 0) > Date.now()) continue;
      due.set(goal.id, Date.now() + goal.observationIntervalMs);
      const observation = await options.observe(
        immutable(structuredClone(goal)),
        controller.signal,
      );
      if (closed) return;
      markObserved(goal, observation);
    }
    await rebuild();
    // A provider can wake a consumer that occurred earlier in iteration order.
    for (const goal of [...goals.values()]) {
      if ((due.get(goal.id) ?? 0) !== 0 || waits.has(goal.id)) continue;
      due.set(goal.id, Date.now() + goal.observationIntervalMs);
      const observation = await options.observe(
        immutable(structuredClone(goal)),
        controller.signal,
      );
      if (closed) return;
      markObserved(goal, observation);
    }
    await rebuild();
    const candidates = [...goals.values()].filter(
      (goal) => needsWork.has(goal.id) && !waits.has(goal.id),
    );
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
      if (!goal) throw new ObjectivePortfolioError(`Unknown directive goal ${directive.goalId}.`);
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
        revision(goal.id);
      return { ...next, revision: revisions.get(goal.id) ?? revision(goal.id) };
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
  const planner: PortfolioPlanner = {
    queue,
    state,
    updateGoals(entries) {
      const stable = merge(entries);
      return enqueue(async () => {
        const bindingChanged = [...stable].some(([id, goal]) => {
          const old = roots.get(id);
          return (
            old !== undefined &&
            objectiveKey(old) === objectiveKey(goal) &&
            (canonicalJson(old.objective) !== canonicalJson(goal.objective) ||
              old.bindingRevision !== goal.bindingRevision)
          );
        });
        if (bindingChanged) {
          for (const goal of derived.values()) await options.releaseObjective?.(goal.objective);
          derived.clear();
          waits.clear();
          for (const id of goals.keys()) {
            delete observations[id];
            needsWork.delete(id);
            due.set(id, 0);
            revision(id);
          }
        }
        for (const [id, old] of roots) {
          const replacement = stable.get(id);
          const hasConsumers = [...waits].some(
            ([consumer, entries]) =>
              consumer !== id && entries.some((wait) => wait.provider === id),
          );
          if (!replacement || !hasConsumers) continue;
          if (objectiveKey(old) === objectiveKey(replacement)) {
            if (canonicalJson(old.objective) !== canonicalJson(replacement.objective))
              throw new ObjectivePortfolioError(
                "Conflicting specifications for a provider with live consumers.",
              );
            continue;
          }
          const retainedId = `dependency:${objectiveKey(old)}`;
          if (stable.has(retainedId) || retainedId === id)
            throw new ObjectivePortfolioError(
              "Replacement conflicts with a retained dependency instance.",
            );
          const retained = immutable({ ...old, id: retainedId });
          derived.set(retainedId, retained);
          goals.set(retainedId, retained);
          due.set(retainedId, 0);
          revision(retainedId);
          for (const [consumer, entries] of waits)
            waits.set(
              consumer,
              entries.map((wait) =>
                wait.provider === id ? { ...wait, provider: retainedId } : wait,
              ),
            );
          const outgoing = waits.get(id);
          if (outgoing) waits.set(retainedId, outgoing);
        }
        for (const goal of stable.values()) {
          const previous = [...goals.values()].find(
            (entry) => objectiveKey(entry) === objectiveKey(goal),
          );
          if (!previous || previous.id === goal.id) continue;
          if (canonicalJson(previous.objective) !== canonicalJson(goal.objective))
            throw new ObjectivePortfolioError(
              "Conflicting specifications for the same objective and subject.",
            );
          for (const [consumer, entries] of waits)
            waits.set(
              consumer,
              entries.map((wait) =>
                wait.provider === previous.id ? { ...wait, provider: goal.id } : wait,
              ),
            );
          const outgoing = waits.get(previous.id);
          if (outgoing) {
            waits.set(goal.id, outgoing);
            waits.delete(previous.id);
          }
          due.set(goal.id, 0);
          revision(previous.id);
        }
        for (const [id, old] of roots) {
          const next = stable.get(id);
          if (!next || recipe(old) !== recipe(next)) {
            waits.delete(id);
            delete observations[id];
            needsWork.delete(id);
            due.delete(id);
            revision(id);
          } else if (next.observationIntervalMs !== old.observationIntervalMs) {
            due.set(id, Math.min(due.get(id) ?? 0, Date.now() + next.observationIntervalMs));
          }
        }
        roots = stable;
        await rebuild();
        await reconcile([]);
      });
    },
    feedback(event) {
      return enqueue(async () => {
        const goal = goals.get(event.demand.id);
        if (!goal || revisions.get(goal.id) !== event.demand.revision) return;
        if (event.type === "result") {
          const outcome = event.outcome;
          if (outcome.stopReason === "dependency-required") {
            const observation = outcome.latestObservation.payload;
            if (
              !observation ||
              outcome.latestObservation.status !== 200 ||
              observation.current.objectiveId !== goal.objective.objectiveId ||
              observation.versions[goal.objective.objectiveId] !== goal.objective.version ||
              canonicalJson(outcome.dependencies) !==
                canonicalJson(
                  observation.problems.filter((problem) => problem.kind === "dependency"),
                ) ||
              !outcome.dependencies.length
            )
              throw new ObjectivePortfolioError(
                "Invalid dependency handoff observation or payload.",
              );
            if (goal.objective.source !== undefined) {
              for (const [id, version] of Object.entries(observation.versions))
                validateGitPilotSource(id, version, observation.sources?.[id]);
              if (
                observation.sources?.[goal.objective.objectiveId]?.commit !==
                goal.objective.source.commit
              )
                throw new ObjectivePortfolioError("Handoff snapshot mismatch.");
            }
            levelRank(goal.objective, observation.current.levelId);
            const additions = new Map<string, ObjectiveGoal>();
            const requirements: Wait[] = [];
            for (const value of outcome.dependencies) {
              const requirement = parseDependencyProblem(value);
              const version = observation.versions[requirement.objectiveId];
              if (!version || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(version))
                throw new ObjectivePortfolioError("Missing exact dependency version.");
              if (goal.objective.source !== undefined)
                validateGitPilotSource(
                  requirement.objectiveId,
                  version,
                  observation.sources?.[requirement.objectiveId],
                );
              const existing = [...goals.values(), ...additions.values()].find(
                (entry) =>
                  objectiveKey(entry) ===
                  canonicalJson([requirement.objectiveId, requirement.subject]),
              );
              const objective: PilotSpec =
                existing?.objective ??
                (await (options.resolveObjective?.(
                  requirement.objectiveId,
                  version,
                  controller.signal,
                  observation.sources?.[requirement.objectiveId],
                ) ??
                  Promise.reject(
                    new ObjectivePortfolioError("Dependency source resolver is required."),
                  )));
              if (closed) return;
              if (
                objective.objectiveId !== requirement.objectiveId ||
                objective.version !== version ||
                validateSubject(
                  requirement.subject,
                  compileDomain(objective.manifest.subjectSchema),
                ) !== null ||
                levelRank(objective, requirement.currentLevelId) >=
                  levelRank(objective, requirement.expectedLevelId)
              )
                throw new ObjectivePortfolioError(
                  "Invalid dependency source, subject or level evidence.",
                );
              const sourceBindings = {
                ...(objective.source === undefined
                  ? {}
                  : { [objective.objectiveId]: objective.source }),
                ...existing?.sourceBindings,
              };
              for (const [id, source] of Object.entries(observation.sources ?? {})) {
                const prior = sourceBindings[id];
                if (
                  prior !== undefined &&
                  (prior.tree !== source.tree || prior.repositoryTree !== source.repositoryTree)
                )
                  throw new ObjectivePortfolioError(
                    `Conflicting dependency source binding for ${id}.`,
                  );
                sourceBindings[id] = prior ?? source;
              }
              const candidate: ObjectiveGoal = {
                ...(existing ?? {
                  id: `dependency:${canonicalJson([requirement.objectiveId, requirement.subject])}`,
                  objective,
                  subject: requirement.subject,
                  targetLevel: requirement.expectedLevelId,
                  priority: event.demand.priority,
                  observationIntervalMs: goal.observationIntervalMs,
                  ...(goal.requirements === undefined ? {} : { requirements: goal.requirements }),
                  ...(goal.language === undefined ? {} : { language: goal.language }),
                }),
                ...(Object.keys(sourceBindings).length === 0 ? {} : { sourceBindings }),
              };
              if (!existing && goals.has(candidate.id))
                throw new ObjectivePortfolioError(
                  "Generated dependency ID conflicts with a registered goal.",
                );
              additions.set(candidate.id, candidate);
              requirements.push({ provider: candidate.id, minimum: requirement.expectedLevelId });
            }
            const graph = new Map(waits);
            graph.set(goal.id, requirements);
            checkCycles(graph);
            for (const [id, candidate] of additions) {
              if (!goals.has(id)) {
                derived.set(id, candidate);
                goals.set(id, candidate);
                due.set(id, 0);
                revision(id);
              } else if (
                canonicalJson(goals.get(id)?.sourceBindings ?? null) !==
                canonicalJson(candidate.sourceBindings ?? null)
              ) {
                goals.set(id, candidate);
                if (roots.has(id)) roots.set(id, candidate);
                else derived.set(id, candidate);
                delete observations[id];
                due.set(id, 0);
                revision(id);
              }
            }
            waits.set(goal.id, requirements);
            observations[goal.id] = structuredClone(outcome.latestObservation);
            needsWork.add(goal.id);
            due.set(goal.id, Date.now() + goal.observationIntervalMs);
            await rebuild();
          } else {
            if (outcome.stopReason === "exhausted" && outcome.latestObservation.payload === null) {
              observations[goal.id] = structuredClone(outcome.latestObservation);
              due.set(goal.id, Date.now() + goal.observationIntervalMs);
            } else markObserved(goal, outcome.latestObservation);
            if (
              outcome.stopReason === "exhausted" ||
              outcome.stopReason === "authorization-required"
            )
              needsWork.add(goal.id);
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
