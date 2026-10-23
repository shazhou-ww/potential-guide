import type { PilotSpec, Subject } from "@potential-guide/objective-pilot";
import { canonicalJson, levelRank } from "@potential-guide/objective-portfolio-supervisor";
import { identityKey as key } from "./identity.js";
import { fields, immutable, priority, validateSpec } from "./validation.js";

export interface Objective {
  readonly key: string;
  readonly source: {
    readonly repository: string;
    readonly directory: string;
  };
}

export interface ObjectiveRevision {
  readonly key: string;
  readonly objectiveKey: string;
  readonly commit: string;
  readonly spec: PilotSpec;
}

export interface RegulationTarget {
  readonly key: string;
  readonly objectiveKey: string;
  readonly subject: Subject;
}

export type RequestOrigin =
  | { readonly kind: "external" }
  | { readonly kind: "dependency"; readonly consumerRequestRef: string };

export interface RegulationRequest {
  readonly ref: string;
  readonly targetKey: string;
  readonly objectiveRevisionKey: string;
  readonly desiredLevel: string;
  readonly priority: number;
  readonly origin: RequestOrigin;
}

export interface RegulationRequests {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly objectives: readonly Objective[];
  readonly objectiveRevisions: readonly ObjectiveRevision[];
  readonly targets: readonly RegulationTarget[];
  readonly requests: readonly RegulationRequest[];
}

export interface RequestCommand {
  readonly type: "request";
  readonly requestRef: string;
  readonly objective: PilotSpec;
  readonly subject: Subject;
  readonly desiredLevel: string;
  readonly priority: number;
  readonly origin: RequestOrigin;
}

function nonempty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new TypeError(`${label} must be a nonempty string.`);
}

function append<A extends { readonly key: string }>(records: readonly A[], value: A): readonly A[] {
  const existing = records.find((record) => record.key === value.key);
  if (existing === undefined) return [...records, value];
  if (canonicalJson(existing) !== canonicalJson(value))
    throw new TypeError(`Conflicting immutable record ${value.key}.`);
  return records;
}

export function createRegulationRequests(): RegulationRequests {
  return immutable({
    schemaVersion: 1,
    revision: 0,
    objectives: [],
    objectiveRevisions: [],
    targets: [],
    requests: [],
  });
}

/** The caller supplies a stable request reference; replay never allocates an identity. */
export function reduceRegulationRequests(
  command: RequestCommand,
  state: RegulationRequests,
): RegulationRequests {
  fields(command, [
    "type",
    "requestRef",
    "objective",
    "subject",
    "desiredLevel",
    "priority",
    "origin",
  ]);
  canonicalJson(command);
  if (command.type !== "request") throw new TypeError("Unsupported request command.");
  nonempty(command.requestRef, "requestRef");
  nonempty(command.desiredLevel, "desiredLevel");
  if (!priority(command.priority)) throw new TypeError("Invalid request priority.");
  if (command.origin?.kind === "external") {
    fields(command.origin, ["kind"]);
  } else if (command.origin?.kind === "dependency") {
    fields(command.origin, ["kind", "consumerRequestRef"]);
    nonempty(command.origin.consumerRequestRef, "consumerRequestRef");
    const consumerRequestRef = command.origin.consumerRequestRef;
    if (!state.requests.some((request) => request.ref === consumerRequestRef))
      throw new TypeError("Dependency request must reference an existing consumer request.");
  } else {
    throw new TypeError("Unsupported request origin.");
  }
  validateSpec(command.objective, command.subject);
  const rank = levelRank(command.objective, command.desiredLevel);
  const desiredLevel = rank === 0 ? "initial" : command.objective.manifest.levels[rank - 1]?.id;
  if (desiredLevel === undefined) throw new TypeError("Invalid desired level.");
  const source = command.objective.source;
  if (source?.kind !== "git-tree") throw new TypeError("An exact Git source is required.");
  const objectiveSource = { repository: source.repository, directory: source.directory };
  const objective: Objective = {
    key: key("objective", objectiveSource),
    source: objectiveSource,
  };
  const revision: ObjectiveRevision = {
    key: key("objective-revision", [objective.key, source.commit]),
    objectiveKey: objective.key,
    commit: source.commit,
    spec: command.objective,
  };
  const target: RegulationTarget = {
    key: key("target", [objective.key, command.subject]),
    objectiveKey: objective.key,
    subject: command.subject,
  };
  const request: RegulationRequest = {
    ref: command.requestRef,
    targetKey: target.key,
    objectiveRevisionKey: revision.key,
    desiredLevel,
    priority: command.priority,
    origin: command.origin,
  };
  const objectives = append(state.objectives, objective);
  const objectiveRevisions = append(state.objectiveRevisions, revision);
  const targets = append(state.targets, target);
  const previous = state.requests.find((entry) => entry.ref === request.ref);
  if (previous !== undefined) {
    if (canonicalJson(previous) !== canonicalJson(request))
      throw new TypeError(`Conflicting immutable request ${request.ref}.`);
    return state;
  }
  if (
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    state.revision === Number.MAX_SAFE_INTEGER
  )
    throw new TypeError("Invalid or exhausted request projection revision.");
  return immutable(
    structuredClone({
      schemaVersion: 1 as const,
      revision: state.revision + 1,
      objectives,
      objectiveRevisions,
      targets,
      requests: [...state.requests, request],
    }),
  );
}

export interface RequestDetails {
  readonly request: RegulationRequest;
  readonly target: RegulationTarget;
  readonly objective: Objective;
  readonly objectiveRevision: ObjectiveRevision;
}

export function requestDetails(state: RegulationRequests, requestRef: string): RequestDetails {
  const request = state.requests.find((entry) => entry.ref === requestRef);
  if (request === undefined) throw new TypeError(`Unknown request ${requestRef}.`);
  const target = state.targets.find((entry) => entry.key === request.targetKey);
  const objectiveRevision = state.objectiveRevisions.find(
    (entry) => entry.key === request.objectiveRevisionKey,
  );
  const objective = state.objectives.find((entry) => entry.key === target?.objectiveKey);
  if (
    target === undefined ||
    objectiveRevision === undefined ||
    objective === undefined ||
    objectiveRevision.objectiveKey !== objective.key
  )
    throw new TypeError(`Broken request references for ${requestRef}.`);
  return { request, target, objective, objectiveRevision };
}

export function commandForRequest(state: RegulationRequests, requestRef: string): RequestCommand {
  const { request, target, objectiveRevision } = requestDetails(state, requestRef);
  return {
    type: "request",
    requestRef,
    objective: objectiveRevision.spec,
    subject: target.subject,
    desiredLevel: request.desiredLevel,
    priority: request.priority,
    origin: request.origin,
  };
}

/** Restore by rebuilding admitted facts, not by trusting serialized keys or projections. */
export function restoreRegulationRequests(value: unknown): RegulationRequests {
  fields(value, [
    "schemaVersion",
    "revision",
    "objectives",
    "objectiveRevisions",
    "targets",
    "requests",
  ]);
  canonicalJson(value);
  if (
    value === null ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("requests" in value) ||
    !Array.isArray(value.requests) ||
    !("targets" in value) ||
    !Array.isArray(value.targets) ||
    !("objectiveRevisions" in value) ||
    !Array.isArray(value.objectiveRevisions)
  )
    throw new TypeError("Invalid request snapshot.");
  let state = createRegulationRequests();
  for (const request of value.requests) {
    fields(request, [
      "ref",
      "targetKey",
      "objectiveRevisionKey",
      "desiredLevel",
      "priority",
      "origin",
    ]);
    const target = value.targets.find(
      (entry) => entry !== null && typeof entry === "object" && entry.key === request.targetKey,
    );
    const revision = value.objectiveRevisions.find(
      (entry) =>
        entry !== null && typeof entry === "object" && entry.key === request.objectiveRevisionKey,
    );
    if (target === undefined || revision === undefined)
      throw new TypeError("Request snapshot contains missing references.");
    state = reduceRegulationRequests(
      {
        type: "request",
        requestRef: request.ref,
        objective: revision.spec,
        subject: target.subject,
        desiredLevel: request.desiredLevel,
        priority: request.priority,
        origin: request.origin,
      },
      state,
    );
  }
  if (canonicalJson(value) !== canonicalJson(state))
    throw new TypeError("Request snapshot differs from its validated immutable facts.");
  return state;
}
