# Objective Regulator

A reusable JSON `RegulatorSpec` combines a Pilot specification, a single-run
strategy, and an Agent binding. It contains no subject, executable functions,
external observation snapshot, or cancellation handle.

```ts
import { startEffect } from "@potential-guide/effects";
import { makeRegulatorSpec, regulate } from "@potential-guide/objective-regulator";

const spec = makeRegulatorSpec(pilotSpec, {
  targetLevel: "terminal",
  agentExecutionLimits: { timeoutMs: 30_000 },
  quota: { timeoutMs: 300_000, maxAgentRuns: 10, maxStallRuns: 3 },
  probe: { timeoutMs: 10_000, retry: { maxRetries: 2, delayMs: 250 } },
}, { id: "repair-agent", configuration: { mode: "workspace" } });

const running = startEffect(regulate({
  spec,
  subject: { repository: "/work/project" },
  history: { stalledRuns: 0 },
}, {
  pilot: { resolveCheck },
  executeAgent: (input, signal) => agent.run(input, signal),
  onObservation: (envelope) => report(envelope),
}));
const outcome = await running.await();
```

## One bounded detect–repair run

`regulate` observes, sends the complete **root-scoped** observation to the root
Agent, and observes again after each completed execution. Manifest array order,
not the spelling of level IDs, defines advancement. Reaching the requested
level ends this run; there is no scheduling mode or periodic recheck.

The required `RegulationQuota` contains:

- `timeoutMs`: elapsed time for the entire run, including validation, prerequisite
  probes, retries, delays, Agent work, and re-observation.
- `maxAgentRuns`: maximum Agent invocations in this run.
- `maxStallRuns`: maximum consecutive completed repairs without observed
  progress. Optional `RegulationInput.history.stalledRuns` carries this count
  across runs; it defaults to zero.

Progress means advancing the root level, or reducing the number of distinct
scoped problem identities at the same level. A scoped identity includes
Objective, level, check, and problem IDs. Changes to descriptions or parameters
alone are not progress. Progress resets `stalledRuns` to zero. Regression does
not reset it. An already exhausted stall history prevents another Agent call,
but the initial observation can still establish target attainment.

Counts must be positive safe integers (history may be zero). Timers must be
positive safe integers no larger than 2,147,483,647 milliseconds.
`AgentExecutionLimits.timeoutMs` applies afresh to each Agent call and does not
replace the whole-run quota.

## Outcomes, dependencies, and faults

Every normal `RegulationOutcome` contains `iterations` (Agent invocation count),
`stalledRuns`, `latestObservation` (an envelope), and one of exactly:

- `target-reached`: the latest observation reaches the requested local level.
- `exhausted`: `exhaustedBy` is `time`, `agent-runs`, `stall`, or `agent-limit`.
- `prerequisite-unmet`: `prerequisite` contains `{ spec, subject, minimumLevelId }`.
- `authorization-required`: `authorizationRequests` describes denied operations
  that remain unresolved after a fresh trusted observation.

The final `agentOutcome`, when available, is included. If time expires before
any observation, `latestObservation` explicitly has `payload: null` and status
408; otherwise it retains the last actual envelope. A completed final allowed
Agent run is re-observed before agent-run or stall exhaustion is decided.
Target attainment or prerequisite regression takes precedence over those
counts. Time expiration aborts inner work without trusting late results.

An unmet prerequisite at entry **or after a root repair** never authorizes the
root Agent. The outcome identifies the projected **direct child**, even if
the current observation belongs to a deeper ancestor. A planner can recursively
discover the rest of the dependency chain. The exported
`regulationPrerequisite(input)` helper returns this direct dependency (or
`undefined` when absent); it performs deterministic subject projection.
Pilot validates subjects throughout the dependency chain before any check or
Agent executes.

Agent outcomes are `{ status: "completed", summary, authorizationRequests? }`,
`{ status: "authorization-required", reason, authorizationRequests }`, or
`{ status: "blocked" | "failed" | "limit-reached", reason }`. A per-call timeout
or explicit `limit-reached` yields `exhaustedBy: "agent-limit"`. Blocked (409)
and failed (500) Agents instead raise `RegulationError`; they are not quota
exhaustion. Malformed Agent outcomes raise 502.

## Explicit run authorization

Permissions are independent of execution quotas, subjects, Agent bindings, and
planner instructions. `RegulationInput.permissions` is optional and defaults to
deny-all, not implicit approval. The trusted caller supplies:

```ts
permissions: {
  ceiling: [
    { id: "read-config", operation: "read", resources: ["/work/project/config.json"] },
    { id: "repair", operation: "execute", command: "node repair.js" },
  ],
  grants: ["read-config"],
}
```

`PermissionGrant` permits only `read`, `edit`, and `execute`. Filesystem resources
are exact absolute paths, not directory trees or glob patterns. Execution uses
an exact complete `command`, not a shell prefix. `RegulationPermissions.grants`
selects unique IDs from the administrator's unique ceiling rules; it cannot
define additional rules. `makeRegulationPermissions(value)` validates and returns
an immutable snapshot; `undefined` returns empty ceiling/grants. Invalid policy
is a 400 before probes or Agent work. Every `AgentInput.permissions` contains the
complete frozen snapshot. A runtime adapter must enforce it at each operation,
including path canonicalization and symlink handling; this package does not
intercept filesystem or shell calls.

An `AuthorizationRequest` has `{ id, operation, resources, reason, command? }`.
Unknown requested operations are representable for reporting but cannot become
grants. Requests never authorize themselves. Adapters should deny individual
ungranted calls while allowing alternate paths, then attach outstanding requests
to `completed`, or return `authorization-required` with a nonempty request array.
Both outcomes cause fresh observation. Reaching the target wins; observed progress
clears the unresolved requests for scheduling and continues. No progress returns
`authorization-required` without incrementing stall history, even on the final
allowed Agent call: confirmed unresolved denial takes precedence over Agent-run
and stall counts. Observed progress still respects the remaining Agent quota;
target attainment completes successfully. A time interruption remains `exhausted`
and does not trust an incomplete re-observation. Historical requests can remain
in `agentOutcome`; only the top-level array indicates unresolved authorization
after re-observation.

`RegulationError` has `status`, `message`, and an optional `envelope`.
Its constructor accepts `(message, status, options?)` (also
`(status, message, options?)`); options support `cause` and `envelope`.
Malformed inputs/configuration raise 400, invocation failures preserve their
4xx/5xx envelope status, and unexpected execution crashes raise 500.
Errors are in the Effect failure channel. Parent cancellation is native Effect
interruption and rejects `RunningEffect.await()` rather than returning a normal
outcome.

## Probe policy

`probe` defaults to a 30-second whole-observation timeout with zero retries.
Its timeout covers prerequisites too. Timeout aborts the observation and raises
a 504 invocation error after retries are exhausted. Only 5xx invocation failures
are retried; `retry.maxRetries` counts additional attempts, and
`retry.delayMs` is a nonnegative timer duration. A 4xx fault or successful
business observation is never retried as a transport failure. Probe invocation
faults cannot authorize an Agent.

## Externally triggered behavior adapter

`regulatorBehavior(source, runtime, parentSignal?)` consumes complete
`SubscriptionRef<RegulationInput>` snapshots and returns `observation` and
`outcome` SubscriptionRefs plus asynchronous `close()`.

Each changed snapshot starts a fresh single run, including a fresh observation
when only strategy or binding changes. Previous Agent work may have mutated the
subject's external state, so observations are never reused across runs.
Unchanged snapshots are deduplicated. The adapter never schedules itself.

Replacement delivers Abort before starting replacement work without waiting
for uncooperative cleanup. Generation isolation prevents old observations and
late Agent results from publishing into the new run. Inputs, Agent requests,
and outcomes are immutable snapshots. `close()` cancels owned work and awaits
the adapter's cleanup.

The former `mode` and `effectTtlMs` strategy fields are rejected, as are legacy
budgets. Consumers must supply `quota` explicitly. This package is not a
portfolio scheduler, business lock, conflict arbiter, or rollback mechanism.
