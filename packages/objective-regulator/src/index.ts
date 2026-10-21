import {
  createLatestSlot,
  Effect,
  type EffectSample,
  SubscriptionRef,
  watchSnapshot,
} from "@potential-guide/effects";
import {
  attainedLevelRank,
  canonicalObjectiveUri,
  type DependencyProblem,
  type Envelope,
  type GitObjectiveSource,
  isJsonValue,
  levelRank,
  type JsonObject,
  type LevelRef,
  ObjectiveConfigurationError,
  observe,
  type PilotInput,
  type PilotObservation,
  type PilotRuntime,
  type PilotSpec,
  parseCheckEnvelope,
  parseManifest,
  type Subject,
  SubjectProjectionError,
  validateGitPilotSource,
} from "@potential-guide/objective-pilot";

export type PermissionGrant =
  | {
      readonly id: string;
      readonly operation: "read" | "edit";
      readonly resources: readonly string[];
    }
  | { readonly id: string; readonly operation: "execute"; readonly command: string };
export interface RegulationPermissions {
  readonly ceiling: readonly PermissionGrant[];
  readonly grants: readonly string[];
}
export interface AuthorizationRequest {
  readonly id: string;
  readonly operation: string;
  readonly resources: readonly string[];
  readonly reason: string;
  readonly command?: string;
}
export interface AgentExecutionLimits {
  readonly timeoutMs: number;
}
export interface RegulationQuota {
  readonly timeoutMs: number;
  readonly maxAgentRuns: number;
  readonly maxStallRuns: number;
}
export interface RegulationStrategy {
  readonly targetLevel: string;
  readonly agentExecutionLimits: AgentExecutionLimits;
  readonly quota: RegulationQuota;
  readonly probe?: {
    readonly timeoutMs: number;
    readonly retry: { readonly maxRetries: number; readonly delayMs: number };
  };
}
export interface AgentBinding {
  readonly id: string;
  readonly configuration?: JsonObject;
}
export interface RegulatorSpec {
  readonly objective: PilotSpec;
  readonly strategy: RegulationStrategy;
  readonly binding: AgentBinding;
}
export interface RegulationInput {
  readonly spec: RegulatorSpec;
  readonly subject: Subject;
  readonly language?: string;
  readonly history?: { readonly stalledRuns: number };
  readonly permissions?: RegulationPermissions;
  readonly sourceBindings?: Readonly<Record<string, GitObjectiveSource>>;
}
export interface AgentInput {
  readonly binding: AgentBinding;
  readonly subject: Subject;
  readonly target: LevelRef;
  readonly observation: PilotObservation;
  readonly limits: AgentExecutionLimits;
  readonly permissions: RegulationPermissions;
}
export type AgentOutcome =
  | {
      readonly status: "completed";
      readonly summary: string;
      readonly authorizationRequests?: readonly AuthorizationRequest[];
    }
  | {
      readonly status: "authorization-required";
      readonly reason: string;
      readonly authorizationRequests: readonly AuthorizationRequest[];
    }
  | { readonly status: "blocked" | "failed" | "limit-reached"; readonly reason: string };
export type StopReason =
  | "target-reached"
  | "exhausted"
  | "dependency-required"
  | "authorization-required";
export interface RegulationOutcomeBase {
  readonly iterations: number;
  readonly latestObservation: Envelope<PilotObservation>;
  readonly stalledRuns: number;
  readonly exhaustedBy?: "time" | "agent-runs" | "stall" | "agent-limit";
  readonly agentOutcome?: AgentOutcome;
  readonly authorizationRequests?: readonly AuthorizationRequest[];
}
export type RegulationOutcome = RegulationOutcomeBase &
  (
    | {
        readonly stopReason: "dependency-required";
        readonly dependencies: readonly [DependencyProblem, ...DependencyProblem[]];
      }
    | { readonly stopReason: Exclude<StopReason, "dependency-required"> }
  );
export interface RegulationRuntime {
  readonly pilot: PilotRuntime;
  readonly executeAgent: (input: AgentInput, signal: AbortSignal) => Promise<AgentOutcome>;
  readonly onObservation?: (observation: Envelope<PilotObservation>) => void;
}
export class RegulationError extends Error {
  readonly status: number;
  readonly envelope?: Envelope<PilotObservation>;

  constructor(
    message: string,
    status: number,
    options?: ErrorOptions & { readonly envelope?: Envelope<PilotObservation> },
  );
  constructor(
    status: number,
    message: string,
    options?: ErrorOptions & { readonly envelope?: Envelope<PilotObservation> },
  );
  constructor(
    first: number | string,
    second: string | number,
    options?: ErrorOptions & { readonly envelope?: Envelope<PilotObservation> },
  ) {
    super(typeof first === "string" ? first : String(second), options);
    this.name = "RegulationError";
    this.status = typeof first === "number" ? first : Number(second);
    if (options?.envelope !== undefined) this.envelope = options.envelope;
  }
}

const maximumTimer = 2_147_483_647;
const duration = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximumTimer;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
  if (
    !record(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new RegulationError(400, `Expected fields: ${[...required, ...optional].join(", ")}.`);
}

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

/** Grants select administrator rules; no caller-supplied grant can expand the ceiling. */
export function makeRegulationPermissions(value: unknown): RegulationPermissions {
  if (value === undefined) return immutable({ ceiling: [], grants: [] });
  if (!isJsonValue(value))
    throw new RegulationError(400, "Permissions must contain finite JSON data.");
  fields(value, ["ceiling", "grants"]);
  if (!Array.isArray(value.ceiling) || !Array.isArray(value.grants))
    throw new RegulationError(400, "Permissions require ceiling and grant arrays.");
  const ids = new Set<string>();
  for (const rule of value.ceiling) {
    if (!record(rule)) throw new RegulationError(400, "Invalid permission ceiling rule.");
    if (rule.operation === "execute") {
      fields(rule, ["id", "operation", "command"]);
      if (!text(rule.command) || rule.command.includes("\0"))
        throw new RegulationError(400, "Execute permissions require an exact command.");
    } else if (rule.operation === "read" || rule.operation === "edit") {
      fields(rule, ["id", "operation", "resources"]);
      if (
        !Array.isArray(rule.resources) ||
        rule.resources.length === 0 ||
        !rule.resources.every(
          (path) =>
            text(path) &&
            !/[*?\0]/.test(path) &&
            (path.startsWith("/") ||
              /^[a-z]:[\\/]/i.test(path) ||
              /^\\\\[^\\]+\\[^\\]+/.test(path)),
        )
      )
        throw new RegulationError(400, "Filesystem permissions require exact absolute paths.");
    } else throw new RegulationError(400, "Unknown permission operation.");
    if (!text(rule.id) || ids.has(rule.id))
      throw new RegulationError(400, "Permission ceiling IDs must be unique nonempty strings.");
    ids.add(rule.id);
  }
  const selected = new Set<string>();
  for (const id of value.grants) {
    if (!text(id) || !ids.has(id) || selected.has(id))
      throw new RegulationError(400, "Grants must uniquely select existing ceiling IDs.");
    selected.add(id);
  }
  return immutable(structuredClone(value)) as unknown as RegulationPermissions;
}

function inputError(cause: unknown): RegulationError {
  return cause instanceof RegulationError
    ? cause
    : new RegulationError(400, cause instanceof Error ? cause.message : String(cause), { cause });
}

function executionError(cause: unknown): RegulationError {
  if (cause instanceof RegulationError) return cause;
  if (cause instanceof ObjectiveConfigurationError || cause instanceof SubjectProjectionError)
    return inputError(cause);
  return new RegulationError(500, cause instanceof Error ? cause.message : String(cause), {
    cause,
  });
}

function validatePilot(value: unknown): asserts value is PilotSpec {
  fields(value, ["objectiveId", "version", "manifest", "locales"], ["source"]);
  if (
    !text(value.objectiveId) ||
    !value.objectiveId.startsWith("git+") ||
    canonicalObjectiveUri(value.objectiveId) !== value.objectiveId ||
    typeof value.version !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.version)
  )
    throw new RegulationError(
      400,
      "Pilot requires unique stable Git identities and exact versions.",
    );
  const manifest = parseManifest(JSON.stringify(value.manifest));
  if (value.source !== undefined)
    validateGitPilotSource(value.objectiveId, value.version, value.source);
  if (!record(value.locales))
    throw new RegulationError(400, "Pilot locales must be reference page maps.");
  for (const language of manifest.languages) {
    const pages = value.locales[language];
    if (!record(pages) || !Object.hasOwn(pages, "system/404"))
      throw new RegulationError(400, `Missing reference pages for ${language}.`);
    for (const page of Object.values(pages)) {
      fields(page, ["id", "title", "description", "references", "content"]);
      if (
        !text(page.id) ||
        typeof page.title !== "string" ||
        typeof page.description !== "string" ||
        typeof page.content !== "string" ||
        !Array.isArray(page.references) ||
        !page.references.every(text)
      )
        throw new RegulationError(400, "Invalid Pilot reference page.");
    }
  }
}

function validateSpec(value: unknown): asserts value is RegulatorSpec {
  if (!isJsonValue(value))
    throw new RegulationError(400, "Regulator specifications must contain only finite JSON data.");
  fields(value, ["objective", "strategy", "binding"]);
  validatePilot(value.objective);
  const strategy = value.strategy;
  fields(strategy, ["targetLevel", "agentExecutionLimits", "quota"], ["probe"]);
  fields(strategy.agentExecutionLimits, ["timeoutMs"]);
  if (!duration(strategy.agentExecutionLimits.timeoutMs))
    throw new RegulationError(400, "Agent timeoutMs must be a positive safe timer duration.");
  fields(strategy.quota, ["timeoutMs", "maxAgentRuns", "maxStallRuns"]);
  if (
    !duration(strategy.quota.timeoutMs) ||
    !count(strategy.quota.maxAgentRuns) ||
    !count(strategy.quota.maxStallRuns)
  )
    throw new RegulationError(
      400,
      "Quota requires a positive safe timer and positive safe counts.",
    );
  if (
    strategy.targetLevel !== "initial" &&
    strategy.targetLevel !== "terminal" &&
    !value.objective.manifest.levels.some(({ id }) => id === strategy.targetLevel)
  )
    throw new RegulationError(400, "Target level must belong to the root Pilot Objective.");
  fields(value.binding, ["id"], ["configuration"]);
  if (
    !text(value.binding.id) ||
    (value.binding.configuration !== undefined && !record(value.binding.configuration))
  )
    throw new RegulationError(
      400,
      "Agent binding requires a nonempty ID and object configuration.",
    );
  if (strategy.probe !== undefined) {
    fields(strategy.probe, ["timeoutMs", "retry"]);
    fields(strategy.probe.retry, ["maxRetries", "delayMs"]);
    if (
      !duration(strategy.probe.timeoutMs) ||
      !Number.isSafeInteger(strategy.probe.retry.maxRetries) ||
      Number(strategy.probe.retry.maxRetries) < 0 ||
      !Number.isSafeInteger(strategy.probe.retry.delayMs) ||
      Number(strategy.probe.retry.delayMs) < 0 ||
      Number(strategy.probe.retry.delayMs) > maximumTimer
    )
      throw new RegulationError(400, "Invalid probe timeout or retry policy.");
  }
}

export function makeRegulatorSpec(
  objective: PilotSpec,
  strategy: RegulationStrategy,
  binding: AgentBinding,
): RegulatorSpec {
  try {
    const value = { objective, strategy, binding };
    validateSpec(value);
    return immutable(structuredClone(value));
  } catch (cause) {
    throw inputError(cause);
  }
}

function snapshotInput(value: RegulationInput): RegulationInput {
  try {
    if (!isJsonValue(value)) throw new RegulationError(400, "Input must contain finite JSON data.");
    fields(value, ["spec", "subject"], ["language", "history", "permissions", "sourceBindings"]);
    validateSpec(value.spec);
    if (value.sourceBindings !== undefined) {
      if (!record(value.sourceBindings))
        throw new RegulationError(400, "Invalid source binding table.");
      for (const [id, source] of Object.entries(value.sourceBindings))
        validateGitPilotSource(id, source.tree, source);
    }
    if (!record(value.subject) || (value.language !== undefined && !text(value.language)))
      throw new RegulationError(400, "Invalid subject or language.");
    if (value.history !== undefined) {
      fields(value.history, ["stalledRuns"]);
      if (!Number.isSafeInteger(value.history.stalledRuns) || value.history.stalledRuns < 0)
        throw new RegulationError(400, "History stalledRuns must be a nonnegative safe count.");
    }
    return immutable({
      ...structuredClone(value),
      permissions: makeRegulationPermissions(value.permissions),
    });
  } catch (cause) {
    throw inputError(cause);
  }
}

export function pilotInput(input: RegulationInput): PilotInput {
  return {
    spec: input.spec.objective,
    subject: input.subject,
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(input.spec.strategy.targetLevel === "initial" ? { targetLevel: "initial" as const } : {}),
  };
}

export function agentInput(input: RegulationInput, observation: PilotObservation): AgentInput {
  return immutable(
    structuredClone({
      binding: input.spec.binding,
      subject: input.subject,
      target: {
        objectiveId: input.spec.objective.objectiveId,
        levelId: input.spec.strategy.targetLevel,
      },
      observation,
      limits: input.spec.strategy.agentExecutionLimits,
      permissions: makeRegulationPermissions(input.permissions),
    }),
  );
}

export type RegulationDecision =
  | { readonly type: "stop"; readonly reason: "target-reached" }
  | {
      readonly type: "stop";
      readonly reason: "dependency-required";
      readonly dependencies: readonly [DependencyProblem, ...DependencyProblem[]];
    }
  | { readonly type: "execute"; readonly input: AgentInput };

function decide(input: RegulationInput, observation: PilotObservation): RegulationDecision {
  const objective = input.spec.objective;
  const current = observation.current;
  if (current.objectiveId !== objective.objectiveId) {
    throw new RegulationError(500, "Observation belongs to an unrelated Objective.");
  }
  const index = attainedLevelRank(objective, current.levelId);
  if (index < 0) throw new RegulationError(500, "Observation contains an unknown root level.");
  const parsed = parseCheckEnvelope({
    status: 200,
    message: "",
    payload: {
      ok: observation.problems.length === 0,
      problems: observation.problems.map((problem) =>
        problem.kind === "dependency"
          ? problem
          : {
              kind: problem.kind,
              id: problem.ref.problemId,
              parameters: problem.parameters,
            },
      ),
    },
  });
  if (
    parsed.payload === null ||
    observation.versions[objective.objectiveId] !== objective.version ||
    observation.problems.some(
      (problem) =>
        problem.kind === "internal" &&
        (problem.ref.objectiveId !== objective.objectiveId ||
          problem.ref.levelId !== objective.manifest.levels[index]?.id ||
          !objective.manifest.levels[index]?.checks.some(
            (check) =>
              check.id === problem.ref.checkId && check.problems.includes(problem.ref.problemId),
          )),
    )
  )
    throw new RegulationError(500, "Invalid observation evidence or scoped problems.");
  if (objective.source !== undefined) {
    for (const [id, version] of Object.entries(observation.versions))
      validateGitPilotSource(id, version, observation.sources?.[id]);
    if (observation.sources?.[objective.objectiveId]?.commit !== objective.source.commit)
      throw new RegulationError(500, "Observation snapshot mismatch.");
  }
  if (index >= levelRank(objective, input.spec.strategy.targetLevel))
    return { type: "stop", reason: "target-reached" };
  const dependencies = observation.problems.filter((problem) => problem.kind === "dependency");
  const [first, ...rest] = dependencies;
  if (first) {
    if (
      dependencies.some(
        (problem) =>
          !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(observation.versions[problem.objectiveId] ?? ""),
      )
    )
      throw new RegulationError(500, "Missing dependency version evidence.");
    return { type: "stop", reason: "dependency-required", dependencies: [first, ...rest] };
  }
  if (
    observation.problems.length === 0 ||
    observation.problems.some((problem) => problem.kind !== "internal")
  )
    throw new RegulationError(500, "Observation has no actionable root-scoped problems.");
  return { type: "execute", input: agentInput(input, observation) };
}

export function decideRegulation(
  input: RegulationInput,
  observation: PilotObservation,
): RegulationDecision {
  return decide(snapshotInput(input), observation);
}

function validateAgentOutcome(value: unknown): AgentOutcome {
  if (
    !isJsonValue(value) ||
    !record(value) ||
    typeof value.status !== "string" ||
    (value.status === "completed"
      ? !text(value.summary)
      : !["blocked", "failed", "limit-reached", "authorization-required"].includes(value.status) ||
        !text(value.reason))
  )
    throw new RegulationError(502, "Agent returned an invalid outcome.");
  const requests = "authorizationRequests" in value ? value.authorizationRequests : undefined;
  if (
    (value.status === "authorization-required" &&
      (!Array.isArray(requests) || requests.length === 0)) ||
    (requests !== undefined &&
      (!["completed", "authorization-required"].includes(value.status) ||
        !Array.isArray(requests) ||
        !requests.every(
          (request: unknown) =>
            record(request) &&
            Object.keys(request).every((key) =>
              ["id", "operation", "resources", "reason", "command"].includes(key),
            ) &&
            text(request.id) &&
            text(request.operation) &&
            text(request.reason) &&
            Array.isArray(request.resources) &&
            request.resources.every(text) &&
            (request.command === undefined || text(request.command)),
        )))
  )
    throw new RegulationError(502, "Agent returned invalid authorization requests.");
  return immutable(structuredClone(value)) as unknown as AgentOutcome;
}

async function interruptible<T>(action: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      action,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

async function timed<T>(
  action: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutValue: T,
  parent: AbortSignal,
): Promise<T> {
  parent.throwIfAborted();
  const controller = new AbortController();
  const signal = AbortSignal.any([parent, controller.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        resolve(timeoutValue);
        controller.abort(new Error("Execution time limit reached."));
      }, timeoutMs);
    });
    const pending = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return action(signal);
    });
    return await interruptible(Promise.race([pending, deadline]), parent);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function probeWithPolicy(
  input: RegulationInput,
  runtime: RegulationRuntime,
  signal: AbortSignal,
  publish: (value: Envelope<PilotObservation>) => void,
): Promise<Envelope<PilotObservation>> {
  const policy = input.spec.strategy.probe ?? {
    timeoutMs: 30_000,
    retry: { maxRetries: 0, delayMs: 0 },
  };
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const envelope = await timed<Envelope<PilotObservation>>(
      async (probeSignal) => {
        const result = await Effect.runPromise(
          observe(pilotInput(input), runtime.pilot).pipe(
            Effect.match({
              onSuccess: (value) => ({ value }),
              onFailure: (error) => ({ error }),
            }),
          ),
          { signal: probeSignal },
        );
        if ("error" in result) throw result.error;
        return result.value;
      },
      policy.timeoutMs,
      { status: 504, payload: null, message: `Probe exceeded ${policy.timeoutMs}ms.` },
      signal,
    );
    signal.throwIfAborted();
    const stable = immutable(structuredClone(envelope));
    publish(stable);
    if (stable.payload !== null) return stable;
    if (stable.status < 500 || stable.status > 599 || attempt >= policy.retry.maxRetries)
      throw new RegulationError(
        stable.status >= 400 && stable.status <= 599 ? stable.status : 502,
        `Probe invocation failed: ${stable.message}`,
        { envelope: stable },
      );
    await Effect.runPromise(Effect.sleep(policy.retry.delayMs), { signal });
  }
}

function progressed(
  before: PilotObservation,
  after: PilotObservation,
  objective: PilotSpec,
): boolean {
  if (after.current.objectiveId !== objective.objectiveId) return false;
  const previous = attainedLevelRank(objective, before.current.levelId);
  const current = attainedLevelRank(objective, after.current.levelId);
  if (current > previous) return true;
  const scopedCount = (observation: PilotObservation) =>
    new Set(
      observation.problems
        .filter((problem) => problem.kind === "internal")
        .map(({ ref }) =>
          JSON.stringify([ref.objectiveId, ref.levelId, ref.checkId, ref.problemId]),
        ),
    ).size;
  return current === previous && scopedCount(after) < scopedCount(before);
}

export function regulate(
  input: RegulationInput,
  runtime: RegulationRuntime,
): Effect.Effect<RegulationOutcome, RegulationError> {
  return Effect.callback<RegulationOutcome, RegulationError>((resume, parent) => {
    const startedAt = performance.now();
    const deadline = new AbortController();
    const signal = AbortSignal.any([parent, deadline.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let iterations = 0;
    let stalledRuns = 0;
    let latestObservation: Envelope<PilotObservation> = {
      status: 408,
      payload: null,
      message: "Regulation time quota exhausted before an observation.",
    };
    let agentOutcome: AgentOutcome | undefined;
    const outcome = (
      stopReason: StopReason,
      extra: Pick<RegulationOutcomeBase, "exhaustedBy" | "authorizationRequests"> & {
        readonly dependencies?: readonly [DependencyProblem, ...DependencyProblem[]];
      } = {},
    ): RegulationOutcome =>
      immutable({
        ...(stopReason === "dependency-required"
          ? {
              stopReason,
              dependencies:
                extra.dependencies ??
                (() => {
                  throw new RegulationError(500, "Missing dependency handoff.");
                })(),
            }
          : { stopReason }),
        iterations,
        latestObservation,
        stalledRuns,
        ...(agentOutcome === undefined ? {} : { agentOutcome }),
        ...extra,
      });
    const pending = (async (): Promise<RegulationOutcome> => {
      try {
        parent.throwIfAborted();
        const stable = snapshotInput(input);
        stalledRuns = stable.history?.stalledRuns ?? 0;
        if (
          !record(runtime) ||
          !record(runtime.pilot) ||
          typeof runtime.pilot.resolveCheck !== "function" ||
          typeof runtime.executeAgent !== "function" ||
          (runtime.onObservation !== undefined && typeof runtime.onObservation !== "function")
        )
          throw new RegulationError(400, "Invalid regulator runtime bindings.");
        const quota = stable.spec.strategy.quota;
        const remaining = quota.timeoutMs - (performance.now() - startedAt);
        if (remaining <= 0) return outcome("exhausted", { exhaustedBy: "time" });
        timer = setTimeout(() => deadline.abort(), remaining);
        const checkTime = () => {
          parent.throwIfAborted();
          if (performance.now() - startedAt >= quota.timeoutMs) deadline.abort();
          signal.throwIfAborted();
        };
        let previous: PilotObservation | undefined;
        while (true) {
          checkTime();
          latestObservation = await probeWithPolicy(stable, runtime, signal, (sample) => {
            checkTime();
            latestObservation = sample;
            runtime.onObservation?.(sample);
          });
          checkTime();
          const observation = latestObservation.payload;
          if (observation === null)
            throw new RegulationError(500, "Missing successful observation.");
          const decision = decide(stable, observation);
          if (decision.type === "stop" && decision.reason === "dependency-required")
            return outcome("dependency-required", { dependencies: decision.dependencies });
          const madeProgress =
            previous !== undefined && progressed(previous, observation, stable.spec.objective);
          const authorizationRequests =
            agentOutcome && "authorizationRequests" in agentOutcome
              ? agentOutcome.authorizationRequests
              : undefined;
          const authorizationBlocked =
            previous !== undefined && !madeProgress && Boolean(authorizationRequests?.length);
          if (previous !== undefined)
            stalledRuns = madeProgress
              ? 0
              : authorizationBlocked
                ? stalledRuns
                : Math.min(Number.MAX_SAFE_INTEGER, stalledRuns + 1);
          checkTime();
          if (decision.type === "stop") return outcome(decision.reason);
          if (authorizationBlocked && authorizationRequests)
            return outcome("authorization-required", { authorizationRequests });
          if (stalledRuns >= quota.maxStallRuns)
            return outcome("exhausted", { exhaustedBy: "stall" });
          if (iterations >= quota.maxAgentRuns)
            return outcome("exhausted", { exhaustedBy: "agent-runs" });
          previous = observation;
          iterations++;
          agentOutcome = validateAgentOutcome(
            await timed(
              (agentSignal) => runtime.executeAgent(decision.input, agentSignal),
              stable.spec.strategy.agentExecutionLimits.timeoutMs,
              { status: "limit-reached", reason: "Agent execution time limit reached." },
              signal,
            ),
          );
          checkTime();
          if (agentOutcome.status === "limit-reached")
            return outcome("exhausted", { exhaustedBy: "agent-limit" });
          if (
            agentOutcome.status !== "completed" &&
            agentOutcome.status !== "authorization-required"
          )
            throw new RegulationError(
              agentOutcome.status === "blocked" ? 409 : 500,
              `Agent ${agentOutcome.status}: ${agentOutcome.reason}`,
            );
        }
      } catch (cause) {
        parent.throwIfAborted();
        if (deadline.signal.aborted) return outcome("exhausted", { exhaustedBy: "time" });
        throw executionError(cause);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    })();
    const settled = pending.then(
      (value) => resume(Effect.succeed(value)),
      (cause: unknown) => resume(Effect.fail(executionError(cause))),
    );
    return Effect.promise(() => settled);
  });
}

/** Each externally changed complete snapshot starts a fresh, single regulation run. */
export async function regulatorBehavior(
  source: SubscriptionRef.SubscriptionRef<RegulationInput>,
  runtime: RegulationRuntime,
  parentSignal?: AbortSignal,
) {
  const slot = await createLatestSlot<string, RegulationOutcome, RegulationError>(parentSignal);
  const observation = await Effect.runPromise(
    SubscriptionRef.make<EffectSample<string, Envelope<PilotObservation>, RegulationError>>({
      state: "initial",
    }),
  );
  let generation = 0;
  let previousKey: string | undefined;
  const watcher = watchSnapshot(
    source,
    (snapshot) => {
      let stable: RegulationInput;
      try {
        stable = snapshotInput(snapshot);
      } catch (cause) {
        const key = `invalid:${++generation}`;
        previousKey = undefined;
        slot.replace(key, Effect.fail(inputError(cause)));
        return;
      }
      const key = JSON.stringify(stable);
      if (key === previousKey) return;
      previousKey = key;
      const token = ++generation;
      slot.replace(
        key,
        regulate(stable, {
          ...runtime,
          onObservation(sample) {
            if (token !== generation) return;
            Effect.runSync(
              SubscriptionRef.set(observation, { state: "ready", key, value: sample }),
            );
            runtime.onObservation?.(sample);
          },
        }),
      );
    },
    parentSignal,
  );
  return {
    observation,
    outcome: slot.state,
    async close() {
      generation++;
      watcher.cancel();
      await watcher.exit();
      await slot.close();
    },
  };
}
