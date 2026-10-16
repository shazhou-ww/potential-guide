# @potential-guide/effects

Thin lifecycle adapters over Effect 4.0.2. All native Effect exports (including
`Effect`, `Fiber`, `Exit`, `Cause`, `Stream`, `SubscriptionRef`, `Scope` and
`Schedule`) are re-exported, not reimplemented. Provide Effect services before
crossing the `startEffect` boundary.

```ts
import { Effect, startEffect } from "@potential-guide/effects";

const running = startEffect(Effect.succeed({ ok: false }), parentSignal);
const value = await running.await(); // { ok: false } is a successful business result
running.cancel(); // requests interruption; does not await resource cleanup
const exit = await running.exit(); // native Exit: success, failure or interruption
```

`startEffect` is lazy until called. An already-aborted parent never executes user
code, including synchronous effects. `cancel()` only sends cancellation;
`await()` and `exit()` wait for finalizers. `await()` rejects on invocation failure
or interruption; `exit()` preserves their native Cause. Cancellation cannot
promise termination of uncooperative external work. In particular, aborting an
HTTP fetch cancels the local request, not the server's business operation.

## Dependency-scoped replacement

`await createLatestSlot<K, A, E>(parentSignal?)` returns:

- `state`: a native `SubscriptionRef<EffectSample<K, A, E>>`, initially
  `{ state: "initial" }`. Completion publishes `ready` with `key` and `value`,
  `failed` with `key` and native `cause`, or `cancelled` with `key`.
- `replace(key, effect)`: retains the current handle for an `Object.is`-equal
  key. Otherwise it sends Abort before starting the replacement, without waiting
  for old finalizers. Keys must completely identify the computation's
  dependencies. A completed handle is also retained until its key changes.
- `close()`: idempotently prevents replacement, cancels all generations, and waits
  for cleanup. It can wait indefinitely for uninterruptible work.

A generation check prevents old completions from publishing over current work,
including uninterruptible effects and late callbacks. It cannot undo external
side effects. During replacement the ref retains the last sample until the new
computation exits; the sample's key identifies its provenance.

`watchSnapshot(ref, consume, parentSignal?)` observes native changes, including the
current value, and returns a `RunningEffect<void>`. Exceptions from `consume`
remain defects in its Exit, not successful observations.

`activate(ref, dependencyKey, compute)` is a scoped lifting adapter returning an
Effect of the result SubscriptionRef. The surrounding `Effect.scoped` owns the
input watcher, all generations and cleanup. The factory is suspended until
execution; failure is published in the result sample. Use native `Stream.map`
for pure projections rather than an alternative Behavior implementation.

Commit interdependent inputs as one complete root snapshot. Independent refs
combined with `Stream.zipLatestWith` do **not** become a transaction and can expose
mixed revisions. Use separate slots only for genuinely independent dependency
sets; business dependency splitting belongs to the caller.

## Validation

`pnpm --filter @potential-guide/effects test` covers the prototype's ten semantic
boundaries plus scoped lifting. `pnpm --filter @potential-guide/effects typecheck`
checks the production adapter against the native runtime types.
