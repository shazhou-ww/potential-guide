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
`environment`, declarative `inputSchema`, required
`prepare(Input, {signal, deadlineAt, context})`, `validatePrepared`, `validateResult`,
`validateProgress`, and `execute(Prepared, ExecuteOptions)`.
Validators return the original semantic value without coercion. All stored
values must be finite JSON: no getters, custom prototypes, sparse arrays,
toJSON conversion, cycles or undefined. Values passed into type code are frozen.
Business fields stay beside the Request envelope; schemas should reject
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
scope, contract revision, authorization and generated Input equality, even if a receiving
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
Task and Execution bindings include `contractRevision`; missing legacy identities
or a same-version Schema change fail as `unsupported_contract`, never automatically
migrate. Registering a new version cannot reinterpret old records. Original
versions may remain registered for recovery without being advertised as current.

### Input Schema and generated equality

The engine clones, compiles and freezes registration contracts and copies
`currentVersions` at construction. Changing the author's objects afterwards has
no effect. `compileInputSchema<Input>(schema, limits?)` is exported by
`@potential-guide/task-protocol` and returns
`{inputSchema, revision, validate(value), equals(left,right)}`.
The helper revision identifies Schema/projection semantics; discovery revisions
add type and version identity. Authors maintain no arbitrary validate/equals hook.
Prepared, progress and result validators remain separate.

Validation uses Ajv2020 with `strict:true`, `allowUnionTypes:true`,
`validateFormats:false`, `ownProperties:true`. Required and declared fields use
own JSON properties, never Object.prototype members. Ajv's skipped `__proto__`
declarations are compiled through an equivalent exact-name standard pattern
after strict checking of the authored contract; this does not change the public
Schema or its structural projection. Formats are annotations, not URL security checks.
Standard keywords (including tuples, conditionals, dependencies and unevaluated
constraints) are not restricted to a form-rendering subset. No coercion, defaults,
field removal, network loading or custom keywords run. Trusted registration
requires a finite JSON Schema declaring root `type:"object"`. Only local JSON
Pointer `$ref` values are supported; URI-encoded pointers, nested `$id` resources,
external/dynamic/recursive references, asynchronous and cyclic contracts fail
explicitly. Schema traversal visits schema locations, not const/default/examples
data, and includes `$ref` siblings.

Default compiler limits are 262,144 Schema bytes, 4,096 Schema nodes, 16,384
reference expansions, 64 levels, 262,144 projection operations and 1,048,576
serialized projection bytes per operand.
All configurable limits must be positive safe integers. Input finite-JSON limits
default to 65,536 bytes; Engine compilation uses `limits.maxPayloadBytes`.
Violations throw, including during equality; they never imply equality.

Equality is **not validation** and accepts any finite JSON within those budgets:

- Named properties compare presence and selected values; unselected fields are
  ignored even when `additionalProperties:false` would reject the input.
- Missing differs from null and explicit defaults. JSON types differ; object key
  order does not matter and `-0` equals `0`.
- Free JSON/object nodes with no field declarations compare complete content
  (including empty `properties:{}`). Boolean additionalProperties alone does not
  change comparison fields. Schema-valued additionalProperties is a dictionary:
  dynamic keys and selected value shapes participate.
- patternProperties compares matching keys and values. Schema-valued
  unevaluatedProperties conservatively contributes unmatched local keys.
- Arrays preserve length, order and prefixItems/items boundaries. Positions
  forbidden by boolean schemas still compare their raw finite JSON.
  Schema-valued unevaluatedItems supplies a local tail shape only when items is
  absent: prefixItems wins at tuple positions, then explicit items (including
  true/false), then schema-valued unevaluatedItems. Boolean unevaluatedItems alone
  is validation-only. These are structural rules, **not** JSON Schema evaluated
  annotations: separate composition branches contribute independent shapes, and
  contains/conditions never select evaluated positions for equality.
- allOf/anyOf/oneOf contribute all structural shapes, never OR equality booleans.
  Local JSON type selects object/array shapes; this implementation does not
  otherwise choose branches by discriminator values.
  then/else and dependentSchemas contribute structural unions without executing
  conditions. Validation-only clauses do not introduce a full-object projection
  that overrides named-field selection.
- Wrong shapes use type-tagged raw JSON fallback. Each operand's projection is
  independent, preserving reflexivity, symmetry and transitivity.

### Authorized type discovery and revision guards

`engine.discoverTypes(caller)` / `TaskService.discoverTypes(caller)` returns a deeply
frozen array of `{type,version,inputSchema,revision}` for exactly `currentVersions`.
It reuses the caller/scope **submit** authorization, with no new per-type ACL.
Only public contracts are returned, never environment/configuration/functions.
Schemas are trusted public metadata: do not put credentials in their annotations.
Discovery does not resolve business URLs, download artifacts or query subjectSchema.
Ordinary object subjects need no asset catalog or additional schema lookup.

HTTP GET `/task-types` exposes the same array under the configured prefix.
Clients may call `submit(request, caller, {expectedRevision: revision})` or send
POST `/tasks` with `If-Match: "<revision>"` (one quoted lowercase SHA-256 revision).
Malformed headers return 400; stale revisions return
412/`contract_revision_mismatch` before persistence, including retries carrying a
stale precondition. Without a precondition, existing requestId retries continue to
use their original contract. The precondition is transport metadata, not business
input or stored raw intent: it does not change requestId equality. New versions
require new discovery; old recovery-only versions are never advertised.

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

## Execution directory

`engine.listExecutions(query, {cursor?, limit?}, caller)` and HTTP `GET /executions`
list authoritative retained Execution records in the caller's scope, independently
of the submitting client or any UI observation set. Shared execution IDs appear once.
The new **`list-executions`** operation requires an explicit policy grant; it grants
neither Task `list`/detail/request access nor event history/subscriptions.

Query fields: optional exact `type`, `startedFrom` (inclusive), `startedBefore`
(exclusive), and `sort:"started-desc"` (default). Times require an explicit RFC 3339
timezone. Equal start times sort by executionId ascending. Pagination uses `cursor`
and optional positive `limit` not exceeding configured pageSize.

The response is `{executions, observedAt, expiresAt, next?}`. Each summary contains
executionId, type, version, startedAt, optional completedAt/failedAt/reclaimedAt,
and independent `state` flags: running, completed, failed, reclaimed, sealed.
No Input, Prepared, result, error payload, binding, owner identities or Task IDs
are included. Execution completion is not reclamation.

Both directories use one shared frozen-membership implementation, with independent
`tasks:` and `executions:` cursor domains, signing secrets, views and budgets.
The existing queryScanLimit, queryPageBytes, maxQueryViews, maxQueryBytes and
queryLifetimeMs apply **per directory** (default combined cache ceiling: twice
maxQueryBytes). All members and summaries are frozen on the first page. Every
page reauthorizes; removing any member, expiry or restart yields 410/query_expired,
never a partial substitute. Invalid filters/cursor domains are 400, denied access
401/403, oversized pages 413, exhausted budgets 429.

MemoryStore and SQLite already persist the authoritative Execution projection.
No schema version change, derived index, UI database access, scheduling change
or matching change is involved. Fresh queries after recovery read those same
records; query cursors remain process-local and cannot survive restart.

For authorized bound Task navigation, `GET /tasks?executionId=<ULID>` adds an exact
association filter to the Task directory. It uses the independent Task **`list`**
grant, caller scope, its own frozen cursor and budgets; it is not a list of all
execution demand/worker owners. Fetching any selected Task/request/history still
requires its own permission. A denied association query does not disable the
Execution directory.

## Task directory

`engine.listTasks(query, {cursor?, limit?}, caller)` and HTTP `GET /tasks`
discover all still-retained, authorized Tasks in the trusted caller's scope,
including submissions from other subjects/clients, pending work and failures.
The new `list` authorization operation is separate from `task`, `request`,
`history` and `subscribe`; update explicit operation allowlists deliberately.
It is also independent of `discoverTypes`/`GET /task-types`, which retain their
existing `submit` authorization. Listing neither implies nor requires discovery.
Listing never grants permission to fetch original requests or current details.
No query parameter can override caller scope.

Query fields (all optional, combined with AND):

| Field | Meaning |
| --- | --- |
| `type` | Exact registered type name, 1–256 characters |
| `executionId` | Exact bound Execution ULID; independent Task-list permission |
| `createdFrom`, `createdBefore` | Inclusive/exclusive service `receivedAt` bounds |
| `updatedFrom`, `updatedBefore` | Inclusive/exclusive **latest** `updatedAt` bounds |
| `sort` | `created-desc` (default) or `updated-desc`; ties use ascending taskId |

Time values are RFC 3339 timestamps with an explicit `Z` or numeric offset,
seconds and optional 1–3 fractional digits. They are normalized to millisecond
UTC; invalid dates, reversed/empty ranges and unknown fields fail. Convert local
calendar days to timezone-aware boundaries in the client. Eligibility, execution
start and snapshot observation time are not creation times.

```ts
const query = {
  type: "echo",
  createdFrom: "2026-10-01T00:00:00+08:00",
  createdBefore: "2026-11-01T00:00:00+08:00",
  sort: "updated-desc" as const,
};
const page = engine.listTasks(query, { limit: 25 }, caller);
// Repeat the same query when following next; percent-encode HTTP query values.
const next = page.next
  ? engine.listTasks(query, { cursor: page.next, limit: 25 }, caller)
  : undefined;
```

Each `TaskPage` has `tasks`, `observedAt`, `expiresAt`, and optional `next`.
Each summary contains `taskId`, `requestId`, `seriesId`, `type`, bound `version`,
`receivedAt`, `updatedAt`, and `state` (`stage`, `pending`, `timedOut`, `canceled`,
`completed`, `executionFailed`). These independent state flags use the existing
Task projection; success/failure, cancellation and timeout are not collapsed.
No input, Prepared, result, error message, progress payload or submitting subject
is included. Follow IDs through existing detail/request/history APIs. Redo is a
new submission with a new requestId and original user parameters; the summary's
bound version must not be injected into the original request.
The current discovered revision is separate from a retained Task's original
schema binding. Timestamp recovery does not invent `contractRevision`: the
existing `unsupported_contract` checks for absent historical identities or changed
same-version schemas still apply. A client may explicitly use the current
discovery/If-Match flow for a new submission; listing never pins redo to an old
version or automatically adds a revision precondition.

Creation initializes `updatedAt` to `receivedAt`. Accepted Task fact changes,
and new progress/final facts of its bound live Execution, update it to that
event's time. Canceled/final Tasks do not follow later shared Execution progress.
Unbound demand does not inherit progress. Reads, time passing, timeout projection
and loading a checkpoint do not update it. An actual recovery interruption
failure is still a new fact. Event sequence defines "latest"; a clock rollback
can make updatedAt earlier than its previous value or receivedAt.

The first page freezes **membership, order and summaries** for the entire query.
Concurrent submissions/updates appear only in a new query; details remain live.
Every continuation reauthorizes the complete membership. A removed member,
including one on an already delivered page, invalidates the query. Permission
revocation fails rather than returning stale data. No missing member is skipped
or replaced. Already delivered responses cannot be recalled.

Directory cursors are opaque, authenticated, process-local and bound to the
caller (scope and subject), normalized query and fixed view. They are not event
cursors or authorization tokens. Page size can change within its configured
bound. Retry of an issued cursor returns the same page for the same page size,
until invalidation; finishing a query does not extend its lifetime. Restart,
expiry or missing context returns `query_expired` (HTTP 410); malformed, modified,
mixed-query/caller or event cursors return `invalid_cursor` (400). Start a new
query after 410. Authorization errors remain 401/403; invalid query/payload
is 400, an oversized page/summary is 413, exhausted capacity is 429, and an empty
successful query is 200 with `tasks: []`.

Directory-specific `EngineLimits`:

| Limit | Default | Bound |
| --- | ---: | --- |
| `pageSize` | 100 | Maximum requested entries (also existing event page limit) |
| `queryPageBytes` | 65,536 | Serialized UTF-8 bytes of the complete success body, including cursor/envelope |
| `queryScanLimit` | 10,000 | Total retained Task records inspected in the initial query, including other scopes/nonmatches |
| `maxQueryViews` | 64 | Retained multipage views per Engine |
| `maxQueryBytes` | 8,388,608 | Aggregate conservative view accounting, including the candidate being constructed |
| `queryLifetimeMs` | 60,000 | Maximum continuation lifetime |

The implementation scans at most queryScanLimit records, then sorts the bounded
matches; no unbounded result is hidden behind a small page limit. It charges
twice each summary's serialized bytes plus 256 bytes per member and fixed/query/
caller overhead. This is a conservative accounting budget, not a V8 heap
measurement; record/view counts additionally bound object overhead. All views
share the byte/count budgets; capacity failure never silently truncates or
evicts another active query. Page bytes can produce fewer entries than requested,
with `next` preserving the remainder. Even one summary that cannot fit fails.
Expiry is checked against both wall and monotonic clocks, so clock rollback
cannot indefinitely prolong a view. Expired contexts are reclaimed lazily on
directory calls; close releases all views. Configure these budgets for retained
volume; a valid query can fail capacity even when submission capacity remains.

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
