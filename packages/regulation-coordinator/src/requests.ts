import {
  levelRank,
  type NpmObjectiveSource,
  type ArtifactObjectiveSource,
  type PilotSpec,
  type ReferencePage,
  type Subject,
  validatePilotSource,
} from "@potential-guide/objective-pilot";
import { canonicalJson } from "./canonical-json.js";
import { identityKey as key } from "./identity.js";
import { fields, immutable, positive, priority, timestamp, validateSpec } from "./validation.js";

export interface Objective {
  readonly key: string;
  readonly source:
    | {
        readonly repository: string;
        readonly directory: string;
      }
    | { readonly packageName: string }
    | { readonly objectiveId: string };
}

export interface ObjectiveRevision {
  readonly key: string;
  readonly objectiveKey: string;
  readonly commit?: string;
  readonly packageDigest?: string;
  readonly artifactDigest?: string;
  readonly spec: PilotSpec;
}

export interface RegulationTarget {
  readonly key: string;
  readonly objectiveKey: string;
  readonly subject: Subject;
}

export type RequestOrigin =
  | { readonly kind: "external" }
  | { readonly kind: "dependency"; readonly consumerRequestRef: string }
  | { readonly kind: "recurrence"; readonly predecessorRequestRef: string };

export interface RequestSchedule {
  /** Omitted only by legacy requests, which retain their original admission semantics. */
  readonly eligibleAt?: string;
  readonly recurrence?: { readonly intervalMs: number };
  readonly replacesRequestRef?: string;
}

export interface RegulationRequest extends RequestSchedule {
  readonly ref: string;
  readonly targetKey: string;
  readonly objectiveRevisionKey: string;
  readonly desiredLevel: string;
  readonly priority: number;
  readonly origin: RequestOrigin;
  readonly source?: NpmObjectiveSource | ArtifactObjectiveSource;
}

export interface RegulationRequests {
  readonly schemaVersion: 1 | 2;
  readonly revision: number;
  readonly objectives: readonly Objective[];
  readonly objectiveRevisions: readonly ObjectiveRevision[];
  readonly targets: readonly RegulationTarget[];
  readonly requests: readonly RegulationRequest[];
}

export interface RequestCommand extends RequestSchedule {
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
function artifactLocales(locales: PilotSpec["locales"]): PilotSpec["locales"] {
  return Object.fromEntries(
    Object.entries(locales).map(([language, pages]) => [
      language,
      Object.fromEntries(
        Object.entries(pages).map(([id, page]) => {
          // Cache URLs are runtime capabilities, not immutable Objective content.
          const { resourceBase: _resourceBase, ...content } = page;
          return [id, content satisfies ReferencePage];
        }),
      ),
    ]),
  );
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
  fields(
    command,
    ["type", "requestRef", "objective", "subject", "desiredLevel", "priority", "origin"],
    ["eligibleAt", "recurrence", "replacesRequestRef"],
  );
  canonicalJson(command);
  if (command.type !== "request") throw new TypeError("Unsupported request command.");
  nonempty(command.requestRef, "requestRef");
  nonempty(command.desiredLevel, "desiredLevel");
  if (!priority(command.priority)) throw new TypeError("Invalid request priority.");
  if (command.eligibleAt !== undefined) timestamp(command.eligibleAt);
  if (command.recurrence !== undefined) {
    fields(command.recurrence, ["intervalMs"]);
    if (command.eligibleAt === undefined || !positive(command.recurrence.intervalMs))
      throw new TypeError("Recurrence requires eligibleAt and a positive bounded interval.");
  }
  if (command.replacesRequestRef !== undefined) {
    nonempty(command.replacesRequestRef, "replacesRequestRef");
    if (command.eligibleAt === undefined || command.origin.kind !== "external")
      throw new TypeError("Only timed external requests can explicitly replace a request.");
  }
  if (command.origin?.kind === "external") {
    fields(command.origin, ["kind"]);
  } else if (command.origin?.kind === "dependency") {
    fields(command.origin, ["kind", "consumerRequestRef"]);
    nonempty(command.origin.consumerRequestRef, "consumerRequestRef");
    const consumerRequestRef = command.origin.consumerRequestRef;
    if (!state.requests.some((request) => request.ref === consumerRequestRef))
      throw new TypeError("Dependency request must reference an existing consumer request.");
  } else if (command.origin?.kind === "recurrence") {
    fields(command.origin, ["kind", "predecessorRequestRef"]);
    nonempty(command.origin.predecessorRequestRef, "predecessorRequestRef");
    if (
      command.eligibleAt === undefined ||
      command.recurrence === undefined ||
      command.replacesRequestRef !== undefined
    )
      throw new TypeError("A recurrence successor requires its own fixed schedule.");
  } else {
    throw new TypeError("Unsupported request origin.");
  }
  validateSpec(command.objective, command.subject);
  const rank = levelRank(command.objective, command.desiredLevel);
  const desiredLevel = rank === 0 ? "initial" : command.objective.manifest.levels[rank - 1]?.id;
  if (desiredLevel === undefined) throw new TypeError("Invalid desired level.");
  if (desiredLevel === "initial" && command.recurrence !== undefined)
    throw new TypeError("An initial request cannot recur without an execution.");
  if (command.origin.kind === "dependency" && command.recurrence !== undefined)
    throw new TypeError("Derived dependency requests cannot create recurring obligations.");
  const source = command.objective.source;
  if (source === undefined) throw new TypeError("An exact Objective source is required.");
  const objectiveSource =
    source.kind === "objective-artifact"
      ? { objectiveId: source.objectiveId }
      : source.kind === "npm-package"
        ? { packageName: source.packageName }
        : { repository: source.repository, directory: source.directory };
  const objective: Objective = {
    key: key("objective", objectiveSource),
    source: objectiveSource,
  };
  const revision: ObjectiveRevision = {
    key: key("objective-revision", [
      objective.key,
      source.kind === "objective-artifact"
        ? source.artifactDigest
        : source.kind === "npm-package"
          ? source.packageDigest
          : source.commit,
    ]),
    objectiveKey: objective.key,
    ...(source.kind === "objective-artifact"
      ? { artifactDigest: source.artifactDigest }
      : source.kind === "npm-package"
        ? { packageDigest: source.packageDigest }
        : { commit: source.commit }),
    spec:
      source.kind !== "git-tree"
        ? {
            objectiveId: command.objective.objectiveId,
            version: command.objective.version,
            manifest: command.objective.manifest,
            locales:
              source.kind === "objective-artifact"
                ? artifactLocales(command.objective.locales)
                : command.objective.locales,
          }
        : command.objective,
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
    ...scheduleFields(command),
    ...(source.kind !== "git-tree" ? { source } : {}),
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
  if (request.origin.kind === "recurrence") {
    const predecessor = requestDetails(state, request.origin.predecessorRequestRef).request;
    if (
      predecessor.recurrence === undefined ||
      predecessor.targetKey !== request.targetKey ||
      predecessor.objectiveRevisionKey !== request.objectiveRevisionKey ||
      predecessor.desiredLevel !== request.desiredLevel ||
      predecessor.priority !== request.priority ||
      canonicalJson(predecessor.source ?? null) !== canonicalJson(request.source ?? null) ||
      canonicalJson(predecessor.recurrence) !== canonicalJson(request.recurrence) ||
      Date.parse(request.eligibleAt ?? "") <= Date.parse(predecessor.eligibleAt ?? "") ||
      state.requests.some(
        (entry) =>
          entry.origin.kind === "recurrence" &&
          entry.origin.predecessorRequestRef === predecessor.ref,
      )
    )
      throw new TypeError("Invalid or duplicate recurrence successor.");
  }
  if (
    request.replacesRequestRef !== undefined &&
    requestDetails(state, request.replacesRequestRef).request.targetKey !== request.targetKey
  )
    throw new TypeError("Replacement must identify the same Target.");
  if (
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    state.revision === Number.MAX_SAFE_INTEGER
  )
    throw new TypeError("Invalid or exhausted request projection revision.");
  return immutable(
    structuredClone({
      schemaVersion: source.kind === "objective-artifact" ? (2 as const) : state.schemaVersion,
      revision: state.revision + 1,
      objectives,
      objectiveRevisions,
      targets,
      requests: [...state.requests, request],
    }),
  );
}

function scheduleFields(value: RequestSchedule): RequestSchedule {
  return {
    ...(value.eligibleAt === undefined ? {} : { eligibleAt: value.eligibleAt }),
    ...(value.recurrence === undefined ? {} : { recurrence: value.recurrence }),
    ...(value.replacesRequestRef === undefined
      ? {}
      : { replacesRequestRef: value.replacesRequestRef }),
  };
}

export function recurrenceRoot(state: RegulationRequests, requestRef: string): string {
  let request = requestDetails(state, requestRef).request;
  while (request.origin.kind === "recurrence")
    request = requestDetails(state, request.origin.predecessorRequestRef).request;
  return request.ref;
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
  if (
    objectiveRevision.packageDigest !== undefined ||
    objectiveRevision.artifactDigest !== undefined
  ) {
    const digest = objectiveRevision.artifactDigest ?? objectiveRevision.packageDigest;
    if (digest === undefined) throw new TypeError("Missing exact Objective digest.");
    if (
      objectiveRevision.packageDigest !== undefined &&
      objectiveRevision.artifactDigest !== undefined
    )
      throw new TypeError("Revision cannot conflate package and artifact digests.");
    validatePilotSource(objectiveRevision.spec.objectiveId, digest, request.source);
    return immutable({
      request,
      target,
      objective,
      objectiveRevision: {
        ...objectiveRevision,
        spec: { ...objectiveRevision.spec, source: request.source },
      },
    });
  }
  if (request.source !== undefined)
    throw new TypeError("Legacy requests cannot carry npm package provenance.");
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
    ...scheduleFields(request),
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
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
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
    fields(
      request,
      ["ref", "targetKey", "objectiveRevisionKey", "desiredLevel", "priority", "origin"],
      ["source", "eligibleAt", "recurrence", "replacesRequestRef"],
    );
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
        objective:
          request.source === undefined
            ? revision.spec
            : { ...revision.spec, source: request.source },
        subject: target.subject,
        desiredLevel: request.desiredLevel,
        priority: request.priority,
        origin: request.origin,
        ...scheduleFields(request),
      },
      state,
    );
  }
  if (canonicalJson(value) !== canonicalJson(state))
    throw new TypeError("Request snapshot differs from its validated immutable facts.");
  return state;
}
