import { Cause, Effect, Exit, Fiber, Stream, SubscriptionRef } from "effect";

export * from "effect";

export interface RunningEffect<A, E = never> {
  readonly signal: AbortSignal;
  readonly fiber: Fiber.Fiber<A, E>;
  readonly cancel: () => void;
  readonly await: () => Promise<A>;
  readonly exit: () => Promise<Exit.Exit<A, E>>;
}

export function startEffect<A, E>(
  effect: Effect.Effect<A, E>,
  parentSignal?: AbortSignal,
): RunningEffect<A, E> {
  const controller = new AbortController();
  const signal =
    parentSignal === undefined
      ? controller.signal
      : AbortSignal.any([parentSignal, controller.signal]);
  // runFork may execute synchronous work before attaching an already-aborted signal.
  const fiber = Effect.runFork(signal.aborted ? Effect.interrupt : effect, { signal });
  return {
    signal,
    fiber,
    cancel: () => controller.abort(),
    await: () => Effect.runPromise(Fiber.join(fiber)),
    exit: () => Effect.runPromise(Fiber.await(fiber)),
  };
}

export type EffectSample<K, A, E> =
  | { readonly state: "initial" }
  | { readonly state: "ready"; readonly key: K; readonly value: A }
  | { readonly state: "failed"; readonly key: K; readonly cause: import("effect").Cause.Cause<E> }
  | { readonly state: "cancelled"; readonly key: K };

export interface LatestSlot<K, A, E> {
  readonly state: SubscriptionRef.SubscriptionRef<EffectSample<K, A, E>>;
  readonly replace: (key: K, effect: Effect.Effect<A, E>) => RunningEffect<A, E>;
  readonly close: () => Promise<void>;
}

export async function createLatestSlot<K, A, E = never>(
  parentSignal?: AbortSignal,
): Promise<LatestSlot<K, A, E>> {
  const state = await Effect.runPromise(
    SubscriptionRef.make<EffectSample<K, A, E>>({ state: "initial" }),
  );
  const running = new Set<RunningEffect<A, E>>();
  let current: { readonly key: K; readonly handle: RunningEffect<A, E> } | undefined;
  let generation = 0;
  let closed = false;
  let closing: Promise<void> | undefined;
  return {
    state,
    replace(key, effect) {
      if (closed) throw new Error("Cannot replace an effect in a closed slot.");
      if (current !== undefined && Object.is(current.key, key)) return current.handle;
      const token = ++generation;
      current?.handle.cancel();
      const started = startEffect(effect, parentSignal);
      // Observe the handle, not user code: a preabort bypasses even Effect.onExit.
      const completed = started.exit().then(async (exit) => {
        if (!closed && token === generation) {
          const sample: EffectSample<K, A, E> = Exit.isSuccess(exit)
            ? { state: "ready", key, value: exit.value }
            : Cause.hasInterrupts(exit.cause)
              ? { state: "cancelled", key }
              : { state: "failed", key, cause: exit.cause };
          await Effect.runPromise(SubscriptionRef.set(state, sample));
        }
        return exit;
      });
      const handle: RunningEffect<A, E> = {
        ...started,
        exit: () => completed,
        await: async () => {
          await completed;
          return started.await();
        },
      };
      current = { key, handle };
      running.add(handle);
      void handle.exit().then(() => running.delete(handle));
      return handle;
    },
    close() {
      if (closing !== undefined) return closing;
      closed = true;
      generation++;
      const pending = [...running];
      for (const handle of pending) handle.cancel();
      closing = Promise.all(pending.map((handle) => handle.exit())).then(() => undefined);
      return closing;
    },
  };
}

export function watchSnapshot<A>(
  source: SubscriptionRef.SubscriptionRef<A>,
  consume: (snapshot: A) => void,
  signal?: AbortSignal,
): RunningEffect<void> {
  return startEffect(
    SubscriptionRef.changes(source).pipe(
      Stream.runForEach((snapshot) => Effect.sync(() => consume(snapshot))),
    ),
    signal,
  );
}

/** Scope owns the subscription and every replaced computation, including its finalizers. */
export function activate<I, K, A, E>(
  source: SubscriptionRef.SubscriptionRef<I>,
  key: (input: I) => K,
  compute: (input: I) => Effect.Effect<A, E>,
): Effect.Effect<
  SubscriptionRef.SubscriptionRef<EffectSample<K, A, E>>,
  never,
  import("effect").Scope.Scope
> {
  return Effect.gen(function* () {
    const slot = yield* Effect.acquireRelease(
      Effect.promise(() => createLatestSlot<K, A, E>()),
      (slot) => Effect.promise(() => slot.close()),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        watchSnapshot(source, (input) =>
          slot.replace(
            key(input),
            Effect.suspend(() => compute(input)),
          ),
        ),
      ),
      (watcher) =>
        Effect.promise(async () => {
          watcher.cancel();
          await watcher.exit();
        }),
    );
    return slot.state;
  });
}
