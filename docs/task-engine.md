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

const store = openSqliteStore("tasks-v2.sqlite");
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
An optional synchronous `authorize(input, binding, executionPrepared?, result?)`
hook checks input/source permissions at admission and again at event matching.
It must return `undefined`, never a Promise; exceptions or asynchronous grants
deny admission/matching. Execution context/result arguments belong to the
candidate execution, not a prerequisite preparation by the receiving Task.
Authorization must not perform asynchronous downloads. Keep resource checks in
prepare/execute too; input equality never grants permissions.
The optional `validateExecutionResult(result, prepared)` hook additionally validates
results against immutable execution content, including recovery/history reads.
Existing `validateResult` signatures remain unchanged; Check uses the new hook to
validate declared problems against the original verified Checker manifest rather
than a process-local cache.

A trusted TaskType may declare positive `allocationLimit` to select an isolated
admission lane for its type (all versions agree). Unlisted types share
`limits.maxConcurrent`; `EngineOptions.allocationLimits` can explicitly override
lanes. This bounds allocation requests, not physical workers: executors still
own their bounded pools. Orchestration waiting for child types must use separate
lanes/pools. Probe declares its lane automatically so even queued parents cannot
exhaust a single Check admission slot. Request fields cannot choose capacities.

`engine.waitForTaskRelease(taskId, caller)` is an authorized in-process physical
ownership barrier, not a cancellation command or a new Task stage. It waits for
startup/preparation withdrawal and tracking cleanup; a canceled owner sharing
an execution may detach while another live owner retains it. Composition cancels
only its own child Task IDs, then uses this barrier before resource reuse. An
unconfirmed exit remains unconfirmed, subject to the owning pool's cleanup budget.

Prepared identifies **actual immutable execution content**, not merely a mutable
URL, but it does not determine sharing. Matching uses type/version/environment/
scope, authorization and the type's original Input `equals`, even if a receiving
Task has not prepared. For mutable references, pin a digest in Input when content
identity is required; equal unpinned Inputs may share the selected execution.
Omitted executionMatch means `started-after-eligible`; the raw Request stays
unchanged. Only `started-after-eligible` and `terminated-after-eligible` are
accepted. The former binds at start, the latter at logical success **or failure**.
Both use event time `>= effectiveEligibleAt`. No running-time attachment or
historical search binds a new Task, even when timestamps are equal: reception
must precede the matching event in durable order. Failures are not successes.
Full Request idempotency does not use business equality. Retain original version
interpreters when upgrading; missing historical versions fail explicitly.

The optional `/pool` helper implements `execute`. Provide resource keys and
`run(prepared, permit, context) -> RunningWork`. The read-only context carries
Engine-bound type/version/environment/scope, never body-supplied credentials.
Pool obtains `options.start()` before
calling run: this synchronous handshake commits a fresh identity, trusted
startedAt and started-policy bindings before any business operation. execute returns
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
Unbound terminated-policy demand also protects shared work. Timeout retracts
unstarted work and replacement protection, not late-result eligibility. Sealing
freezes existing demand IDs: they may still accept the final event, but new
demand cannot join a sealed execution.
Pool wakeups arriving during reclamation are replayed even when no slot is idle;
denied replacements wait for another real wakeup rather than busy-looping.
Wall limits use relative Clock scheduling, independently of business UTC clock
adjustments. A tracking identity or start time cannot be supplied by a Request.

## Lifecycle and durability

Submit preserves raw Request, original contract binding, IDs and deadlines.
`snapshot.eligibleAt` is the effective anchor:
`max(request.eligibleAt ?? receivedAt, receivedAt)`. The deadline is that anchor
plus timeoutMs. Idempotent retries and restart never reanchor accepted requests.
Preparation and resource waiting consume the same eligible-anchored budget.
Expiration retracts unstarted work; running work may complete late. Cancellation
freezes the Task, not another owner's Execution. A durable eligible final fact
wins over a later cancel even if Task processing is delayed.
Start/final events and their bindings are committed atomically; final events
also commit Task settlement. Projection never invents historical matches.
Preparation callbacks cannot overwrite a binding or terminal result.
Timeout is independent of success/failure: effective end (or observation time
while unfinished) must be strictly greater than deadlineAt. Equality is on time;
deadlineAt is not an acceptance upper bound. An expired Task can accept an
applicable event driven by another active Task, but cannot independently schedule
new work. Started bindings retain their result when clocks later move backward;
terminated bindings must satisfy the termination event's inclusive time bound.

Recurrence requires explicit `eligible` or `terminated` anchor and positive
periodMs. Select the strictly future point on the original lattice and skip
missed rounds. Terminated timeout anchors at deadline, not detection time.
Each predecessor has one durable successor association; at most one derived
pending Task occupies the Series slot, but multiple eligible Tasks are allowed.
Capacity pressure leaves planning unconsumed. Cancellation creates no successor
and does not undo an already planned one.

SQLite uses WAL/FK/FULL, atomic events/idempotency/successors/checkpoint and one
active owner per local store. SQLite user_version, checkpoint projection_version
and Facts projectionVersion are all 2. Old formats and the old
`completed-after-eligible` enum are explicitly rejected, not migrated or aliased.
Use a new database path; rejection preserves old data. Version-zero databases
containing application tables are not treated as empty.
Startup projects existing finals before resuming
unstarted work. Started work without a reliable final gets execution_interrupted;
it is not rerun. The new recovery failure event may bind eligible terminated
demand already received; it does not reconstruct a fictitious past finish.
This does not prove external side effects never happened or
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
