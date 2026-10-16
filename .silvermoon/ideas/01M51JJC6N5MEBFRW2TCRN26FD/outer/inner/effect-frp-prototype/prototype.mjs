import { Effect, Exit, Fiber, Stream, SubscriptionRef } from "effect";

export function startEffect(effect, parentSignal) {
  const controller = new AbortController();
  const signal =
    parentSignal === undefined
      ? controller.signal
      : AbortSignal.any([parentSignal, controller.signal]);
  // In 4.0.2 runFork can finish synchronous work before attaching an already-aborted signal.
  const fiber = Effect.runFork(signal.aborted ? Effect.interrupt : effect, { signal });
  return {
    signal,
    cancel: () => controller.abort(),
    exit: () => Effect.runPromise(Fiber.await(fiber)),
  };
}

export async function createLatestSlot(parentSignal) {
  const state = await Effect.runPromise(SubscriptionRef.make({ state: "initial" }));
  const running = new Set();
  let current;
  let generation = 0;
  let closed = false;

  return {
    state,
    replace(key, effect) {
      if (closed) throw new Error("Cannot replace an effect in a closed slot.");
      if (current?.key === key) return current.handle;
      const token = ++generation;
      current?.handle.cancel();
      const observed = effect.pipe(
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            // Cancellation cannot stop arbitrary external code; only the current owner may publish.
            if (closed || token !== generation) return Effect.void;
            const sample = Exit.isSuccess(exit)
              ? { state: "ready", key, value: exit.value }
              : Exit.hasInterrupts(exit)
                ? { state: "cancelled", key }
                : { state: "failed", key, cause: exit.cause };
            return SubscriptionRef.set(state, sample);
          }),
        ),
      );
      const handle = startEffect(observed, parentSignal);
      current = { key, handle };
      running.add(handle);
      // Observe completion through public Effect APIs, including already-completed fibers.
      void handle.exit().then(() => running.delete(handle));
      return handle;
    },
    async close() {
      closed = true;
      generation++;
      const pending = [...running];
      for (const handle of pending) handle.cancel();
      await Promise.all(pending.map((handle) => handle.exit()));
    },
  };
}

export function watchSnapshot(source, consume, signal) {
  return startEffect(
    SubscriptionRef.changes(source).pipe(
      Stream.runForEach((snapshot) => Effect.sync(() => consume(snapshot))),
    ),
    signal,
  );
}

export function projectInputs(snapshot) {
  return {
    pilotInput: [snapshot.pilotSpec, snapshot.subject],
    regulationInput: [
      {
        pilotSpec: snapshot.pilotSpec,
        regulationStrategy: snapshot.regulationStrategy,
        agentBinding: snapshot.agentBinding,
      },
      snapshot.subject,
    ],
  };
}

export function dependencyKeys(snapshot) {
  const { pilotInput, regulationInput } = projectInputs(snapshot);
  // Fixture identity only: this is not a production canonical-JSON or Objective URI algorithm.
  return {
    pilot: JSON.stringify(pilotInput),
    repair: JSON.stringify(regulationInput),
  };
}
