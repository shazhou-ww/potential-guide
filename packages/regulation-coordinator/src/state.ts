import type { Envelope, PilotObservation } from "@potential-guide/objective-pilot";
import { canonicalJson, levelRank } from "@potential-guide/objective-portfolio-supervisor";
import type { AgentBinding } from "@potential-guide/objective-regulator";
import { identityKey } from "./identity.js";
import {
  createRegulationRequests,
  type RegulationRequests,
  type RequestCommand,
  reduceRegulationRequests,
  requestDetails,
} from "./requests.js";
import { fields, immutable, positive, validateObservation } from "./validation.js";

export type ResourceAllocation =
  | { readonly kind: "no-resource" }
  | {
      readonly kind: "configured";
      readonly bindings: readonly {
        readonly binding: AgentBinding;
        readonly capacity: number;
      }[];
    };

export interface ExecutionLimits {
  readonly timeoutMs: number;
  readonly maxAgentRuns: number;
  readonly maxStallRuns: number;
}

export interface Run {
  readonly id: string;
  readonly requestRef: string;
  readonly resourceRevision: number;
  readonly hostBindingRevisionId: string;
  readonly limits: ExecutionLimits;
}

export type RunPhase = "starting" | "running" | "stopping" | "unverified" | "ended";
export type RunOutcome =
  | { readonly kind: "target-reached" }
  | { readonly kind: "blocked" | "exhausted" | "cancelled" | "error"; readonly message: string };

export interface Fault {
  readonly kind: string;
  readonly message: string;
  readonly targetKey: string | null;
  readonly requestRef: string | null;
  readonly runId: string | null;
}

export type CoordinatorFact =
  | { readonly type: "request"; readonly command: RequestCommand }
  | { readonly type: "resources"; readonly allocation: ResourceAllocation }
  | { readonly type: "run-start"; readonly run: Run }
  | {
      readonly type: "run-phase";
      readonly runId: string;
      readonly phase: Exclude<RunPhase, "starting" | "ended">;
    }
  | {
      readonly type: "observation";
      readonly runId: string;
      readonly observation: Envelope<PilotObservation>;
    }
  | {
      readonly type: "probe-error";
      readonly runId: string;
      readonly probedAt: string;
      readonly message: string;
    }
  | { readonly type: "run-end"; readonly runId: string; readonly outcome: RunOutcome }
  | {
      readonly type: "request-close";
      readonly requestRef: string;
      readonly reason: "initial" | "superseded" | "finished";
    }
  | {
      readonly type: "dependency";
      readonly consumerRequestRef: string;
      readonly providerRequestRef: string;
    }
  | { readonly type: "fault"; readonly fault: Fault };

export interface CoordinatorEvent {
  readonly revision: number;
  readonly occurredAt: string;
  readonly fact: CoordinatorFact;
}

export interface RunView {
  readonly run: Run;
  readonly phase: RunPhase;
  readonly outcome: RunOutcome | null;
  readonly observation: PilotObservation | null;
  readonly lastProbeFailed: boolean;
  readonly updatedAt: string;
}

export interface CoordinatorState {
  readonly schemaVersion: 1;
  readonly hostId: string;
  readonly revision: number;
  readonly requests: RegulationRequests;
  readonly events: readonly CoordinatorEvent[];
}

function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Expected nonempty text.");
}

export function createCoordinatorState(hostId: string): CoordinatorState {
  text(hostId);
  return immutable({
    schemaVersion: 1,
    hostId,
    revision: 0,
    requests: createRegulationRequests(),
    events: [],
  });
}

export function runViews(state: CoordinatorState): readonly RunView[] {
  const views = new Map<string, RunView>();
  for (const event of state.events) {
    const fact = event.fact;
    if (fact.type === "run-start") {
      views.set(fact.run.id, {
        run: fact.run,
        phase: "starting",
        outcome: null,
        observation: null,
        lastProbeFailed: false,
        updatedAt: event.occurredAt,
      });
    } else if (
      fact.type === "run-phase" ||
      fact.type === "run-end" ||
      fact.type === "observation" ||
      fact.type === "probe-error"
    ) {
      const view = views.get(fact.runId);
      if (view === undefined) throw new TypeError("Run event has no immutable start fact.");
      views.set(fact.runId, {
        ...view,
        ...(fact.type === "run-phase" ? { phase: fact.phase } : {}),
        ...(fact.type === "run-end" ? { phase: "ended" as const, outcome: fact.outcome } : {}),
        ...(fact.type === "observation" ? { observation: fact.observation.payload } : {}),
        ...(fact.type === "observation" ? { lastProbeFailed: false } : {}),
        ...(fact.type === "probe-error" ? { lastProbeFailed: true } : {}),
        updatedAt: event.occurredAt,
      });
    }
  }
  return immutable([...views.values()]);
}

export function currentResources(state: CoordinatorState): {
  readonly revision: number;
  readonly allocation: ResourceAllocation;
} {
  for (let index = state.events.length - 1; index >= 0; index--) {
    const event = state.events[index];
    if (event?.fact.type === "resources")
      return { revision: event.revision, allocation: event.fact.allocation };
  }
  return { revision: 0, allocation: { kind: "no-resource" } };
}

export function requestClosed(state: CoordinatorState, requestRef: string): boolean {
  return state.events.some(
    ({ fact }) => fact.type === "request-close" && fact.requestRef === requestRef,
  );
}

export function dependencies(
  state: CoordinatorState,
  consumerRequestRef: string,
): readonly string[] {
  return state.events.flatMap(({ fact }) =>
    fact.type === "dependency" && fact.consumerRequestRef === consumerRequestRef
      ? [fact.providerRequestRef]
      : [],
  );
}

function allocationValid(value: ResourceAllocation): void {
  if (value.kind === "no-resource") {
    fields(value, ["kind"]);
    return;
  }
  fields(value, ["kind", "bindings"]);
  if (value.kind !== "configured" || !Array.isArray(value.bindings))
    throw new TypeError("Invalid resource allocation.");
  const ids = new Set<string>();
  for (const entry of value.bindings) {
    fields(entry, ["binding", "capacity"]);
    fields(entry.binding, ["id"], ["configuration"]);
    text(entry.binding.id);
    if (!Number.isSafeInteger(entry.capacity) || entry.capacity < 0)
      throw new TypeError("Capacity must be a nonnegative safe integer.");
    if (ids.has(entry.binding.id)) throw new TypeError("Duplicate binding in resource allocation.");
    ids.add(entry.binding.id);
    if (
      entry.binding.configuration !== undefined &&
      (entry.binding.configuration === null ||
        typeof entry.binding.configuration !== "object" ||
        Array.isArray(entry.binding.configuration))
    )
      throw new TypeError("Binding configuration must be a JSON object.");
  }
}

export function reduceCoordinatorState(
  event: CoordinatorEvent,
  state: CoordinatorState,
): CoordinatorState {
  fields(event, ["revision", "occurredAt", "fact"]);
  canonicalJson(event);
  if (
    !Number.isSafeInteger(event.revision) ||
    event.revision !== state.revision + 1 ||
    !Number.isSafeInteger(state.revision + 1)
  )
    throw new TypeError("Coordinator events must form a contiguous revision prefix.");
  if (
    typeof event.occurredAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(event.occurredAt) ||
    !Number.isFinite(Date.parse(event.occurredAt))
  )
    throw new TypeError("Invalid event occurrence time.");
  const fact = event.fact;
  let requests = state.requests;
  switch (fact.type) {
    case "request":
      fields(fact, ["type", "command"]);
      requests = reduceRegulationRequests(fact.command, requests);
      if (requests === state.requests) throw new TypeError("Request was already admitted.");
      break;
    case "resources":
      fields(fact, ["type", "allocation"]);
      allocationValid(fact.allocation);
      break;
    case "run-start": {
      fields(fact, ["type", "run"]);
      fields(fact.run, ["id", "requestRef", "resourceRevision", "hostBindingRevisionId", "limits"]);
      fields(fact.run.limits, ["timeoutMs", "maxAgentRuns", "maxStallRuns"]);
      text(fact.run.id);
      if (!Object.values(fact.run.limits).every(positive))
        throw new TypeError("Invalid run limits.");
      const details = requestDetails(requests, fact.run.requestRef);
      if (details.request.desiredLevel === "initial" || requestClosed(state, fact.run.requestRef))
        throw new TypeError("Cannot start an initial or closed request.");
      const runs = runViews(state);
      if (
        runs.some(({ run }) => run.id === fact.run.id) ||
        runs.some(({ run, phase }) => run.requestRef === fact.run.requestRef && phase !== "ended")
      )
        throw new TypeError("Duplicate Run or overlapping local execution of a request.");
      const resources = currentResources(state);
      const binding =
        resources.allocation.kind === "configured"
          ? resources.allocation.bindings.find(
              (entry) =>
                bindingRevisionId(state.hostId, entry.binding) === fact.run.hostBindingRevisionId,
            )
          : undefined;
      if (
        resources.revision !== fact.run.resourceRevision ||
        binding === undefined ||
        runs.filter(
          ({ phase, run }) =>
            phase !== "ended" && bindingForRun(state, run).id === binding.binding.id,
        ).length >= binding.capacity
      )
        throw new TypeError("Run does not have current available resource capacity.");
      break;
    }
    case "run-phase":
    case "run-end":
    case "probe-error":
    case "observation": {
      const view = runViews(state).find(({ run }) => run.id === fact.runId);
      if (view === undefined || view.phase === "ended")
        throw new TypeError("Run feedback must belong to an active run.");
      if (fact.type === "run-phase") {
        fields(fact, ["type", "runId", "phase"]);
        if (
          !["running", "stopping", "unverified"].includes(fact.phase) ||
          (view.phase === "stopping" && fact.phase === "running") ||
          view.phase === fact.phase
        )
          throw new TypeError("Invalid execution phase transition.");
      } else if (fact.type === "probe-error") {
        fields(fact, ["type", "runId", "probedAt", "message"]);
        text(fact.message);
        if (
          view.phase !== "running" ||
          typeof fact.probedAt !== "string" ||
          !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(fact.probedAt) ||
          !Number.isFinite(Date.parse(fact.probedAt))
        )
          throw new TypeError("Invalid Probe failure or inactive source run.");
      } else if (fact.type === "observation") {
        fields(fact, ["type", "runId", "observation"]);
        if (view.phase !== "running")
          throw new TypeError("Unverified or stopping runs cannot publish observations.");
        const details = requestDetails(requests, view.run.requestRef);
        const observation = validateObservation(
          {
            id: view.run.id,
            objective: details.objectiveRevision.spec,
            subject: details.target.subject,
            targetLevel: details.request.desiredLevel,
            priority: details.request.priority,
          },
          fact.observation,
        );
        if (
          view.observation !== null &&
          Date.parse(observation.observedAt) < Date.parse(view.observation.observedAt)
        )
          throw new TypeError("Observation is older than the current run evidence.");
      } else {
        fields(fact, ["type", "runId", "outcome"]);
        if (fact.outcome.kind === "target-reached") {
          fields(fact.outcome, ["kind"]);
          const details = requestDetails(requests, view.run.requestRef);
          if (
            view.observation === null ||
            view.lastProbeFailed ||
            levelRank(details.objectiveRevision.spec, view.observation.current.levelId) <
              levelRank(details.objectiveRevision.spec, details.request.desiredLevel)
          )
            throw new TypeError("Reached outcome requires valid evidence for the pinned request.");
        } else {
          fields(fact.outcome, ["kind", "message"]);
          if (!["blocked", "exhausted", "cancelled", "error"].includes(fact.outcome.kind))
            throw new TypeError("Invalid run outcome.");
          text(fact.outcome.message);
        }
      }
      break;
    }
    case "request-close": {
      fields(fact, ["type", "requestRef", "reason"]);
      const request = requestDetails(requests, fact.requestRef).request;
      if (
        requestClosed(state, fact.requestRef) ||
        !["initial", "superseded", "finished"].includes(fact.reason) ||
        (fact.reason === "initial" && request.desiredLevel !== "initial") ||
        (fact.reason === "finished" &&
          !runViews(state).some(
            ({ run, phase }) => run.requestRef === fact.requestRef && phase === "ended",
          ))
      )
        throw new TypeError("Invalid local request closure.");
      break;
    }
    case "dependency": {
      fields(fact, ["type", "consumerRequestRef", "providerRequestRef"]);
      const consumer = requestDetails(requests, fact.consumerRequestRef).target;
      requestDetails(requests, fact.providerRequestRef);
      const visited = new Set<string>();
      const reaches = (reference: string): boolean => {
        if (requestDetails(requests, reference).target.key === consumer.key) return true;
        if (visited.has(reference)) return false;
        visited.add(reference);
        return dependencies(state, reference).some(reaches);
      };
      if (
        requestClosed(state, fact.consumerRequestRef) ||
        reaches(fact.providerRequestRef) ||
        dependencies(state, fact.consumerRequestRef).includes(fact.providerRequestRef)
      )
        throw new TypeError("Cyclic, duplicate or obsolete dependency.");
      break;
    }
    case "fault":
      fields(fact, ["type", "fault"]);
      fields(fact.fault, ["kind", "message", "targetKey", "requestRef", "runId"]);
      text(fact.fault.kind);
      text(fact.fault.message);
      if (
        fact.fault.targetKey !== null &&
        !requests.targets.some(({ key }) => key === fact.fault.targetKey)
      )
        throw new TypeError("Fault references an unknown Target.");
      if (
        fact.fault.requestRef !== null &&
        requestDetails(requests, fact.fault.requestRef).target.key !== fact.fault.targetKey
      )
        throw new TypeError("Fault references an inconsistent Request/Target chain.");
      if (fact.fault.runId !== null) {
        const run = runViews(state).find(({ run }) => run.id === fact.fault.runId)?.run;
        if (run === undefined || run.requestRef !== fact.fault.requestRef)
          throw new TypeError("Fault references an inconsistent Run/Request chain.");
      }
      break;
    default:
      throw new TypeError("Unsupported Coordinator event.");
  }
  return immutable(
    structuredClone({
      ...state,
      revision: event.revision,
      requests,
      events: [...state.events, event],
    }),
  );
}

export function restoreCoordinatorState(value: unknown): CoordinatorState {
  fields(value, ["schemaVersion", "hostId", "revision", "requests", "events"]);
  canonicalJson(value);
  if (
    value === null ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("hostId" in value) ||
    typeof value.hostId !== "string" ||
    !("events" in value) ||
    !Array.isArray(value.events)
  )
    throw new TypeError("Unsupported Coordinator snapshot.");
  const rebuilt = value.events.reduce(
    (state, event) => reduceCoordinatorState(event, state),
    createCoordinatorState(value.hostId),
  );
  if (canonicalJson(rebuilt) !== canonicalJson(value))
    throw new TypeError("Coordinator snapshot differs from its event prefix.");
  return rebuilt;
}

export function bindingForRun(state: CoordinatorState, run: Run): AgentBinding {
  const event = state.events.find((entry) => entry.revision === run.resourceRevision);
  if (event?.fact.type !== "resources" || event.fact.allocation.kind !== "configured")
    throw new TypeError("Missing pinned resource configuration.");
  const binding = event.fact.allocation.bindings.find(
    ({ binding }) => bindingRevisionId(state.hostId, binding) === run.hostBindingRevisionId,
  );
  if (binding === undefined) throw new TypeError("Missing pinned binding.");
  return binding.binding;
}

export function bindingRevisionId(hostId: string, binding: AgentBinding): string {
  return identityKey("host-binding", [hostId, binding]);
}

export function resourceFacts(state: CoordinatorState) {
  const bindings = new Map<
    string,
    { readonly id: string; readonly hostId: string; readonly binding: AgentBinding }
  >();
  const revisions = state.events.flatMap(({ revision, fact }) => {
    if (fact.type !== "resources") return [];
    const members = fact.allocation.kind === "configured" ? fact.allocation.bindings : [];
    return [
      {
        id: `${state.hostId}:${revision}`,
        hostId: state.hostId,
        appliedAtRevision: revision,
        members: members.map(({ binding, capacity }) => {
          const id = bindingRevisionId(state.hostId, binding);
          bindings.set(id, { id, hostId: state.hostId, binding });
          return { hostBindingRevisionId: id, capacity };
        }),
      },
    ];
  });
  return immutable({ bindings: [...bindings.values()], revisions });
}
