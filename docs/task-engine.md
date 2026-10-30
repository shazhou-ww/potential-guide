# Generic task engine

The core `task-*` packages are a new generic engine, not a migration of the
existing checker/objective hosts. Register your own types; no business type,
schema library, HTTP server or artifact package is required.

For an explicitly started Node listener and CLI, use
[`@potential-guide/task-engine-server`](task-server.md); `check-task` separately
registers Check using this same Engine protocol. Neither migrates the old Hosts.

```ts
import { createTaskEngine } from "@potential-guide/task-engine";
import { openSqliteStore } from "@potential-guide/task-engine-storage";
import { createTaskHandler } from "@potential-guide/task-engine-http";

const store = openSqliteStore("tasks.sqlite");
const engine = createTaskEngine({
  store,
  types: [echoType],
  currentVersions: { echo: "1" },
  authorize: (caller, operation, scope) => policy(caller, operation, scope),
});
engine.start();
const handler = createTaskHandler({ service: engine, resolveCaller });
// The host mounts handler. Shutdown: await engine.close(); store.close().
```

## Type and execution contract

`TaskType<Input, Prepared=Input>` has `type`, immutable `version`, immutable
`environment`, pure `validate(unknown)` and `equals(Input, unknown)`, required
`prepare(Input, {signal, deadlineAt, context})`, `validatePrepared`, `validateResult`,
`validateProgress`, and `execute(Prepared, ExecuteOptions)`.
Validators return the original semantic value without coercion. All stored
values must be finite JSON: no getters, custom prototypes, sparse arrays,
toJSON conversion, cycles or undefined. Values passed into type code are frozen.
Business fields stay beside the Request envelope; validators should reject
unknown fields, including obsolete prerequisites. Identity prepare is valid.
Preparation `context` is the frozen Engine-bound type/version/environment/scope,
so source authorization never relies on body-supplied permissions. It is optional
in the public options type for older direct adapters; Engine always supplies it.
The optional `validateExecutionResult(result, prepared)` hook additionally validates
results against immutable execution content, including recovery/history reads.
Existing `validateResult` signatures remain unchanged; Check uses the new hook to
validate declared problems against the original verified Checker manifest rather
than a process-local cache.

Prepared must identify **actual immutable execution content**, not merely a
mutable URL. The engine compares complete Prepared canonical JSON alongside
type/version/environment/scope and `equals`; different resolved content cannot
share. Omitted executionMatch binds to `started-after-eligible`, but the raw
Request remains unchanged. Both “after” policies use strict greater-than.
Full Request idempotency does not use business equality. Retain original version
interpreters when upgrading; missing historical versions fail explicitly.

The optional `/pool` helper implements `execute`. Provide resource keys and
`run(prepared, permit, context) -> RunningWork`. The read-only context carries
Engine-bound type/version/environment/scope, never body-supplied credentials.
Pool obtains `options.start()` before
calling run: this synchronous handshake commits a fresh identity, trusted
startedAt and owner bindings before any business operation. execute returns
tracking at actual startup, not a final result. Never use the return receipt
time as startedAt. Report progress/completion via the permit; executors do not
write Task events or choose fact times.

`RunningWork` supplies result and physical `exited` promises, cooperative stop,
force and cleanup. Cleanup success is required before resource reuse. Force
must be real runtime isolation (worker/process termination); ordinary same-thread
Promises cannot be force-killed and must reject that capability. Cleanup/exit
failure quarantines capacity rather than adjusting a counter and overselling it.
The factory must either return a valid controllable RunningWork synchronously or
throw before creating work; asynchronous initialization belongs before the
business-start handshake or inside a controllable execution.

Pressure replacement is an Engine-issued candidate, never caller input.
Pool first uses free compatible capacity; otherwise it checks that the candidate
can provide the needed key, revalidates generation/owners with Engine, seals the
old execution, and confirms exit/cleanup before a fresh identity can start.
Task timeout alone does not stop running work. Independent execution wall limits,
last-owner cancellation and host close retain reclamation control.
Pool wakeups arriving during reclamation are replayed even when no slot is idle;
denied replacements wait for another real wakeup rather than busy-looping.
Wall limits use relative Clock scheduling, independently of business UTC clock
adjustments. A tracking identity or start time cannot be supplied by a Request.

## Lifecycle and durability

Submit preserves raw Request, original contract binding, IDs and deadlines.
Preparation and resource waiting consume the same eligible-anchored budget.
Expiration retracts unstarted work; running work may complete late. Cancellation
freezes the Task, not another owner's Execution. A durable eligible final fact
wins over a later cancel even if Task processing is delayed.
For an uncanceled, bound Task, time projection immediately uses the durable
Execution finish/failure timestamp. Until Task adjudication is committed, its
stage remains unchanged and no Task result or termination is fabricated. Thus
late observation followed by settlement cannot turn an on-time finish into a
temporary timeout and then revoke it.
Candidate matching, projection and bound completion settlement share the pure
`matchesExecutionTime` predicate. A binding does not bypass executionMatch if
the business clock moves backward. Inapplicable completion does not prohibit
cancellation or erase a timeout; execution faults remain distinct from normal
result applicability. Sealing forbids new owners, not a valid result for an
existing owner.

Recurrence requires explicit `eligible` or `terminated` anchor and positive
periodMs. Select the strictly future point on the original lattice and skip
missed rounds. Terminated timeout anchors at deadline, not detection time.
Each predecessor has one durable successor association; at most one derived
pending Task occupies the Series slot, but multiple eligible Tasks are allowed.
Capacity pressure leaves planning unconsumed. Cancellation creates no successor
and does not undo an already planned one.

SQLite uses WAL/FK/FULL, atomic events/idempotency/successors/checkpoint and one
active owner per local store. Startup projects existing finals before resuming
unstarted work. Started work without a reliable final gets execution_interrupted;
it is not rerun. This does not prove external side effects never happened or
external processes exited. Hosts using external processes must isolate/clean
prior resources before reusing them. Store ownership is retained if close cannot
confirm resource cleanup.

## History, limits and retention

History pages bind a store identity, filter and fixed committed watermark.
SSE pulls the same durable event source; reconnect with the last acknowledged
cursor. Delivery is at least once, deduplicated by event sequence, not time.
Snapshots are technical-time projections, not reducer input. Disconnection only
releases the subscription. Core authorization applies to local and HTTP calls,
including every stream pull; tokens are not credentials. Public history redacts
internal Prepared. Business results/errors remain scope-authorized.
Series observations include at most pageSize recent Task snapshots per frame;
durable events continue through every bounded page. HTTP bounds concurrent body
parsers, subscription count and bytes; time-window rate quotas belong to the host.

Defaults: 10,000 Tasks, 100,000 retained events, 64 KiB payloads, 64 concurrent
preparation/queued groups, 128 subscriptions, 100 events per page/pull, 60-second
execution wall limit, 10-ms coordinator interval, 24-hour idempotency/retention
window. Pool defaults: 128 waiting, 100-ms cooperative grace, 5-second physical
exit/cleanup confirmation. All are configurable positive bounded budgets, not
throughput guarantees. Progress reserves final-fact capacity; admission pressure
is explicit. Slow SSE consumers accumulate no unbounded in-memory event queue.

`engine.collect()` conservatively removes only an entire inactive expired
reference graph. Continuous active Series can therefore reach admission
backpressure instead of being pruned piecemeal. Active/recovery facts are never
evicted; configure capacity and archival policies accordingly. Expired cursors
fail with history_expired, never silently restart at the head.

No npm publication, production deployment or existing business migration is
implied by these packages. Package checks include independent packed consumers.
