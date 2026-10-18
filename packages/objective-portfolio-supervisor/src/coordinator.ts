import { Effect, SubscriptionRef, watchSnapshot } from "@potential-guide/effects";
import {
  makeRegulationPermissions,
  makeRegulatorSpec,
  type RegulationInput,
  type RegulationOutcome,
  type RegulationPermissions,
} from "@potential-guide/objective-regulator";
import {
  canonicalJson,
  chooseResource,
  levelRank,
  ObjectivePortfolioError,
  objectiveKey,
  preemptionVictims,
  supports,
  validateGoal,
} from "./decisions.js";
import type {
  ActiveRun,
  AgentResource,
  CoordinatorEvent,
  CoordinatorState,
  PortfolioCoordinator,
  PortfolioCoordinatorOptions,
  PriorityQueueSnapshot,
  QueueDemand,
  RunHandle,
} from "./types.js";

interface Execution extends ActiveRun {
  readonly input: RegulationInput & { readonly permissions: RegulationPermissions };
  readonly handle: RunHandle;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  stopped?: Promise<void>;
}

function token(demand: QueueDemand): string {
  return canonicalJson([demand.id, demand.revision]);
}
function recipe(demand: QueueDemand): string {
  return canonicalJson([demand.pilot, demand.subject, demand.language ?? null]);
}
function permissionSignature(permissions: RegulationPermissions): string {
  // Rule IDs, ordering, priorities and unselected ceiling entries confer no authority.
  const effective = permissions.ceiling
    .filter((rule) => permissions.grants.includes(rule.id))
    .flatMap((rule) =>
      rule.operation === "execute"
        ? [canonicalJson({ operation: rule.operation, command: rule.command })]
        : rule.resources.map((resource) => canonicalJson({ operation: rule.operation, resource })),
    );
  return canonicalJson([...new Set(effective)].sort());
}
function authorizationSignature(demand: QueueDemand, permissions: RegulationPermissions): string {
  return canonicalJson([recipe(demand), demand.targetLevel, permissionSignature(permissions)]);
}

export function validateQueue(snapshot: PriorityQueueSnapshot): void {
  if (
    !snapshot ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !Array.isArray(snapshot.demands)
  )
    throw new ObjectivePortfolioError("Invalid priority queue snapshot.");
  const ids = new Set<string>();
  for (const demand of snapshot.demands) {
    validateGoal(demand);
    if (ids.has(demand.id) || !Number.isSafeInteger(demand.revision) || demand.revision < 1)
      throw new ObjectivePortfolioError("Queue demands require unique IDs and positive revisions.");
    ids.add(demand.id);
  }
}

export function validateResources(resources: readonly AgentResource[]): void {
  if (!Array.isArray(resources)) throw new ObjectivePortfolioError("Resources must be an array.");
  const ids = new Set<string>();
  for (const resource of resources) {
    if (
      !resource.id?.trim() ||
      ids.has(resource.id) ||
      !resource.binding?.id?.trim() ||
      !Number.isSafeInteger(resource.capacity) ||
      resource.capacity < 1 ||
      !Array.isArray(resource.capabilities) ||
      resource.capabilities.some((value: unknown) => typeof value !== "string" || !value.trim())
    )
      throw new ObjectivePortfolioError("Invalid or duplicate agent resource.");
    canonicalJson(resource);
    ids.add(resource.id);
  }
}

export async function createPortfolioCoordinator(
  options: PortfolioCoordinatorOptions,
): Promise<PortfolioCoordinator> {
  if (
    !Number.isSafeInteger(options.maxConcurrency) ||
    options.maxConcurrency < 1 ||
    !Number.isSafeInteger(options.abortGraceMs) ||
    options.abortGraceMs < 0 ||
    options.abortGraceMs > 2_147_483_647
  )
    throw new ObjectivePortfolioError(
      "Coordinator requires positive concurrency and nonnegative abort grace.",
    );
  let queue = structuredClone(await Effect.runPromise(SubscriptionRef.get(options.queue)));
  let resources = structuredClone(await Effect.runPromise(SubscriptionRef.get(options.resources)));
  validateQueue(queue);
  validateResources(resources);
  let permissions = makeRegulationPermissions(
    options.permissionUpdates
      ? await Effect.runPromise(SubscriptionRef.get(options.permissionUpdates))
      : options.permissions,
  );
  let permissionInvalid = false;
  const state = await Effect.runPromise(
    SubscriptionRef.make<CoordinatorState>({ runs: [], events: [] }),
  );
  const runs = new Set<Execution>();
  const completed = new Set<string>();
  const authorizationBlocked = new Map<string, string>();
  const history = new Map<string, number>();
  const arrivals = new Map<string, number>();
  const p0Arrivals = new Map<string, number>();
  const notifications = new Set<string>();
  const events: CoordinatorEvent[] = [];
  const callbacks = new Set<Promise<void>>();
  let counter = 0;
  let error: unknown;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;

  function publish() {
    Effect.runSync(
      SubscriptionRef.set(state, {
        runs: [...runs].map(({ demand, resourceId, status }) => ({ demand, resourceId, status })),
        events: [...events],
        ...(error === undefined ? {} : { error }),
      }),
    );
  }
  function failed(cause: unknown) {
    error = cause;
    publish();
  }
  function emit(event: CoordinatorEvent) {
    events.push(event);
    if (events.length > 256) events.shift();
    publish();
    if (options.onEvent) {
      const pending = Promise.resolve()
        .then(() => options.onEvent!(event))
        .catch(failed);
      callbacks.add(pending);
      void pending.finally(() => callbacks.delete(pending));
    }
  }
  function schedule() {
    if (closed || timer !== undefined) return;
    // Continuations always yield, including an immediately exhausted runner.
    timer = setTimeout(() => {
      timer = undefined;
      try {
        drain();
      } catch (cause) {
        failed(cause);
      }
    }, 0);
  }
  function release(run: Execution) {
    run.settled = true;
    clearTimeout(run.timer);
    runs.delete(run);
    publish();
    schedule();
  }
  function finish(run: Execution, outcome?: RegulationOutcome, cause?: unknown) {
    if (run.settled) return;
    const stillCurrent = queue.demands.some(
      (demand) =>
        demand.id === run.demand.id &&
        demand.revision === run.demand.revision &&
        recipe(demand) === recipe(run.demand),
    );
    const stopping = run.status === "stopping";
    release(run);
    if (
      outcome &&
      (outcome.stopReason === "authorization-required" ||
        (outcome.stopReason === "exhausted" && outcome.authorizationRequests?.length)) &&
      !stopping
    ) {
      const current = queue.demands.find((demand) => demand.id === run.demand.id);
      const signature = authorizationSignature(run.demand, run.input.permissions);
      if (current && signature === authorizationSignature(current, permissions)) {
        authorizationBlocked.set(current.id, signature);
        history.set(recipe(current), outcome.stalledRuns);
        emit({ type: "result", demand: current, outcome });
      }
      return;
    }
    if (!stillCurrent || stopping) return;
    if (outcome) {
      history.set(recipe(run.demand), outcome.stalledRuns);
      if (outcome.stopReason !== "exhausted") {
        completed.add(token(run.demand));
        if (outcome.stopReason === "target-reached") {
          for (const demand of queue.demands) {
            if (
              objectiveKey(demand) === objectiveKey(run.demand) &&
              recipe(demand) === recipe(run.demand) &&
              levelRank(demand.pilot, demand.targetLevel) <=
                levelRank(run.demand.pilot, run.demand.targetLevel)
            )
              completed.add(token(demand));
          }
        }
      }
      emit({ type: "result", demand: run.demand, outcome });
    } else {
      completed.add(token(run.demand));
      failed(cause);
      emit({ type: "failed", demand: run.demand, error: cause });
    }
  }
  function stop(run: Execution): Promise<void> {
    if (run.stopped) return run.stopped;
    Object.assign(run, { status: "stopping" });
    emit({ type: "stopping", demand: run.demand });
    try {
      run.handle.abort();
    } catch (cause) {
      failed(cause);
    }
    run.stopped = new Promise<void>((resolve, reject) => {
      // Confirmed settlement is sufficient; a rejected kill must not release the slot.
      void run.handle.result.then(
        () => resolve(),
        () => resolve(),
      );
      run.timer = setTimeout(() => {
        if (run.settled) {
          resolve();
          return;
        }
        void Promise.resolve()
          .then(() => run.handle.kill())
          .then(
            () => {
              if (!run.settled) {
                release(run);
                emit({ type: "killed", demand: run.demand });
              }
              resolve();
            },
            (cause: unknown) => {
              failed(cause);
              reject(cause);
            },
          );
      }, options.abortGraceMs);
    });
    void run.stopped.catch(() => undefined);
    return run.stopped;
  }
  function rememberArrivals() {
    const live = new Set(queue.demands.map(token));
    for (const key of arrivals.keys())
      if (!live.has(key)) {
        arrivals.delete(key);
        p0Arrivals.delete(key);
      }
    for (const demand of queue.demands) {
      const key = token(demand);
      if (!arrivals.has(key)) arrivals.set(key, ++counter);
      if (demand.priority === 0 && !p0Arrivals.has(key)) p0Arrivals.set(key, ++counter);
      if (demand.priority !== 0) p0Arrivals.delete(key);
    }
  }
  function drain() {
    if (closed || permissionInvalid) return;
    rememberArrivals();
    for (const run of runs) {
      const current = queue.demands.find((demand) => demand.id === run.demand.id);
      if (!current || recipe(current) !== recipe(run.demand)) void stop(run);
      else Object.assign(run, { demand: { ...run.demand, priority: current.priority } });
    }
    const ordered = queue.demands
      .filter(
        (demand) =>
          !completed.has(token(demand)) &&
          authorizationBlocked.get(demand.id) !== authorizationSignature(demand, permissions) &&
          ![...runs].some((run) => token(run.demand) === token(demand)),
      )
      .sort(
        (a, b) =>
          a.priority - b.priority ||
          (a.priority === 0
            ? p0Arrivals.get(token(a))! - p0Arrivals.get(token(b))!
            : arrivals.get(token(a))! - arrivals.get(token(b))!),
      );
    for (const demand of ordered) {
      const capable = resources.some((resource) => supports(resource, demand));
      if (!capable && !notifications.has(`capability:${token(demand)}`)) {
        notifications.add(`capability:${token(demand)}`);
        emit({ type: "capability-request", demand, requirements: demand.requirements ?? [] });
      }
      const resource = chooseResource(demand, resources, [...runs], options.maxConcurrency);
      if (!resource) {
        if (demand.priority === 0) {
          if (!notifications.has(`p0:${token(demand)}`)) {
            notifications.add(`p0:${token(demand)}`);
            emit({ type: "p0-queued", demand });
          }
          const victims = preemptionVictims(demand, resources, [...runs], options.maxConcurrency);
          for (const victim of victims) void stop(victim as Execution);
          // Reserve pending termination capacity for the oldest compatible P0.
          if (capable) break;
        }
        continue;
      }
      try {
        const stalledRuns = history.get(recipe(demand)) ?? 0;
        const maxStallRuns = stalledRuns + options.quota.maxStallRuns;
        if (!Number.isSafeInteger(maxStallRuns))
          throw new ObjectivePortfolioError(
            "Continuation stall allowance exceeds the safe integer range.",
          );
        const input = {
          spec: makeRegulatorSpec(
            demand.pilot,
            {
              targetLevel: demand.targetLevel,
              // The regulator's cumulative ceiling includes carried telemetry.
              quota: { ...options.quota, maxStallRuns },
              agentExecutionLimits: options.agentExecutionLimits,
            },
            resource.binding,
          ),
          subject: demand.subject,
          history: { stalledRuns },
          permissions,
          ...(demand.language === undefined ? {} : { language: demand.language }),
        };
        const handle = options.runner.start(input, resource);
        const run: Execution = {
          input,
          demand,
          resourceId: resource.id,
          status: "running",
          handle,
          settled: false,
        };
        runs.add(run);
        emit({ type: "started", demand, resourceId: resource.id });
        void handle.result.then(
          (outcome) => finish(run, outcome),
          (cause: unknown) => finish(run, undefined, cause),
        );
      } catch (cause) {
        completed.add(token(demand));
        failed(cause);
        emit({ type: "failed", demand, error: cause });
      }
    }
    for (const demand of ordered) {
      if (
        demand.priority === 0 &&
        !completed.has(token(demand)) &&
        ![...runs].some((run) => token(run.demand) === token(demand)) &&
        !notifications.has(`p0:${token(demand)}`)
      ) {
        notifications.add(`p0:${token(demand)}`);
        emit({ type: "p0-queued", demand });
      }
    }
  }
  const queueWatcher = watchSnapshot(options.queue, (snapshot) => {
    if (closed || snapshot.revision < queue.revision) return;
    try {
      validateQueue(snapshot);
      if (snapshot.revision === queue.revision && canonicalJson(snapshot) !== canonicalJson(queue))
        throw new ObjectivePortfolioError("A queue revision cannot identify different snapshots.");
      for (const demand of snapshot.demands) {
        const previous = queue.demands.find((entry) => entry.id === demand.id);
        if (
          previous &&
          (demand.revision < previous.revision ||
            (demand.revision === previous.revision &&
              (recipe(demand) !== recipe(previous) ||
                demand.targetLevel !== previous.targetLevel ||
                canonicalJson(demand.requirements ?? []) !==
                  canonicalJson(previous.requirements ?? []))))
        )
          throw new ObjectivePortfolioError("Changed demand recipes require a newer revision.");
      }
      queue = structuredClone(snapshot);
      rememberArrivals();
      schedule();
    } catch (cause) {
      failed(cause);
    }
  });
  const resourceWatcher = watchSnapshot(options.resources, (snapshot) => {
    if (closed) return;
    try {
      validateResources(snapshot);
      resources = structuredClone(snapshot);
      schedule();
    } catch (cause) {
      failed(cause);
    }
  });
  const permissionWatcher = options.permissionUpdates
    ? watchSnapshot(options.permissionUpdates, (snapshot) => {
        if (closed) return;
        try {
          const next = makeRegulationPermissions(snapshot);
          if (!permissionInvalid && canonicalJson(next) === canonicalJson(permissions)) return;
          const changed = permissionSignature(next) !== permissionSignature(permissions);
          permissionInvalid = false;
          permissions = next;
          // Equivalent policy updates leave running snapshots intact; changed authority cancels them.
          if (changed) for (const run of runs) void stop(run);
          schedule();
        } catch (cause) {
          // Invalid replacement policy must not leave previously granted execution running.
          permissions = makeRegulationPermissions(undefined);
          permissionInvalid = true;
          for (const run of runs) void stop(run);
          failed(cause);
          schedule();
        }
      })
    : undefined;
  schedule();
  return {
    state,
    reportAuthorizationRequest(input, request) {
      if (closed) return;
      if (
        !request ||
        Object.keys(request).some(
          (key) => !["id", "operation", "resources", "reason", "command"].includes(key),
        ) ||
        typeof request.id !== "string" ||
        !request.id.trim() ||
        typeof request.operation !== "string" ||
        !request.operation.trim() ||
        typeof request.reason !== "string" ||
        !request.reason.trim() ||
        !Array.isArray(request.resources) ||
        request.resources.some((path) => typeof path !== "string" || !path.trim()) ||
        (request.command !== undefined &&
          (typeof request.command !== "string" || !request.command.trim()))
      )
        throw new ObjectivePortfolioError("Invalid authorization request.");
      const run = [...runs].find((entry) => entry.input === input && entry.status === "running");
      if (!run || !queue.demands.some((entry) => token(entry) === token(run.demand))) return;
      const key = canonicalJson(["agent-authorization", token(run.demand), request]);
      if (notifications.has(key)) return;
      notifications.add(key);
      emit({
        type: "authorization-request",
        demand: run.demand,
        request: structuredClone(request),
      });
    },
    reportCapabilityRequest(input, request) {
      if (closed) return;
      if (!request.capability?.trim() || !request.reason?.trim())
        throw new ObjectivePortfolioError("Capability requests require a capability and reason.");
      const run = [...runs].find((entry) => entry.input === input && entry.status === "running");
      if (!run || !queue.demands.some((entry) => token(entry) === token(run.demand))) return;
      const key = canonicalJson([
        "agent-capability",
        token(run.demand),
        request.capability,
        request.reason,
      ]);
      if (notifications.has(key)) return;
      notifications.add(key);
      emit({
        type: "capability-request",
        demand: run.demand,
        requirements: [request.capability],
        reason: request.reason,
      });
    },
    close() {
      if (closing) return closing;
      closed = true;
      clearTimeout(timer);
      queueWatcher.cancel();
      resourceWatcher.cancel();
      permissionWatcher?.cancel();
      closing = Promise.all([
        queueWatcher.exit(),
        resourceWatcher.exit(),
        ...(permissionWatcher ? [permissionWatcher.exit()] : []),
        ...[...runs].map(stop),
        ...callbacks,
      ]).then(() => undefined);
      return closing;
    },
  };
}
