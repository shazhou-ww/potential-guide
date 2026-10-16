import {
  createLatestSlot,
  Effect,
  type RunningEffect,
  type SubscriptionRef,
  watchSnapshot,
} from "@potential-guide/effects";
import {
  type Envelope,
  isJsonValue,
  type JsonObject,
  type LevelRef,
  observe,
  type PilotInput,
  type PilotObservation,
  type PilotRuntime,
  type PilotSpec,
  type Subject,
} from "@potential-guide/objective-pilot";

export interface AgentExecutionLimits {
  readonly timeoutMs: number;
}
export interface RegulationStrategy {
  readonly targetLevel: string;
  readonly agentExecutionLimits: AgentExecutionLimits;
  readonly mode?:
    | { readonly type: "adhoc" }
    | { readonly type: "periodic"; readonly intervalMs: number };
  readonly probe?: {
    readonly timeoutMs: number;
    readonly retry: { readonly maxRetries: number; readonly delayMs: number };
  };
  readonly effectTtlMs?: number;
}
export interface AgentBinding {
  readonly id: string;
  readonly configuration?: JsonObject;
}
export interface RegulatorSpec {
  readonly pilot: PilotSpec;
  readonly strategy: RegulationStrategy;
  readonly binding: AgentBinding;
}
export interface RegulationInput {
  readonly spec: RegulatorSpec;
  readonly subject: Subject;
  readonly language?: string;
}
export interface AgentInput {
  readonly binding: AgentBinding;
  readonly subject: Subject;
  readonly target: LevelRef;
  readonly observation: PilotObservation;
  readonly limits: AgentExecutionLimits;
}
export type AgentOutcome =
  | { readonly status: "completed"; readonly summary: string }
  | { readonly status: "blocked" | "failed" | "limit-reached"; readonly reason: string };
export type StopReason =
  | "target-reached"
  | "no-actionable-problem"
  | "invocation-failed"
  | "agent-blocked"
  | "agent-failed"
  | "agent-limit-reached";
export interface RegulationOutcome {
  readonly stopReason: StopReason;
  readonly iterations: number;
  readonly latestObservation: Envelope<PilotObservation>;
  readonly agentOutcome?: AgentOutcome;
}
export interface RegulationRuntime {
  readonly pilot: PilotRuntime;
  readonly executeAgent: (input: AgentInput, signal: AbortSignal) => Promise<AgentOutcome>;
  readonly onObservation?: (observation: Envelope<PilotObservation>) => void;
}
export class ObjectiveRegulatorError extends TypeError {}

function validateStrategy(pilot: PilotSpec, strategy: RegulationStrategy, binding: AgentBinding) {
  if (!isJsonValue({ pilot, strategy, binding }))
    throw new ObjectiveRegulatorError(
      "Regulator specifications must contain only finite JSON data.",
    );
  if (
    Object.keys(strategy).some(
      (key) =>
        !["targetLevel", "agentExecutionLimits", "mode", "probe", "effectTtlMs"].includes(key),
    ) ||
    Object.keys(strategy.agentExecutionLimits).some((key) => key !== "timeoutMs") ||
    Object.keys(binding).some((key) => !["id", "configuration"].includes(key))
  ) {
    throw new ObjectiveRegulatorError(
      "Unsupported regulator strategy, execution limits or binding fields; legacy budgets are not supported.",
    );
  }
  if (
    !pilot.manifest.levels.some(({ id }) => id === strategy.targetLevel) &&
    strategy.targetLevel !== "terminal"
  ) {
    throw new ObjectiveRegulatorError("Target level must belong to the root Pilot Objective.");
  }
  if (
    !Number.isSafeInteger(strategy.agentExecutionLimits.timeoutMs) ||
    strategy.agentExecutionLimits.timeoutMs < 1 ||
    strategy.agentExecutionLimits.timeoutMs > 2_147_483_647
  ) {
    throw new ObjectiveRegulatorError("Agent timeoutMs must be a positive safe timer duration.");
  }
  if (!binding.id.trim()) throw new ObjectiveRegulatorError("Agent binding ID must be nonempty.");
  const duration = (value: number) =>
    Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
  if (strategy.effectTtlMs !== undefined && !duration(strategy.effectTtlMs)) {
    throw new ObjectiveRegulatorError("Effect TTL must be a positive safe timer duration.");
  }
  const mode = strategy.mode;
  if (
    mode !== undefined &&
    (!["adhoc", "periodic"].includes(mode.type) ||
      Object.keys(mode).some(
        (key) => !["type", ...(mode.type === "periodic" ? ["intervalMs"] : [])].includes(key),
      ) ||
      (mode.type === "periodic" && !duration(mode.intervalMs)))
  )
    throw new ObjectiveRegulatorError(
      "Periodic mode requires a positive intervalMs; adhoc accepts only type.",
    );
  const probe = strategy.probe;
  if (
    probe !== undefined &&
    (!duration(probe.timeoutMs) ||
      Object.keys(probe).some((key) => !["timeoutMs", "retry"].includes(key)) ||
      Object.keys(probe.retry).some((key) => !["maxRetries", "delayMs"].includes(key)) ||
      !Number.isSafeInteger(probe.retry.maxRetries) ||
      probe.retry.maxRetries < 0 ||
      !Number.isSafeInteger(probe.retry.delayMs) ||
      probe.retry.delayMs < 0 ||
      probe.retry.delayMs > 2_147_483_647)
  )
    throw new ObjectiveRegulatorError(
      "Probe policy requires a positive timeoutMs, nonnegative finite maxRetries and timer delayMs.",
    );
}

export function makeRegulatorSpec(
  pilot: PilotSpec,
  strategy: RegulationStrategy,
  binding: AgentBinding,
): RegulatorSpec {
  validateStrategy(pilot, strategy, binding);
  // Snapshot the recipe; neither the subject nor local executable bindings belong here.
  const spec = structuredClone({ pilot, strategy, binding });
  function freeze(value: object) {
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object") freeze(child);
    }
    Object.freeze(value);
  }
  freeze(spec);
  return spec;
}

export function pilotInput(input: RegulationInput): PilotInput {
  return {
    spec: input.spec.pilot,
    subject: input.subject,
    ...(input.language === undefined ? {} : { language: input.language }),
  };
}

export function agentInput(input: RegulationInput, observation: PilotObservation): AgentInput {
  return {
    binding: input.spec.binding,
    subject: input.subject,
    target: { objectiveId: input.spec.pilot.objectiveId, levelId: input.spec.strategy.targetLevel },
    observation,
    limits: input.spec.strategy.agentExecutionLimits,
  };
}

export type RegulationDecision =
  | { readonly type: "stop"; readonly reason: "target-reached" | "no-actionable-problem" }
  | { readonly type: "execute"; readonly input: AgentInput };

export function decideRegulation(
  input: RegulationInput,
  observation: PilotObservation,
): RegulationDecision {
  validateStrategy(input.spec.pilot, input.spec.strategy, input.spec.binding);
  const pilot = input.spec.pilot;
  const rootLevels = [...pilot.manifest.levels.map(({ id }) => id), "terminal"];
  const current = observation.current;
  if (current.objectiveId === pilot.objectiveId) {
    const index = rootLevels.indexOf(current.levelId);
    if (index < 0) throw new ObjectiveRegulatorError("Observation contains an unknown root level.");
    if (index >= rootLevels.indexOf(input.spec.strategy.targetLevel)) {
      return { type: "stop", reason: "target-reached" };
    }
  } else {
    let owner = pilot.prerequisite;
    while (owner !== undefined && owner.objectiveId !== current.objectiveId)
      owner = owner.prerequisite;
    if (
      owner === undefined ||
      ![...owner.manifest.levels.map(({ id }) => id), "terminal"].includes(current.levelId)
    ) {
      throw new ObjectiveRegulatorError("Observation belongs to an unrelated Objective.");
    }
  }
  return observation.problems.length === 0
    ? { type: "stop", reason: "no-actionable-problem" }
    : { type: "execute", input: agentInput(input, observation) };
}

function validateAgentOutcome(value: AgentOutcome): AgentOutcome {
  if (
    value === null ||
    typeof value !== "object" ||
    (value.status === "completed"
      ? typeof value.summary !== "string" || !value.summary.trim()
      : !["blocked", "failed", "limit-reached"].includes(value.status) ||
        typeof value.reason !== "string" ||
        !value.reason.trim())
  ) {
    throw new ObjectiveRegulatorError("Agent returned an invalid outcome.");
  }
  return value;
}

async function executeAgent(
  input: AgentInput,
  runtime: RegulationRuntime,
  parent: AbortSignal,
): Promise<AgentOutcome> {
  parent.throwIfAborted();
  const controller = new AbortController();
  const signal = AbortSignal.any([parent, controller.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const deadline = new Promise<AgentOutcome>((resolve, reject) => {
      onAbort = () => reject(parent.reason);
      parent.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        controller.abort(new Error("Agent execution time limit reached."));
        resolve({ status: "limit-reached", reason: "Agent execution time limit reached." });
      }, input.limits.timeoutMs);
    });
    // Promise.race owns late rejection handlers without waiting for uncooperative cleanup.
    const action = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return runtime.executeAgent(input, signal);
    });
    const outcome = await Promise.race([action, deadline]);
    parent.throwIfAborted();
    return validateAgentOutcome(outcome);
  } catch (cause) {
    parent.throwIfAborted();
    return { status: "failed", reason: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) parent.removeEventListener("abort", onAbort);
  }
}

interface ObservationSource {
  read(refresh: boolean, signal: AbortSignal): Promise<Envelope<PilotObservation>>;
  cancel?(): void;
}

async function probeWithPolicy(
  input: RegulationInput,
  source: ObservationSource,
  refresh: boolean,
  signal: AbortSignal,
  onObservation: RegulationRuntime["onObservation"],
): Promise<Envelope<PilotObservation>> {
  const policy = input.spec.strategy.probe ?? {
    timeoutMs: 30_000,
    retry: { maxRetries: 0, delayMs: 0 },
  };
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const envelope = await Effect.runPromise(
      Effect.timeoutOrElse(
        Effect.tryPromise({
          try: (probeSignal) => source.read(refresh || attempt > 0, probeSignal),
          catch: (cause) =>
            cause instanceof Error ? cause : new ObjectiveRegulatorError(String(cause)),
        }),
        {
          duration: policy.timeoutMs,
          orElse: () =>
            Effect.sync<Envelope<PilotObservation>>(() => {
              source.cancel?.();
              return {
                status: 504,
                payload: null,
                message: `probe-timeout: Observation exceeded ${policy.timeoutMs}ms.`,
              };
            }),
        },
      ),
      { signal },
    );
    signal.throwIfAborted();
    onObservation?.(envelope);
    if (
      envelope.payload !== null ||
      envelope.status < 500 ||
      envelope.status > 599 ||
      attempt >= policy.retry.maxRetries
    )
      return envelope;
    await Effect.runPromise(Effect.sleep(policy.retry.delayMs), { signal });
  }
}

function regulation(
  input: RegulationInput,
  runtime: RegulationRuntime,
  source: ObservationSource,
): Effect.Effect<RegulationOutcome, Error> {
  const execution = Effect.callback<RegulationOutcome, Error>((resume, signal) => {
    const pending = (async (): Promise<RegulationOutcome> => {
      signal.throwIfAborted();
      validateStrategy(input.spec.pilot, input.spec.strategy, input.spec.binding);
      let iterations = 0;
      let refresh = false;
      while (true) {
        const latestObservation = await probeWithPolicy(
          input,
          source,
          refresh,
          signal,
          runtime.onObservation,
        );
        signal.throwIfAborted();
        if (latestObservation.payload === null)
          return { stopReason: "invocation-failed", iterations, latestObservation };
        const decision = decideRegulation(input, latestObservation.payload);
        if (
          decision.type === "stop" &&
          decision.reason === "target-reached" &&
          input.spec.strategy.mode?.type === "periodic"
        ) {
          await Effect.runPromise(Effect.sleep(input.spec.strategy.mode.intervalMs), { signal });
          refresh = true;
          continue;
        }
        if (decision.type === "stop")
          return { stopReason: decision.reason, iterations, latestObservation };
        iterations++;
        const outcome = await executeAgent(decision.input, runtime, signal);
        signal.throwIfAborted();
        if (outcome.status !== "completed")
          return {
            stopReason:
              outcome.status === "blocked"
                ? "agent-blocked"
                : outcome.status === "failed"
                  ? "agent-failed"
                  : "agent-limit-reached",
            iterations,
            latestObservation,
            agentOutcome: outcome,
          };
        refresh = true;
      }
    })();
    const settled = pending.then(
      (value) => resume(Effect.succeed(value)),
      (cause: unknown) =>
        resume(
          Effect.fail(cause instanceof Error ? cause : new ObjectiveRegulatorError(String(cause))),
        ),
    );
    return Effect.promise(() => settled);
  });
  return Effect.suspend(() => {
    validateStrategy(input.spec.pilot, input.spec.strategy, input.spec.binding);
    return input.spec.strategy.effectTtlMs === undefined
      ? execution
      : Effect.timeoutOrElse(execution, {
          duration: input.spec.strategy.effectTtlMs,
          orElse: () => Effect.interrupt,
        });
  });
}

export function regulate(
  input: RegulationInput,
  runtime: RegulationRuntime,
): Effect.Effect<RegulationOutcome, Error> {
  return Effect.suspend(() => {
    const snapshot = structuredClone(input);
    return regulation(snapshot, runtime, {
      read: (_refresh, signal) =>
        Effect.runPromise(observe(pilotInput(snapshot), runtime.pilot), { signal }),
    });
  });
}

/** Submit one complete input snapshot when fields must change atomically. */
export async function regulatorBehavior(
  source: SubscriptionRef.SubscriptionRef<RegulationInput>,
  runtime: RegulationRuntime,
  parentSignal?: AbortSignal,
) {
  const pilotSlot = await createLatestSlot<string, Envelope<PilotObservation>, Error>(parentSignal);
  const regulationSlot = await createLatestSlot<string, RegulationOutcome, Error>(parentSignal);
  let owner:
    | {
        key: string;
        sequence: number;
        invalidated: boolean;
        input: PilotInput;
        handle: RunningEffect<Envelope<PilotObservation>, Error>;
      }
    | undefined;
  let generation = 0;
  let regulationKey: string | undefined;
  let runningRegulation: RunningEffect<RegulationOutcome, Error> | undefined;
  const watcher = watchSnapshot(
    source,
    (snapshot) => {
      const input = structuredClone(snapshot);
      const nextRegulationKey = JSON.stringify(input);
      if (regulationKey === nextRegulationKey) return;
      runningRegulation?.cancel();
      regulationKey = nextRegulationKey;
      const key = JSON.stringify(pilotInput(input));
      if (owner?.key !== key) {
        owner = {
          key,
          sequence: 0,
          invalidated: false,
          input: pilotInput(input),
          handle: pilotSlot.replace(`${key}:0`, observe(pilotInput(input), runtime.pilot)),
        };
      }
      const selected = owner;
      const token = ++generation;
      const currentRuntime: RegulationRuntime = {
        ...runtime,
        onObservation: (observation) => {
          if (token === generation) runtime.onObservation?.(observation);
        },
      };
      runningRegulation = regulationSlot.replace(
        nextRegulationKey,
        regulation(input, currentRuntime, {
          read: async (refresh, signal) => {
            signal.throwIfAborted();
            if (refresh || selected.invalidated) {
              selected.invalidated = false;
              selected.sequence++;
              selected.handle = pilotSlot.replace(
                `${selected.key}:${selected.sequence}`,
                observe(selected.input, runtime.pilot),
              );
            }
            const result = await selected.handle.await();
            signal.throwIfAborted();
            return result;
          },
          cancel() {
            selected.invalidated = true;
            selected.handle.cancel();
          },
        }),
      );
    },
    parentSignal,
  );
  return {
    observation: pilotSlot.state,
    outcome: regulationSlot.state,
    async close() {
      generation++;
      watcher.cancel();
      await watcher.exit();
      await Promise.all([pilotSlot.close(), regulationSlot.close()]);
    },
  };
}
