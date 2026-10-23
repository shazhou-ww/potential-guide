import {
  Cause,
  Effect,
  Exit,
  Fiber,
  PubSub,
  Queue,
  type Scope,
  Stream,
  SubscriptionRef,
} from "@potential-guide/effects";
import { makeRegulationPermissions } from "@potential-guide/objective-regulator";
import { Engine, type Message } from "./engine.js";
import type {
  AgentResource,
  CoordinatorCommand,
  CoordinatorEvent,
  CoordinatorFact,
  CoordinatorOptions,
  RegulationCoordinator,
} from "./types.js";
import { immutable, positive } from "./validation.js";

export {
  type BehaviorCoordinator,
  type BehaviorCoordinatorOptions,
  coordinator,
  type Recovery,
  type RunHandle,
  type RunnerContext,
  type RunResult,
} from "./coordinator.js";
export * as RequestModel from "./requests.js";
export * as CoordinatorModel from "./state.js";
export { type CoordinatorStore, openCoordinatorStore } from "./store.js";
export * from "./types.js";
export { coordinatorViews, type HostContact, type ObjectivePublication } from "./views.js";

/** Acquisition, not output subscriptions, starts the single scheduler. */
export function regulationCoordinator<CommandError = never>(
  resources: SubscriptionRef.SubscriptionRef<readonly AgentResource[]>,
  commands: Stream.Stream<CoordinatorCommand, CommandError>,
  options: CoordinatorOptions,
): Effect.Effect<RegulationCoordinator, never, Scope.Scope> {
  return Effect.gen(function* () {
    const bufferSize = options.bufferSize ?? 64;
    if (
      !positive(bufferSize) ||
      !positive(options.maxConcurrency) ||
      !positive(options.abortGraceMs) ||
      !positive(options.budget.maxStarts) ||
      !positive(options.budget.maxAgentRuns) ||
      !positive(options.budget.maxDurationMs) ||
      !positive(options.quota.timeoutMs) ||
      !positive(options.quota.maxAgentRuns) ||
      !positive(options.quota.maxStallRuns) ||
      !positive(options.agentExecutionLimits.timeoutMs)
    )
      throw new TypeError("Invalid trusted Coordinator configuration.");
    const trusted: CoordinatorOptions = {
      ...options,
      budget: structuredClone(options.budget),
      quota: structuredClone(options.quota),
      agentExecutionLimits: structuredClone(options.agentExecutionLimits),
      permissions: makeRegulationPermissions(options.permissions),
    };
    const mailbox = yield* Queue.bounded<Message>(bufferSize);
    const facts = yield* PubSub.bounded<CoordinatorEvent>(bufferSize);
    let sequence = 0;
    let accepting = true;
    const post = async (message: Message) => {
      if (!accepting) return;
      try {
        await Effect.runPromise(Queue.offer(mailbox, message));
      } catch (error) {
        if (accepting) throw error;
      }
    };
    const emit = (fact: CoordinatorFact) =>
      Effect.runPromise(
        PubSub.publish(facts, immutable(structuredClone({ ...fact, sequence: ++sequence }))),
      ).then(() => undefined);
    const drainFacts = async () => {
      // Publishing acknowledges enqueue, not consumption. Drain before shutdown.
      while (PubSub.sizeUnsafe(facts) > 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
    };
    const engine = new Engine(trusted, emit, post);
    const loopEffect = Effect.forever(
      Queue.take(mailbox).pipe(
        Effect.flatMap((message) => Effect.promise(() => engine.handle(message))),
      ),
    ).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
          ? Effect.gen(function* () {
              accepting = false;
              yield* Effect.promise(() =>
                emit({
                  type: "failure",
                  stage: "infrastructure",
                  reason: Cause.pretty(exit.cause),
                }),
              );
              yield* Effect.promise(drainFacts);
              yield* PubSub.shutdown(facts);
              yield* Queue.shutdown(mailbox);
            })
          : Effect.void,
      ),
    );
    yield* Effect.acquireRelease(Effect.forkDetach(loopEffect), (loop) =>
      Effect.promise(async () => {
        await Promise.race([
          post({ type: "close" }).then(() => engine.drained),
          Effect.runPromise(Fiber.await(loop)).then((exit) => {
            if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
            throw new Error("Coordinator loop ended unexpectedly.");
          }),
        ]);
        accepting = false;
        await drainFacts();
      }).pipe(
        Effect.ensuring(
          Effect.interruptible(
            Effect.gen(function* () {
              accepting = false;
              yield* PubSub.shutdown(facts);
              yield* Queue.shutdown(mailbox);
              yield* Fiber.interrupt(loop);
            }),
          ),
        ),
      ),
    );
    const supervise = <E>(source: Stream.Stream<Message, E>, input: "commands" | "resources") =>
      source.pipe(
        Stream.runForEach((message) => Queue.offer(mailbox, message)),
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Queue.offer(mailbox, { type: "input-failure", input, error: Cause.pretty(cause) }),
          onSuccess: () => Queue.offer(mailbox, { type: "input-end", input }),
        }),
        Effect.forkScoped,
      );
    yield* supervise(
      commands.pipe(Stream.map((command): Message => ({ type: "command", command }))),
      "commands",
    );
    yield* supervise(
      SubscriptionRef.changes(resources).pipe(
        Stream.map((snapshot): Message => ({ type: "resources", resources: snapshot })),
      ),
      "resources",
    );
    return { events: Stream.fromPubSub(facts) };
  });
}
