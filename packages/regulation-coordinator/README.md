# @potential-guide/regulation-coordinator

An independent, scoped, command-driven Regulation scheduler. It does not call,
wrap, replace or reconnect the existing Portfolio Planner/Coordinator/Supervisor.
Only their public pure validation/ranking/capability helpers and runner types are
reused. There is one internal priority queue and a runtime-discovered dependency
graph per acquisition; neither is an input snapshot.

## Simplified-design request model

`RequestModel` is an additive, pure foundation for the revised Coordinator design.
The new `coordinator` consumes this model. The existing `regulationCoordinator`
remains the legacy five-command scheduler; existing callers are not reconnected.

```ts
import { RequestModel } from "@potential-guide/regulation-coordinator";

const requests = RequestModel.reduceRegulationRequests({
  type: "request",
  requestRef: "a-stable-reference-supplied-by-the-caller",
  objective: exactPilotSpec,
  subject: {},
  desiredLevel: "terminal",
  priority: 0,
  origin: { kind: "external" },
}, RequestModel.createRegulationRequests());

const details = RequestModel.requestDetails(requests, requests.requests[0]!.ref);
const restored = RequestModel.restoreRegulationRequests(
  JSON.parse(JSON.stringify(requests)),
);
```

The reducer admits immutable Objective, ObjectiveRevision, Target and Request
facts. Objective identity uses the validated Git repository and directory, Target
adds the subject, and ObjectiveRevision adds the **commit**, not the path tree
hash. Keys use version-1 SHA-256 identity encoding with locale-independent JSON
property ordering. Git address aliases are not merged. The existing exact
`PilotSpec` transport is retained here; the proposed new source-string protocol
is not implemented.

Request references are supplied, not randomly generated or allocated during
replay. The same reference and normalized contents are an idempotent redelivery;
conflicting contents fail explicitly. A new reference preserves a new occurrence
even for identical values. Dependency requests use the same command and refer to
an already admitted consumer request. Subject and desired level are validated
against the pinned definition; `terminal` resolves to its highest business level
and `initial` does not execute checks.

The model's `revision` is a local projection counter, **not** a global request
sequence, Coordinator execution version or persistence cursor. The arrays are an
append-only admission prefix, not a scheduling queue or a cross-Host latest-request
decision. `requestDetails` resolves the request's fixed relationships, never a
target's latest request. Each consuming Host can admit the same shared reference.
Reference allocation, global ordering, conflict coordination and selection of
current requests remain outside this first increment.

New states are cloned and deeply frozen without freezing inputs. Snapshot restore
rebuilds and checks facts and references instead of trusting serialized keys or
indexes. Only complete version-1 prefixes are supported; compaction and migration
are not implied. Restore and replay perform no runner, filesystem, network or
clock effects. The Behavior runtime below adds execution and resource facts.

## Resources-first Behavior runtime

```ts
import { Effect, SubscriptionRef } from "@potential-guide/effects";
import {
  coordinator, CoordinatorModel, RequestModel, openCoordinatorStore,
  type BehaviorCoordinatorOptions,
} from "@potential-guide/regulation-coordinator";

export const serveCoordinator = (
  profileDirectory: string,
  options: Omit<BehaviorCoordinatorOptions, "store">,
) => Effect.scoped(Effect.gen(function* () {
  const resources = yield* SubscriptionRef.make<CoordinatorModel.ResourceAllocation>({
    kind: "no-resource",
  });
  const requests = yield* SubscriptionRef.make(RequestModel.createRegulationRequests());
  const store = yield* Effect.promise(() => openCoordinatorStore(profileDirectory));
  const service = yield* coordinator(resources, requests, { ...options, store });
  // Subscribe to service.changes and publish complete input snapshots in this scope.
  yield* Effect.never;
}));
```

`coordinator(resources, requests, options)` acquires one serialized scheduler.
`changes` plus `snapshot()` expose its read-only state Behavior; subscribing does
not create executions. `flush()` waits for submitted mailbox work and surfaces a
failed service. Request and resource updates are complete snapshots. Request
facts are retained, not deleted when a later snapshot omits them.

Configured allocation contains `bindings: [{ binding, capacity }]`; capacities
are nonnegative integers, binding IDs unique within a snapshot. `no-resource` and
zero capacity start no new work. Shrinking capacity, removing or changing a
binding drains existing executions naturally; historical Run bindings retain
their pinned configuration. Pending external requests use ascending priority,
then local admission order, not a claimed cross-Host global order. A newer
external request for the same Target supersedes the older **local** demand.
An `initial` replacement stops old work and never invokes a business check.
Other replacements drain the old Run before starting the new local request.

The mandatory runner supplies `start(context)` and `recover(context)`. No
Coordinator grants/ceiling or additional authorization approval is introduced:
the runner operates under its real delegated resource identity and reports
resource refusals as results or errors. Binding configuration must contain only
non-secret data or credential references. The immutable Run references its exact
Request and actual resource revision.

- `start` returns `{ result, abort, kill }` synchronously. If it throws, it must
  guarantee no external execution launched. A process-spawn error after returning
  the handle belongs on `result`. Reports must begin after the handle is returned.
- `result` settlement, including rejection, confirms actual external exit.
  An abort request alone never frees capacity; successful `kill()` must confirm
  termination. Abort grace and the Run's persisted timeout are enforced by the
  service. A failed kill fails the service while retaining unconfirmed occupancy.
- `context.report` records validated successful observations; `reportProbeFailure`
  records a failed Probe with its actual time. Await these callbacks and supply
  Probe completion facts in their real per-run order. Old/invalid successful
  evidence is rejected, not used for a new request.
- A `blocked` result can return dependency commands with explicit consumer origin,
  or `{ requestRef }` for an existing shared provider. The provider has its own
  Request before its Run. Terminal result, dependency installation and local
  demand closure commit atomically. Cycles and per-root `maxDependencyRequests`
  limits reject the entire dependency installation. `maxAttemptsPerRequest`
  bounds repeated consumer attempts without resetting on restart.
- Providers remain while any open local consumer needs them; removing the last
  demand stops orphaned provider execution. Provider success only permits a new
  consumer Run to observe reality again, never marks the consumer successful.

The store is exclusively owned by the service. `openCoordinatorStore(directory)`
uses an OS-backed SQLite exclusive file lock held for the profile lifetime,
independent of hostId, and atomic flushed snapshot replacement. It does not use
file existence as a mutex. A missing previously initialized snapshot, malformed
JSON or inconsistent event prefix fails explicitly. This is a local profile
adapter, not network storage or a cross-device identity lock. Node's SQLite API
may emit an experimental warning on supported Node 22 releases.

Every launch intent is persisted **before** invoking the runner. Recovery marks
previous active executions unverified and calls `recover` with the same stable
Run identity and pinned binding. The adapter must reconcile external operations
by that identity, including a crash between durable intent and start. It returns
an attached handle, a confirmed terminal result, or `unknown`; the latter retains
capacity and blocks duplicate local work. Recovery does not reset elapsed Run
timeouts or re-run closed requests. `onError` is mandatory, including for storage
failures which cannot be reliably written back to that same storage.

Scope exit stops input subscriptions, requests termination, waits for confirmed
exit/kill, then releases the store. If termination cannot be confirmed, cleanup
fails rather than releasing the ownership lock with a known live handle; the
owner must resolve the external execution or let the process exit for OS lock
release. Pure replay itself performs no external execution.

## Execution facts and observation views

`CoordinatorModel.reduceCoordinatorState(event, state)` is the second pure
reducer. Events form a contiguous Host-local revision prefix; append-only start,
resource, phase, observation, fault and closure facts reconstruct the same state.
`restoreCoordinatorState(unknown)` replays and compares the complete checkpoint,
including request references. There is no silent empty-state recovery or
unimplemented log-compaction fallback.

`coordinatorViews(states, contacts?, publications?)` produces Host, Objective,
Target, Request and Run projections from consistent per-Host snapshots. Views
are recomputed from facts, not separately writable caches. A shared Request
appears once with separate Host contributions. Local closure is **not** global
Request satisfaction; that remains `undetermined` without a distributed decision
protocol. Target Probe summaries remain per Host; a latest failure is not replaced
with an older success, and cross-device wall clocks do not decide ordering.

Host contact observations and authoritative latest Objective publication are
separate optional inputs, not inferred from idle event streams or commit hashes.
Absent inputs remain unknown. Supplied publications must reference a known
matching Objective revision. Views preserve source versions, Run timelines and
Fault provenance, and reject conflicting shared identities across Hosts.
This package supplies data, not frontend pages, central transport, publication
authority, global Request coordination or migration of existing services.

## Legacy API

```ts
import {
  Effect, Queue, Stream, SubscriptionRef,
} from "@potential-guide/effects";
import {
  regulationCoordinator,
  type AgentResource,
  type CoordinatorCommand,
  type CoordinatorOptions,
  type Regulation,
} from "@potential-guide/regulation-coordinator";

// The host provides an exact-version PilotSpec (including Git source evidence),
// subject, targetLevel, priority and ID. Configuration is trusted, not a command.
export const serve = (root: Regulation, options: CoordinatorOptions) =>
  Effect.scoped(Effect.gen(function* () {
    const resources = yield* SubscriptionRef.make<readonly AgentResource[]>([]);
    const commands = yield* Queue.bounded<CoordinatorCommand>(32);
    const coordinator = yield* regulationCoordinator(
      resources,                    // Behavior is always the first argument
      Stream.fromQueue(commands),   // requests, never facts or queue snapshots
      options,
    );
    yield* coordinator.events.pipe(
      Stream.runForEach((fact) => Effect.sync(() => console.log(fact))),
      Effect.forkScoped,
    );
    yield* Queue.offer(commands, {
      type: "add", commandId: "request-1", regulation: root,
    });
    // The host can subsequently publish resources and commands.
    // Remain in the scope until the application's explicit shutdown.
    yield* Effect.never;
  }));
```

`CoordinatorOptions` supplies `runner`, `resolveObjective`, immutable
`permissions`, per-execution `quota` and `agentExecutionLimits`, `maxConcurrency`,
`abortGraceMs`, total `budget`, and optional `bufferSize` (default 64).
Invalid trusted construction configuration is a defect, not a rejected command.
The runner accepts `RegulationInput, AgentResource` and returns
`{ result, abort, kill }`, structurally compatible with
`createProcessRegulationRunner` from `@potential-guide/pguide-regulate`.
`result` must settle **only after real termination**, including rejection.
`abort` is merely a request. `kill()` must resolve only on confirmed termination;
its rejection retains the slot until `result` actually settles.

An optional-to-use third runner argument is `ExecutionContext` with `runId`,
`work` and async `report(feedback)`. A two-argument existing runner is structurally
compatible. Requests and observation progress reported through this context enter
the same serialized mailbox; facts carry that exact run ID and work generation.
Obsolete/stopping runs or mismatched work are rejected as `stale-result`.
Reporting never grants authority or implicitly changes capability constraints.
Await `report` to honor backpressure.
For a process runner, construct it per start and adapt its callback to this
context (the adapter is owned by the host, not this library):

```ts
const runner = {
  start(input, resource, execution) {
    return createProcessRegulationRunner(profiles, cwd, (_input, request) => {
      void execution.report(request);
    }).start(input, resource);
  },
};
```

The legacy process callback is synchronous, so its host adapter must also bound
request production if it permits high-volume notifications; a producer ignoring
an async backpressure promise can create pending offers outside the service.

A runner hosting Regulation's `RegulationRuntime.onObservation` can bridge its
callback using the current execution context:

```ts
onObservation: (observation) => {
  void execution.report({ type: "observation", observation });
}
```

This callback follows the same producer-backpressure caveat as the synchronous
legacy process callback. The existing process runner does not automatically relay
observations; no legacy runner is changed here. Runners without progress reporting
still expose validated partial achievement through their final `latestObservation`.

Every root and resolved Pilot must include canonical Git Objective identity,
exact 40/64-character content version, and a validated `git-tree` source. This is
deliberately stricter than APIs that permit source-less in-memory Pilots.
The resolver receives `(objectiveId, exactVersion, exactSource, signal)` and
returns `{ spec, release }`. It must not resolve latest. Every successful
acquisition, including duplicates and stale/rejected candidates, is released
exactly once. Root spec ownership stays with the host.

## Commands and facts

| Command | Required fields beyond `type`, `commandId` | Result |
| --- | --- | --- |
| `add` | `regulation` | Creates a root, generation starts at 1 |
| `replace` | `regulation`, expected `generation` | Replaces that root; increments generation |
| `cancel` | root `id`, expected `generation` | Removes root ownership and old outgoing waits |
| `priority` | root `id`, expected `generation`, `priority` | Updates priority, without a new generation |
| `retry` | live blocked `id`, expected `generation` | Explicitly retries a root or derived provider |

Regulation fields are `id`, `objective`, `subject`, `targetLevel`, `priority`,
optional `requirements`, `language`, and exact `sourceBindings`. Extra command
or Regulation fields are rejected, including permission, grant, ceiling and budget
injection. IDs prefixed `$dependency:` are reserved for derived work. Duplicate
live root IDs, unknown/stale work, invalid subjects and negative/noninteger
priorities are rejected without mutating state. Cancel/re-add also increments
generation; accepted priorities retain FIFO order. `commandId` is correlation,
not an idempotency key or a retained command history.

Facts are the exported discriminated `CoordinatorEvent` union: `accepted`,
`rejected`, `started`, `result`, `dependencies`, `blocked`, `stopping`,
`terminated`, `stale-result`, `reclaimed`, `resources-accepted`, `input-ended`,
`capability-request`, `authorization-request`, `observation`, `failure`, and `closed`. They have a scope-local increasing `sequence`; work
references contain `id, generation`; execution facts contain `runId`. `result`
reports a validated Regulation outcome, **not** an assertion that every target
was met: inspect `stopReason`. Provider success never substitutes for a consumer
outcome. Published facts are cloned and deeply frozen.

`observation` is a validated progress fact, not provider completion. Its success
envelope must match the current run's Objective/version/full source and contain
valid levels, problems and a timestamp. Older timestamps within that run are
rejected; equal timestamps follow mailbox order. Invalid progress reports a
feedback failure without changing readiness.

## Lifetime, delivery and supervision

Acquisition starts exactly one mailbox loop and two input subscriptions. Output
subscriptions only attach consumers. Empty queues, completed work, no listeners,
and normal command-stream completion do not end the service. A later resource
update can unblock queued work after command completion. Scope closure stops
inputs, removes all root ownership, aborts active executions, waits for confirmed
termination, and releases owned resolver leases.

Both the mailbox and live multicast use bounded buffers. While subscribed,
facts are lossless and ordered: slow consumers backpressure the scheduler, which
backpressures input consumption. There is **no history/replay**. Events emitted
before subscription (or with no subscribers) are intentionally not retained;
subscribe before issuing requests when their acknowledgements matter. Attach
consumers in the same application scope and keep draining, or interrupt them
before closing the service, so a slow external consumer cannot deadlock shutdown.
Interrupting a subscription explicitly relinquishes its pending deliveries.
The upstream resource Behavior has its own storage policy; this service does not
promise to bound buffers owned by an external producer.

Cancellation and service close are mailbox messages, **not bypass lanes**. A full
PubSub can pause the loop, then a full mailbox can backpressure results, cancel,
and close alike. A consumer must not wait for cancellation/close acknowledgement
while also refusing to drain or cancel its subscription. `drain` means buffered
facts have been taken from the PubSub, not that arbitrary consumer side effects
have finished.

Recommended shutdown: acquire the service first, then fork its interruptible
event consumer with `Effect.forkScoped` in the **same** enclosing `Effect.scoped`.
On leaving that scope, LIFO finalization interrupts/unsubscribes the consumer and
input fibers before the service's execution cleanup, so cleanup does not wait for
its own live subscription. That subscription relinquishes pending/final cleanup
facts when interrupted. If cleanup facts must be consumed, use a separately owned
consumer that keeps draining until service close finishes, and only then stop it;
do not await close inside that consumer's blocked callback. Tests exercise both
same-scope interruption under full-buffer pressure and external drain-before-close.

Command/resource/execution/evidence/resolution/cleanup failures become attributable
facts. Invalid resources invalidate **all** new allocations and stop existing
work until a valid snapshot arrives; revoked binding/capabilities, removals and
capacity shrink also stop necessary runs. Source-stream errors are supervised
and reported, not automatically resubscribed (which could replay commands);
the unaffected input and feedback remain active. Genuine unhandled defects are
reported as infrastructure failures, close the output, and fail scope cleanup
rather than silently hanging or reporting successful cleanup.

A stopping run counts against resource capacity and global concurrency.
Nonnegative integer priorities sort ascending; equal priorities are FIFO.
P0 chooses the minimum number of non-P0, non-stopping victims needed on a
compatible resource and still waits for termination before starting. No automatic
retry follows start/execution/dependency/evidence/quota/authorization failures.
Blocked work can be explicitly retried (using its emitted work reference) or a
root replaced. Capability/capacity blocks remain queued and respond to resources.

## Dependency ownership and budget

Only a `dependency-required` outcome creates edges. Handoff envelope,
consumer Objective/version/source, dependency/problems equality, provider exact
source/version, schema-validated subject and ordered levels are checked.
Resolution is asynchronous outside the state transaction; generation/liveness
is checked before and after await. All candidate edges and additions pass a
complete cycle check before any graph mutation. Rejected candidates release all
leases. Conflicting exact source bindings are an explicit dependency failure,
never an implicit trust-domain merge.

Compatible providers share Objective/version/full source/subject/language identity
within this instance's single permission domain. Incoming consumers aggregate
strongest target level, highest priority and the union of required capabilities.
Strengthening a running execution's target or capabilities stops/requeues it.
Provider evidence only wakes consumers to run Regulation/observe again. Roots
anchor reachability; cancel/replace drops old outgoing waits, collects complete
unreferenced chains, retains shared/still-root providers, and confirms termination
before releasing a running provider's lease.

Each wait uses its **own minimum**, independently of the provider's aggregated
target. A current L1 observation can therefore wake an L1 consumer while the same
provider continues toward L3 and the L3 consumer remains waiting. Every validated
final outcome (including exhausted, authorization-required, dependency-required)
also records its actual observed level. This never completes the provider or its
consumers implicitly, retries the blocked provider, grants permissions, or refunds
budget. Each awakened consumer still runs its own Regulation with its own remaining
trusted allocation.

Readiness is the latest validated level, **not a historical maximum**: a newer
downgrade retracts unscheduled wakeups, a new start clears prior-run readiness,
and replacement generations cannot reuse an old run's evidence. A newer,
exact-source consumer handoff showing a lower provider level also invalidates the
cached high level, atomically with graph installation. A delayed resolver's older
handoff cannot overwrite newer direct progress. Final
`target-reached` is separately checked against the target captured at start, even
if later cancellation weakens the aggregate target; a prior progress report cannot
bypass that check.

Budget is a conservative scope-wide reservation policy, never a renewable
allowance: every start attempt (even one that throws) consumes one `maxStarts`
token, reserves the full `quota.maxAgentRuns` and full `quota.timeoutMs` against
`budget.maxAgentRuns/maxDurationMs`, and never refunds either. Replace, retry,
dependency discovery, preemption and resource revocation do not reset this total.
Stall history is carried forward monotonically. The default retry policy is
**zero automatic retries / no automatic backoff**; explicit attempts are bounded
by the remaining trusted reservations. Authorization-required work suspends;
commands cannot change grants. To change trusted authority or replenish budget,
the host must deliberately end the scope and construct a new instance.

All budget/quota/concurrency/termination values are mandatory trusted options;
there is no default one-start budget. Finite available starts are bounded by the
minimum of maxStarts and the two full-quota reservation ratios. The only optional
buffer setting defaults to 64.

`closed.cleanupFailures` records failed lease-release attempts; a prior
`failure(stage: "release")` identifies each one. Such failures are not reported
as clean source release and require host remediation. A failed `kill` does not
produce `closed` until real termination arrives. A runner/resolver that never
terminates/settles can therefore prevent safe closure; no timeout fabricates
cleanup success.

## Verification

`pnpm --filter @potential-guide/regulation-coordinator test` uses deterministic
injected runners and resolvers for command, scheduling, graph, failure and cleanup
counterexamples. Root test typechecking includes these tests; normal `pnpm check`
builds/packs this package and checks its public ESM and declarations from local
tarballs using the existing consumer checker. This is repository validation, not
npm publication or a global installation. No existing service is migrated.
