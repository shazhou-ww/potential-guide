# Objective Portfolio Supervisor

The supervisor separates **planning demand** from **coordinating execution**.
It uses `SubscriptionRef` snapshots from `@potential-guide/effects`; the domain
does not provision agents or resolve executable configurations.

## Planner

`await createPortfolioPlanner({ goals, observe, policy?, periodic? })` observes
the initial portfolio and awaits its first plan. It returns:

- `queue`: `SubscriptionRef<PriorityQueueSnapshot>` containing `{ revision, demands }`.
- `state`: goals, latest observation envelopes, and any planning/observation error.
- `updateGoals(goals)`: replace registrations, invalidate changed recipes, and
  re-observe changed/new goals.
- `feedback(event)`: consume coordinator results, lifecycle events, and capability
  requests.
- `refresh()`: explicitly re-observe all goals and replan.
- `close()`: stop observation timers, abort probes, and await pending work.

An `ObjectiveGoal` contains `id`, `pilot`, `subject`, `targetLevel`, `priority`,
`observationIntervalMs`, optional capability `requirements`, and optional `language`.
Priority zero is reserved for emergency work; smaller numbers are more urgent.
Queue demands add a positive, stable `revision`; the enclosing queue has its own
monotonically increasing snapshot revision. Priority-only changes do not create
a new demand revision.

Every goal is observed at its own cadence, including already-satisfied goals.
Completed work is not blindly enqueued again: a subsequent observation must show
degradation below its target, or the user must change the demand/specification.
Set `periodic: false` for a single observation/plan, then close the planner.
Observation callbacks must honor their `AbortSignal`.

A replaceable asynchronous `PlannerPolicy` receives registered/effective goals,
eligible candidates, observations, the previous queue, and feedback events. It
returns only `{ directives: [{ goalId, priority, targetLevel?, requirements? }] }`.
Directives must name eligible known goals, cannot weaken registered targets, and
cannot contain agent bindings, executable configuration, or arbitrary goals.
Requirements augment rather than remove registered capability constraints.
Malformed output and policy rejection surface as rejected calls and state errors;
there is no silent fallback. The built-in deterministic policy schedules all
eligible candidates using their registered priority. The CLI supplies an ACP
policy; a custom policy owns cancellation of its own external work.

When a root returns `prerequisite-unmet`, the planner validates the reported
**direct child** against the root specification and its projected subject,
blocks the root, and adds/merges a child demand. Equivalent objective IDs and
canonical JSON subjects share one demand, with the highest requested minimum.
The coordinator never invents dependencies. Child completion or an observation
showing satisfaction permits renewed root demand. Derived work is removed when
its owning root registrations disappear.

## Coordinator

`await createPortfolioCoordinator({ queue, resources, runner, maxConcurrency,
quota, agentExecutionLimits, abortGraceMs, permissions?, permissionUpdates?,
onEvent? })` subscribes to current queue
and resource snapshots. It returns `state` and asynchronous `close()`.

Resources are `{ id, binding, capacity, capabilities }`. The coordinator selects
an eligible resource by required capabilities and current relative load, honoring
both resource capacity and the global concurrency ceiling. Updated resource
snapshots affect subsequent scheduling. Running and **stopping** runs both occupy
slots, including runs on resources removed from the latest snapshot.

The runner implements:

```ts
start(input: RegulationInput, resource: AgentResource): {
  result: Promise<RegulationOutcome>;
  abort(): void;
  kill(): Promise<void>;
}
```

`result` must settle only after execution has actually finished. `kill()` must
resolve only after confirmed termination, not merely signal delivery. Use process
isolation for arbitrary/uncooperative code; rejecting a JavaScript promise is not
a kill. The CLI supplies a process-tree runner.

Ordinary priority changes do not preempt an active run. P0 work uses FIFO order
within its priority and preempts only the minimum necessary lower-priority work.
Stopping first calls `abort()`, then waits `abortGraceMs` before `kill()`. Resources
are released only on confirmed result settlement or successful kill. A failed
kill leaves the slot occupied and surfaces an error. Queued P0 notifications and
capability requests are deduplicated per demand revision.

Execution of the same objective and canonical subject is serialized. Spec
replacement stops the superseded run; late results cannot satisfy a newer
demand. Completed/blocked/failed revisions are suppressed even when an old queue
snapshot remains visible. `exhausted` runs remain eligible and continue against
the latest priorities/resources after yielding to the event loop, retaining
consecutive-stall history. The coordinator grants a fresh stall allowance by
adding the carried stall baseline to the regulator's cumulative `maxStallRuns`
ceiling; the configured coordinator quota remains the additional allowance.

`onEvent` receives `started`, `result`, `failed`, `stopping`, `killed`, `p0-queued`,
and `capability-request` events. Connect it to `planner.feedback(event)` for the
closed loop. Capability requests are planning inputs, not permission to
automatically provision or authorize resources. Coordinator state retains the
latest 256 events and surfaces lifecycle/callback errors.

Forward agent-originated requests with
`coordinator.reportCapabilityRequest(input, { capability, reason })`, using the
exact `input` object passed to `runner.start`. This associates requests with a
live run, ignores superseded/stopping runs, and emits the planner event with
`requirements: [capability]` and `reason`. Repeated identical requests are
deduplicated.

### Authorization and resumption

`permissions?: RegulationPermissions` is trusted coordinator configuration, never
a planner directive or queue field. `permissionUpdates?` is a
`SubscriptionRef<RegulationPermissions | undefined>`; when supplied, its current
value overrides the static policy, including `undefined` (deny-all). The regulator
validates ceiling/grant IDs and receives an immutable policy snapshot for every
run. Changing effective live permissions aborts active runs, retains their occupied slots
until termination, and ignores late results. Invalid replacements revoke to
deny-all and surface an error, suspending launches until a valid replacement
arrives rather than retaining old authority.

An `authorization-required` result remains visible to planning but is held by the
coordinator. The same is true for `exhausted` results with top-level unresolved
`authorizationRequests`. Unlike ordinary quota exhaustion, neither automatically
continues with unchanged authority. The blocked signature includes actual
Pilot/specification, subject, language, target, and effective selected permission
rules, not priority, queue revisions, Agent identity, rule IDs, or unselected
ceiling entries. Reprioritizing, requeueing, replacing resources, and equivalent
policy updates cannot bypass it. Changing the effective grants or the actual
plan permits another run, which always starts with fresh observation.

Forward denied operations with
`coordinator.reportAuthorizationRequest(input, request)`, using the exact runner
input object. It emits a deduplicated `authorization-request` event containing
`{ demand, request }`, ignores stale/stopping runs, and never changes grants.
Planner feedback contains requests and observations, not the trusted permission
policy. Planner output and registered goals reject permission/ceiling/grant fields.
Adapters may try authorized alternatives before returning a blocked result:
target attainment and actual observed progress take precedence over a denied call.

## Migration

The former `createObjectivePortfolioSupervisor` registration/runtime/directive
API is removed. Replace it with independent planner and coordinator instances.
Quota belongs to each regulator run; periodic maintenance belongs to the planner.
Use `pguide supervise` for configuration, ACP integration, and process isolation;
this package has no command-line entry point.
