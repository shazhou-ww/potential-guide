import { Effect, type Scope, Stream, SubscriptionRef } from "@potential-guide/effects";
import type { Envelope, PilotObservation } from "@potential-guide/objective-pilot";
import type { AgentBinding } from "@potential-guide/objective-regulator";
import { canonicalJson } from "./canonical-json.js";
import { identityKey } from "./identity.js";
import {
  commandForRequest,
  type RegulationRequests,
  type RequestCommand,
  type RequestDetails,
  reduceRegulationRequests,
  requestDetails,
  restoreRegulationRequests,
} from "./requests.js";
import {
  bindingForRun,
  bindingRevisionId,
  type CoordinatorFact,
  type CoordinatorState,
  createCoordinatorState,
  currentResources,
  dependencies,
  type ExecutionLimits,
  eventsSince,
  type ResourceAllocation,
  type Run,
  type RunOutcome,
  reduceCoordinatorState,
  requestCancelled,
  requestClosed,
  requestEmission,
  restoreCoordinatorState,
  runViews,
} from "./state.js";
import type { CoordinatorStore } from "./store.js";
import { fields, immutable, positive } from "./validation.js";

const ownedStores = new WeakSet<CoordinatorStore>();

async function releaseStore(store: CoordinatorStore) {
  await store.close();
  ownedStores.delete(store);
}

export interface RunResult {
  readonly outcome: RunOutcome;
  readonly observation?: Envelope<PilotObservation>;
  readonly dependencies?: readonly (RequestCommand | { readonly requestRef: string })[];
}

export interface RunHandle {
  /** Settlement is proof of actual external termination, including rejection. */
  readonly result: Promise<RunResult>;
  readonly abort: () => Promise<void>;
  /** Resolution confirms actual termination; rejection does not release capacity. */
  readonly kill: () => Promise<void>;
}

export type Recovery =
  | { readonly kind: "attached"; readonly handle: RunHandle }
  | { readonly kind: "ended"; readonly result: RunResult }
  | { readonly kind: "unknown" };

export interface RunnerContext {
  readonly run: Run;
  readonly details: RequestDetails;
  readonly binding: AgentBinding;
  readonly report: (observation: Envelope<PilotObservation>) => Promise<void>;
  readonly reportProbeFailure: (probedAt: string, message: string) => Promise<void>;
}

export interface BehaviorCoordinatorOptions {
  readonly hostId: string;
  readonly store: CoordinatorStore;
  readonly limits: ExecutionLimits;
  readonly maxAttemptsPerRequest: number;
  readonly maxDependencyRequests: number;
  readonly abortGraceMs: number;
  readonly runner: {
    /** A thrown start must guarantee that no external execution was launched. */
    readonly start: (context: RunnerContext) => RunHandle;
    readonly recover: (context: RunnerContext) => Promise<Recovery>;
  };
  /** Mandatory out-of-band diagnostics, also used when persistence itself fails. */
  readonly onError: (error: unknown) => void;
}

export interface BehaviorCoordinator {
  readonly changes: Stream.Stream<CoordinatorState>;
  readonly snapshot: () => CoordinatorState;
  readonly flush: () => Promise<void>;
  readonly eventsSince: (afterRevision?: number) => ReturnType<typeof eventsSince>;
  readonly cancel: (requestRef: string, scope?: "request" | "recurrence") => Promise<void>;
}

class Service {
  private tail: Promise<void> = Promise.resolve();
  private failed: Error | undefined;
  private closing = false;
  private readonly handles = new Map<string, RunHandle>();
  private readonly watched = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly terminations = new Map<string, Promise<void>>();
  private initialized = false;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private state: CoordinatorState,
    private readonly output: SubscriptionRef.SubscriptionRef<CoordinatorState>,
    private readonly options: BehaviorCoordinatorOptions,
  ) {}

  snapshot = () => this.state;
  eventsSince = (afterRevision = 0) => eventsSince(this.state, afterRevision);

  cancel = (requestRef: string, scope: "request" | "recurrence" = "recurrence") =>
    this.enqueue(async () => {
      if (this.closing) throw new Error("Coordinator is closing.");
      requestDetails(this.state.requests, requestRef);
      if (
        !this.state.events.some(
          ({ fact }) =>
            fact.type === "request-cancel" &&
            fact.requestRef === requestRef &&
            fact.scope === scope,
        )
      )
        await this.commit({ type: "request-cancel", requestRef, scope });
    });

  private reportError(error: unknown) {
    try {
      this.options.onError(error);
    } catch (diagnosticError) {
      this.failed = new AggregateError(
        [error, diagnosticError],
        "Coordinator diagnostic callback failed.",
      );
    }
  }

  flush = async () => {
    for (;;) {
      const pending = this.tail;
      await pending;
      if (this.failed !== undefined) throw this.failed;
      if (pending === this.tail) return;
    }
  };

  private async commit(fact: CoordinatorFact, occurredAt = new Date().toISOString()) {
    const next = reduceCoordinatorState(
      { revision: this.state.revision + 1, occurredAt, fact },
      this.state,
    );
    await this.options.store.save(next);
    this.state = next;
    await Effect.runPromise(SubscriptionRef.set(this.output, next));
  }

  private context(run: Run): RunnerContext {
    return {
      run,
      details: requestDetails(this.state.requests, run.requestRef),
      binding: bindingForRun(this.state, run),
      report: (observation) =>
        this.enqueue(async () => {
          await this.commit({ type: "observation", runId: run.id, observation });
        }),
      reportProbeFailure: (probedAt, message) =>
        this.enqueue(() => this.commit({ type: "probe-error", runId: run.id, probedAt, message })),
    };
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const task = this.tail.then(async () => {
      if (this.failed !== undefined) throw this.failed;
      await operation();
      if (this.initialized && !this.closing) await this.schedule();
    });
    this.tail = task.catch((error: unknown) => {
      this.failed = error instanceof Error ? error : new Error(String(error));
      this.reportError(error);
    });
    return task;
  }

  private observeFailure(task: Promise<void>) {
    void task.catch((error: unknown) => {
      if (this.failed !== error) {
        this.failed = error instanceof Error ? error : new Error(String(error));
        this.reportError(error);
      }
    });
  }

  private async fault(kind: string, error: unknown, run?: Run) {
    this.reportError(error);
    await this.commit({
      type: "fault",
      fault: {
        kind,
        message: error instanceof Error ? error.message : String(error),
        targetKey:
          run === undefined ? null : requestDetails(this.state.requests, run.requestRef).target.key,
        requestRef: run?.requestRef ?? null,
        runId: run?.id ?? null,
      },
    });
  }

  private attach(run: Run, handle: RunHandle) {
    this.handles.set(run.id, handle);
    if (this.watched.has(run.id)) throw new Error("Run handle is already supervised.");
    this.watched.add(run.id);
    const start = this.state.events.find(
      ({ fact }) => fact.type === "run-start" && fact.run.id === run.id,
    );
    if (start === undefined) throw new TypeError("Missing durable start time.");
    const elapsed = Date.now() - Date.parse(start.occurredAt);
    const remaining = elapsed < 0 ? 0 : Math.max(0, run.limits.timeoutMs - elapsed);
    this.timers.set(
      run.id,
      setTimeout(() => {
        this.observeFailure(
          this.enqueue(async () => {
            if (!this.handles.has(run.id)) return;
            if (runViews(this.state).find((view) => view.run.id === run.id)?.phase !== "stopping")
              await this.commit({
                type: "run-phase",
                runId: run.id,
                phase: "stopping",
                reason: "timeout",
              });
            this.observeFailure(this.terminate(run, handle, "Execution time limit reached."));
          }),
        );
      }, remaining),
    );
    this.observeFailure(
      handle.result.then(
        (result) => this.enqueue(() => this.finish(run, result)),
        (error: unknown) =>
          this.enqueue(async () => {
            await this.fault("execution", error, run);
            await this.finish(run, { outcome: { kind: "error", message: String(error) } });
          }),
      ),
    );
  }

  private async finish(run: Run, result: RunResult) {
    if (runViews(this.state).find((view) => view.run.id === run.id)?.phase === "ended") return;
    if (
      result.outcome.kind !== "target-reached" &&
      this.state.events.some(
        ({ fact }) =>
          fact.type === "run-phase" && fact.runId === run.id && fact.reason === "timeout",
      )
    )
      result = {
        outcome: {
          kind: "exhausted",
          reason: "timeout",
          message: "Execution time limit reached.",
        },
      };
    let candidate = this.state;
    const append = (fact: CoordinatorFact) => {
      candidate = reduceCoordinatorState(
        {
          revision: candidate.revision + 1,
          occurredAt: new Date().toISOString(),
          fact,
        },
        candidate,
      );
    };
    const report = (kind: string, error: unknown) => {
      this.reportError(error);
      append({
        type: "fault",
        fault: {
          kind,
          message: String(error),
          requestRef: run.requestRef,
          runId: run.id,
          targetKey: requestDetails(candidate.requests, run.requestRef).target.key,
        },
      });
    };
    if (result.observation !== undefined) {
      const phase = runViews(candidate).find((view) => view.run.id === run.id)?.phase;
      if (phase === "unverified") append({ type: "run-phase", runId: run.id, phase: "running" });
      if (phase !== "stopping") {
        try {
          append({ type: "observation", runId: run.id, observation: result.observation });
        } catch (error) {
          report("invalid-observation", error);
          result = { outcome: { kind: "error", message: String(error) } };
        }
      }
    }
    let outcome = result.outcome;
    try {
      append({ type: "run-end", runId: run.id, outcome });
    } catch (error) {
      report("invalid-result", error);
      outcome = { kind: "error", message: String(error) };
      append({ type: "run-end", runId: run.id, outcome });
    }
    let waiting = false;
    if (
      !requestClosed(candidate, run.requestRef) &&
      outcome.kind === "blocked" &&
      result.dependencies?.length
    ) {
      const beforeDependencies = candidate;
      try {
        for (const command of result.dependencies) {
          if ("type" in command) {
            if (
              command.origin.kind !== "dependency" ||
              command.origin.consumerRequestRef !== run.requestRef
            )
              throw new TypeError("Provider request must identify its consumer.");
          } else fields(command, ["requestRef"]);
          const existing = candidate.requests.requests.find(
            ({ ref }) => ref === command.requestRef,
          );
          if (existing === undefined && "type" in command) append({ type: "request", command });
          else if (existing === undefined) throw new TypeError("Unknown shared provider request.");
          else if ("type" in command) reduceRegulationRequests(command, candidate.requests);
          if (!dependencies(candidate, run.requestRef).includes(command.requestRef))
            append({
              type: "dependency",
              consumerRequestRef: run.requestRef,
              providerRequestRef: command.requestRef,
            });
        }
        for (const root of candidate.requests.requests.filter(
          (request) =>
            request.origin.kind !== "dependency" && !requestClosed(candidate, request.ref),
        )) {
          const reached = new Set<string>();
          const visit = (reference: string) => {
            if (reached.has(reference)) return;
            reached.add(reference);
            if (reached.size > this.options.maxDependencyRequests + 1)
              throw new TypeError("Dependency request limit exceeded.");
            for (const provider of dependencies(candidate, reference)) visit(provider);
          };
          visit(root.ref);
        }
        waiting = true;
      } catch (error) {
        candidate = beforeDependencies;
        report("dependency", error);
      }
    }
    if (!waiting && !requestClosed(candidate, run.requestRef))
      append({ type: "request-close", requestRef: run.requestRef, reason: "finished" });
    // Termination, local closure and dependency installation share one durable boundary.
    await this.options.store.save(candidate);
    this.state = candidate;
    this.handles.delete(run.id);
    clearTimeout(this.timers.get(run.id));
    this.timers.delete(run.id);
    await Effect.runPromise(SubscriptionRef.set(this.output, candidate));
  }

  private terminate(run: Run, handle: RunHandle, reason: string): Promise<void> {
    const previous = this.terminations.get(run.id);
    if (previous !== undefined) return previous;
    const operation = this.terminateOnce(run, handle, reason).catch((error: unknown) => {
      this.terminations.delete(run.id);
      throw error;
    });
    this.terminations.set(run.id, operation);
    return operation;
  }

  private async terminateOnce(run: Run, handle: RunHandle, reason: string) {
    const abort = Promise.resolve()
      .then(() => handle.abort())
      .catch((error: unknown) => {
        this.reportError(error);
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      handle.result.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), this.options.abortGraceMs);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    void abort;
    if (settled) return;
    try {
      await handle.kill();
    } catch (error) {
      this.reportError(error);
      throw error;
    }
    if (this.failed === undefined)
      await this.enqueue(() =>
        this.finish(run, { outcome: { kind: "cancelled", message: reason } }),
      );
  }

  async initialize(allocation: ResourceAllocation, requests: RegulationRequests) {
    await this.updateResources(allocation);
    await this.updateRequests(requests);
    await this.enqueue(async () => {
      for (const view of runViews(this.state).filter(({ phase }) => phase !== "ended")) {
        if (view.phase !== "unverified")
          await this.commit({ type: "run-phase", runId: view.run.id, phase: "unverified" });
        const recovery = await this.options.runner.recover(this.context(view.run));
        if (recovery.kind === "attached") {
          await this.commit({ type: "run-phase", runId: view.run.id, phase: "running" });
          this.attach(view.run, recovery.handle);
        } else if (recovery.kind === "ended") {
          await this.finish(view.run, recovery.result);
        } else if (recovery.kind === "unknown") {
          await this.fault(
            "recovery-unknown",
            new Error(`Cannot verify ${view.run.id}.`),
            view.run,
          );
        } else {
          throw new TypeError("Unsupported recovery result.");
        }
      }
      this.initialized = true;
    });
  }

  updateResources = (allocation: ResourceAllocation) =>
    this.enqueue(async () => {
      if (this.closing) return;
      if (canonicalJson(currentResources(this.state).allocation) !== canonicalJson(allocation))
        await this.commit({ type: "resources", allocation });
    });

  updateRequests = (snapshot: RegulationRequests) =>
    this.enqueue(async () => {
      if (this.closing) return;
      const incoming = restoreRegulationRequests(snapshot);
      let candidate = this.state;
      const append = (fact: CoordinatorFact) => {
        candidate = reduceCoordinatorState(
          {
            revision: candidate.revision + 1,
            occurredAt: new Date().toISOString(),
            fact,
          },
          candidate,
        );
      };
      for (const request of incoming.requests) {
        const command = commandForRequest(incoming, request.ref);
        const previous = candidate.requests.requests.find(({ ref }) => ref === request.ref);
        if (previous !== undefined) {
          if (
            canonicalJson(commandForRequest(candidate.requests, request.ref)) !==
            canonicalJson(command)
          )
            throw new TypeError(`Conflicting shared request ${request.ref}.`);
          continue;
        }
        append({ type: "request", command });
        if (request.replacesRequestRef !== undefined) {
          append({
            type: "request-cancel",
            requestRef: request.replacesRequestRef,
            scope: "recurrence",
          });
        } else if (request.origin.kind === "external" && request.eligibleAt === undefined) {
          for (const older of candidate.requests.requests) {
            if (
              older.ref !== request.ref &&
              older.targetKey === request.targetKey &&
              older.origin.kind === "external" &&
              older.eligibleAt === undefined &&
              !requestClosed(candidate, older.ref)
            )
              append({
                type: "request-close",
                requestRef: older.ref,
                reason: "superseded",
              });
          }
        } else if (request.origin.kind === "dependency") {
          append({
            type: "dependency",
            consumerRequestRef: request.origin.consumerRequestRef,
            providerRequestRef: request.ref,
          });
        }
        if (request.desiredLevel === "initial")
          append({ type: "request-close", requestRef: request.ref, reason: "initial" });
      }
      if (candidate !== this.state) {
        await this.options.store.save(candidate);
        this.state = candidate;
        await Effect.runPromise(SubscriptionRef.set(this.output, candidate));
      }
    });

  private async schedule() {
    clearTimeout(this.wakeTimer);
    this.wakeTimer = undefined;
    for (const request of this.state.requests.requests) {
      if (request.origin.kind !== "dependency" || requestClosed(this.state, request.ref)) continue;
      const demanded = this.state.requests.requests.some(
        (consumer) =>
          !requestClosed(this.state, consumer.ref) &&
          dependencies(this.state, consumer.ref).includes(request.ref),
      );
      if (!demanded)
        await this.commit({ type: "request-close", requestRef: request.ref, reason: "superseded" });
    }
    for (const view of runViews(this.state)) {
      if (view.phase === "ended" || view.phase === "stopping" || view.phase === "unverified")
        continue;
      const request = requestDetails(this.state.requests, view.run.requestRef).request;
      // An initial replacement revokes the work; other replacements drain naturally.
      const initialReplacement = this.state.requests.requests.some(
        (entry) =>
          entry.targetKey === request.targetKey &&
          entry.desiredLevel === "initial" &&
          entry.eligibleAt === undefined &&
          request.eligibleAt === undefined &&
          this.state.requests.requests.indexOf(entry) >
            this.state.requests.requests.indexOf(request),
      );
      const handle = this.handles.get(view.run.id);
      if (
        (initialReplacement ||
          request.origin.kind === "dependency" ||
          requestCancelled(this.state, request.ref)) &&
        handle !== undefined &&
        requestClosed(this.state, request.ref)
      ) {
        await this.commit({ type: "run-phase", runId: view.run.id, phase: "stopping" });
        this.observeFailure(this.terminate(view.run, handle, "Request revoked local execution."));
      }
    }
    for (const request of [...this.state.requests.requests].sort(
      (a, b) => a.priority - b.priority,
    )) {
      if (requestClosed(this.state, request.ref)) continue;
      if (request.eligibleAt !== undefined && Date.parse(request.eligibleAt) > Date.now()) continue;
      if (request.desiredLevel === "initial") {
        await this.commit({ type: "request-close", requestRef: request.ref, reason: "initial" });
        continue;
      }
      const runs = runViews(this.state);
      if (
        this.state.requests.requests.some(
          (other) =>
            other.ref !== request.ref &&
            other.targetKey === request.targetKey &&
            !requestClosed(this.state, other.ref) &&
            requestEmission(this.state, other.ref) !== undefined,
        ) ||
        runs.some(
          ({ run, phase }) =>
            phase !== "ended" &&
            requestDetails(this.state.requests, run.requestRef).target.key === request.targetKey,
        )
      )
        continue;
      const providers = dependencies(this.state, request.ref);
      if (providers.some((provider) => !requestClosed(this.state, provider))) continue;
      const attempts = runs.filter(({ run }) => run.requestRef === request.ref);
      if (
        attempts.length >= this.options.maxAttemptsPerRequest ||
        providers.some(
          (provider) =>
            requestDetails(this.state.requests, provider).request.desiredLevel !== "initial" &&
            !runs.some(
              ({ run, outcome }) =>
                run.requestRef === provider && outcome?.kind === "target-reached",
            ),
        )
      ) {
        await this.commit({ type: "request-close", requestRef: request.ref, reason: "finished" });
        continue;
      }
      const resources = currentResources(this.state);
      if (resources.allocation.kind === "no-resource") continue;
      const available = resources.allocation.bindings.find(
        ({ binding, capacity }) =>
          runs.filter(
            ({ run, phase }) =>
              phase !== "ended" && bindingForRun(this.state, run).id === binding.id,
          ).length < capacity,
      );
      if (available === undefined) continue;
      const previousAttempt = attempts.at(-1);
      const run: Run = immutable({
        id: `${this.state.hostId}:${this.state.revision + 1}`,
        requestRef: request.ref,
        resourceRevision: resources.revision,
        hostBindingRevisionId: bindingRevisionId(this.state.hostId, available.binding),
        limits: this.options.limits,
        ...(previousAttempt === undefined ? {} : { continuedFromRunId: previousAttempt.run.id }),
      });
      const occurredAt = new Date().toISOString();
      const successor: RequestCommand | undefined =
        attempts.length === 0 && request.recurrence !== undefined
          ? {
              type: "request",
              requestRef: identityKey("recurrence-request", [this.state.hostId, request.ref]),
              objective: requestDetails(this.state.requests, request.ref).objectiveRevision.spec,
              subject: requestDetails(this.state.requests, request.ref).target.subject,
              desiredLevel: request.desiredLevel,
              priority: request.priority,
              origin: { kind: "recurrence", predecessorRequestRef: request.ref },
              eligibleAt: new Date(
                Date.parse(occurredAt) + request.recurrence.intervalMs,
              ).toISOString(),
              recurrence: request.recurrence,
            }
          : undefined;
      await this.commit(
        { type: "run-start", run, ...(successor === undefined ? {} : { successor }) },
        occurredAt,
      );
      let handle: RunHandle;
      try {
        handle = this.options.runner.start(this.context(run));
      } catch (error) {
        await this.fault("start", error, run);
        await this.finish(run, { outcome: { kind: "error", message: String(error) } });
        continue;
      }
      this.attach(run, handle);
      await this.commit({ type: "run-phase", runId: run.id, phase: "running" });
    }
    const now = Date.now();
    const next = this.state.requests.requests
      .filter(
        (request) =>
          !requestClosed(this.state, request.ref) &&
          requestEmission(this.state, request.ref) === undefined &&
          request.eligibleAt !== undefined &&
          Date.parse(request.eligibleAt) > now,
      )
      .map((request) => Date.parse(request.eligibleAt ?? ""))
      .sort((a, b) => a - b)[0];
    if (next !== undefined)
      this.wakeTimer = setTimeout(
        () => {
          this.wakeTimer = undefined;
          if (!this.closing && this.failed === undefined)
            this.observeFailure(this.enqueue(async () => {}));
        },
        Math.min(next - now, 2_147_483_647),
      );
  }

  async close() {
    this.closing = true;
    clearTimeout(this.wakeTimer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await this.tail;
    const stops = [...this.handles].map(async ([id, handle]) => {
      const run = runViews(this.state).find(({ run }) => run.id === id)?.run;
      if (run === undefined) throw new Error("Missing run during cleanup.");
      if (this.failed === undefined)
        await this.enqueue(() => this.commit({ type: "run-phase", runId: id, phase: "stopping" }));
      await this.terminate(run, handle, "Confirmed termination during shutdown.");
    });
    await Promise.all(stops);
    await this.tail;
    await releaseStore(this.options.store);
    if (this.failed !== undefined) throw this.failed;
  }
}

export function coordinator(
  resources: SubscriptionRef.SubscriptionRef<ResourceAllocation>,
  requests: SubscriptionRef.SubscriptionRef<RegulationRequests>,
  options: BehaviorCoordinatorOptions,
): Effect.Effect<BehaviorCoordinator, Error, Scope.Scope> {
  return Effect.gen(function* () {
    if (ownedStores.has(options.store))
      return yield* Effect.fail(new Error("Coordinator store already has an active owner."));
    ownedStores.add(options.store);
    if (
      !positive(options.maxAttemptsPerRequest) ||
      !positive(options.maxDependencyRequests) ||
      !positive(options.abortGraceMs) ||
      !Object.values(options.limits).every(positive)
    ) {
      yield* Effect.promise(() => releaseStore(options.store));
      return yield* Effect.fail(new TypeError("Invalid trusted Coordinator options."));
    }
    const service = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          try {
            const saved = await options.store.load();
            const state =
              saved === null
                ? createCoordinatorState(options.hostId)
                : restoreCoordinatorState(saved);
            if (state.hostId !== options.hostId)
              throw new TypeError("Snapshot belongs to another Host.");
            const output = await Effect.runPromise(SubscriptionRef.make(state));
            return {
              engine: new Service(state, output, {
                ...options,
                limits: immutable(structuredClone(options.limits)),
              }),
              output,
            };
          } catch (error) {
            await releaseStore(options.store);
            throw error;
          }
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      ({ engine }) => Effect.promise(() => engine.close()),
    );
    yield* Effect.tryPromise({
      try: async () =>
        service.engine.initialize(
          await Effect.runPromise(SubscriptionRef.get(resources)),
          await Effect.runPromise(SubscriptionRef.get(requests)),
        ),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });
    yield* SubscriptionRef.changes(resources).pipe(
      Stream.runForEach((value) => Effect.promise(() => service.engine.updateResources(value))),
      Effect.forkScoped,
    );
    yield* SubscriptionRef.changes(requests).pipe(
      Stream.runForEach((value) => Effect.promise(() => service.engine.updateRequests(value))),
      Effect.forkScoped,
    );
    return {
      changes: SubscriptionRef.changes(service.output),
      snapshot: service.engine.snapshot,
      flush: service.engine.flush,
      eventsSince: service.engine.eventsSince,
      cancel: service.engine.cancel,
    };
  });
}
