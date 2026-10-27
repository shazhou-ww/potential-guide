import type { PilotObservation } from "@potential-guide/objective-pilot";
import { canonicalJson } from "./canonical-json.js";
import { type RegulationRequest, requestDetails } from "./requests.js";
import {
  bindingForRun,
  type CoordinatorState,
  currentResources,
  dependencies,
  exhaustionEvents,
  requestCancelled,
  requestClosed,
  requestEmission,
  requestSchedule,
  resourceFacts,
  runViews,
} from "./state.js";
import { immutable, timestamp } from "./validation.js";

export interface HostContact {
  readonly hostId: string;
  readonly status: "online" | "offline" | "unknown";
  readonly lastContactAt: string | null;
  readonly lastReceivedAt: string | null;
}

export interface ObjectivePublication {
  readonly objectiveKey: string;
  readonly objectiveRevisionKey: string;
  readonly publishedAt: string;
}

/** Cross-Host facts retain provenance; no wall-clock ordering decides shared request completion. */
export function coordinatorViews(
  states: readonly CoordinatorState[],
  contacts: readonly HostContact[] = [],
  publications: readonly ObjectivePublication[] = [],
  now?: string,
) {
  if (now !== undefined) timestamp(now);
  if (new Set(states.map(({ hostId }) => hostId)).size !== states.length)
    throw new TypeError("Supply one consistent snapshot per Host.");
  if (new Set(contacts.map(({ hostId }) => hostId)).size !== contacts.length)
    throw new TypeError("Duplicate Host contact observation.");
  if (new Set(publications.map(({ objectiveKey }) => objectiveKey)).size !== publications.length)
    throw new TypeError("Supply one authoritative current publication per Objective.");
  for (const publication of publications) {
    const revision = states
      .flatMap((state) => state.requests.objectiveRevisions)
      .find(({ key }) => key === publication.objectiveRevisionKey);
    if (
      revision?.objectiveKey !== publication.objectiveKey ||
      !Number.isFinite(Date.parse(publication.publishedAt))
    )
      throw new TypeError("Publication references an unknown or inconsistent Objective revision.");
  }
  const catalogs = new Map<string, unknown>();
  for (const state of states) {
    for (const entry of [
      ...state.requests.objectives,
      ...state.requests.objectiveRevisions,
      ...state.requests.targets,
    ]) {
      const previous = catalogs.get(entry.key);
      if (previous !== undefined && canonicalJson(previous) !== canonicalJson(entry))
        throw new TypeError(`Conflicting shared entity ${entry.key}.`);
      catalogs.set(entry.key, entry);
    }
  }
  const requests = new Map<string, RegulationRequest>();
  for (const state of states) {
    for (const request of state.requests.requests) {
      const previous = requests.get(request.ref);
      if (previous !== undefined && canonicalJson(previous) !== canonicalJson(request))
        throw new TypeError(`Conflicting shared request ${request.ref}.`);
      requests.set(request.ref, request);
    }
  }
  const runs = states.flatMap((state) =>
    runViews(state).map((view) => ({
      ...view,
      hostId: state.hostId,
      request: requestDetails(state.requests, view.run.requestRef).request,
      appliedRevision: state.revision,
      timeline: state.events.filter(
        ({ fact }) =>
          (fact.type === "run-start" && fact.run.id === view.run.id) ||
          ("runId" in fact && fact.runId === view.run.id) ||
          (fact.type === "fault" && fact.fault.runId === view.run.id),
      ),
    })),
  );
  const hosts = states.map((state) => {
    const resource = currentResources(state);
    const localRuns = runs.filter(({ hostId }) => hostId === state.hostId);
    const activeRuns = localRuns.filter(({ phase }) => phase !== "ended");
    const contact = contacts.find(({ hostId }) => hostId === state.hostId);
    return {
      hostId: state.hostId,
      appliedRevision: state.revision,
      contact: contact ?? {
        hostId: state.hostId,
        status: "unknown" as const,
        lastContactAt: null,
        lastReceivedAt: null,
      },
      lastChangedAt: state.events.at(-1)?.occurredAt ?? null,
      resources: resource,
      resourceHistory: resourceFacts(state),
      occupancy: activeRuns.length,
      bindings:
        resource.allocation.kind === "configured"
          ? resource.allocation.bindings.map(({ binding, capacity }) => {
              const occupied = activeRuns.filter(
                ({ run }) => bindingForRun(state, run).id === binding.id,
              ).length;
              return { binding, capacity, occupied, available: Math.max(0, capacity - occupied) };
            })
          : [],
      runs: localRuns,
      exhaustionEvents: exhaustionEvents(state),
      faults: state.events.flatMap((event) =>
        event.fact.type === "fault"
          ? [{ revision: event.revision, occurredAt: event.occurredAt, ...event.fact.fault }]
          : [],
      ),
    };
  });
  const requestViews = [...requests.values()].map((request) => ({
    request,
    runs: runs.filter(({ run }) => run.requestRef === request.ref),
    localContributions: states
      .filter((state) => state.requests.requests.some(({ ref }) => ref === request.ref))
      .map((state) => ({
        hostId: state.hostId,
        closed: requestClosed(state, request.ref),
        cancelled: requestCancelled(state, request.ref),
        schedule:
          requestEmission(state, request.ref) !== undefined
            ? "emitted"
            : request.eligibleAt === undefined
              ? "eligible"
              : now === undefined
                ? "undetermined"
                : requestSchedule(state, request.ref, now),
        emittedAt: requestEmission(state, request.ref)?.occurredAt ?? null,
        successors: state.requests.requests
          .filter(
            (entry) =>
              entry.origin.kind === "recurrence" &&
              entry.origin.predecessorRequestRef === request.ref,
          )
          .map(({ ref }) => ref),
        dependencies: dependencies(state, request.ref),
      })),
    // Local execution evidence does not decide a distributed request's satisfaction.
    satisfaction: "undetermined" as const,
  }));
  const targets = new Map(
    states.flatMap((state) =>
      state.requests.targets.map((target) => [target.key, target] as const),
    ),
  );
  const probes = states.flatMap((state) =>
    state.events.flatMap((event) => {
      const fact = event.fact;
      if (fact.type !== "observation" && fact.type !== "probe-error") return [];
      let probedAt: string;
      let result:
        | { readonly kind: "observed"; readonly observation: PilotObservation }
        | { readonly kind: "error"; readonly message: string };
      if (fact.type === "observation") {
        const observation = fact.observation.payload;
        if (observation === null) throw new TypeError("Observation event has no valid payload.");
        probedAt = observation.observedAt;
        result = { kind: "observed", observation };
      } else {
        probedAt = fact.probedAt;
        result = { kind: "error", message: fact.message };
      }
      const run = runs.find((view) => view.hostId === state.hostId && view.run.id === fact.runId);
      if (run === undefined) throw new TypeError("Probe has no matching Run.");
      return [
        {
          hostId: state.hostId,
          targetKey: run.request.targetKey,
          requestRef: run.request.ref,
          runId: fact.runId,
          revision: event.revision,
          probedAt,
          result,
        },
      ];
    }),
  );
  const targetViews = [...targets.values()].map((target) => ({
    target,
    requests: requestViews.filter(({ request }) => request.targetKey === target.key),
    latestProbes: [
      ...new Map(
        probes
          .filter(({ targetKey }) => targetKey === target.key)
          .map((probe) => [probe.hostId, probe] as const),
      ).values(),
    ],
    observations: runs
      .filter(
        ({ request, observation }) => request.targetKey === target.key && observation !== null,
      )
      .map((view) => ({
        hostId: view.hostId,
        runId: view.run.id,
        requestRef: view.run.requestRef,
        objectiveRevisionKey: view.request.objectiveRevisionKey,
        observation: view.observation,
      })),
  }));
  const objectives = new Map(
    states.flatMap((state) =>
      state.requests.objectives.map((objective) => [objective.key, objective] as const),
    ),
  );
  return immutable(
    structuredClone({
      hosts,
      objectives: [...objectives.values()].map((objective) => ({
        objective,
        latestPublishedRevision:
          publications.find(({ objectiveKey }) => objectiveKey === objective.key) ?? null,
        revisions: [
          ...new Map(
            states.flatMap((state) =>
              state.requests.objectiveRevisions
                .filter(({ objectiveKey }) => objectiveKey === objective.key)
                .map((revision) => [revision.key, revision] as const),
            ),
          ).values(),
        ],
        targets: targetViews.filter(({ target }) => target.objectiveKey === objective.key),
      })),
      targets: targetViews,
      requests: requestViews,
      runs,
    }),
  );
}
