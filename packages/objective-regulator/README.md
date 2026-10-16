# Objective Regulator

A reusable JSON `RegulatorSpec` combines a Pilot specification, a strategy and an
Agent binding. It contains no subject, executable functions, external observation
snapshot, or cancellation handle.

```ts
import { startEffect } from "@potential-guide/effects";
import { makeRegulatorSpec, regulate } from "@potential-guide/objective-regulator";

const spec = makeRegulatorSpec(pilotSpec, {
  targetLevel: "terminal",
  agentExecutionLimits: { timeoutMs: 30_000 },
  mode: { type: "adhoc" },
  probe: { timeoutMs: 10_000, retry: { maxRetries: 2, delayMs: 250 } },
}, { id: "repair-agent", configuration: { mode: "workspace" } });

const running = startEffect(regulate({ spec, subject: { repository: "/work/project" } }, {
  pilot: { resolveCheck },
  executeAgent: async (input, signal) => {
    // input has binding, subject, target LevelRef, complete observation and limits.
    // The Agent decides how to organize all reported problems.
    return agent.run(input, signal);
  },
  onObservation: (envelope) => report(envelope),
}));
const outcome = await running.await();
```

One `regulate` effect repeatedly observes, sends the **whole** observation to the
Agent, and observes again after a completed execution. It stops at the requested
local Level ID, an invocation fault, an explicit blocked/failed/limit Agent
outcome, or an observation with no actionable problem. Array order determines
level advancement; a prerequisite observation retains its own Objective URI.
Invocation faults never authorize repairs.

`AgentExecutionLimits.timeoutMs` applies afresh to **each Agent call**. There are
no cross-round iteration, elapsed-time or stagnation budgets. A timeout requests
Abort and returns `agent-limit-reached` without waiting for an uncooperative
Agent's cleanup. Cancellation belongs to `RunningEffect`, not
`RegulationOutcome`: parent cancellation rejects `await()`.

Agent outcomes are `{ status: "completed", summary }` or
`{ status: "blocked" | "failed" | "limit-reached", reason }`.
Regulation outcomes have `stopReason`, `iterations`, `latestObservation` (an
envelope), and optionally the final `agentOutcome`.

## Scheduling, probe failures and lifetime

`mode` defaults to `{ type: "adhoc" }`: reaching the target completes the effect.
`{ type: "periodic", intervalMs }` instead continues observing after the target
has been reached, using native Effect sleep between observations. A later
regression starts the normal full-observation repair/re-probe loop. Explicit
Agent stops and exhausted invocation failures still stop regulation.

`probe` defaults to a 30-second observation timeout and zero retries. Its
`timeoutMs` covers a complete Pilot observation, including prerequisites.
A timeout requests Abort and produces a 504 invocation fault without trusting
late results. `retry.maxRetries` is the maximum number of additional observation
attempts; `retry.delayMs` uses native Effect sleep. Only 5xx faults are retried.
4xx faults and status-200 business results are not transport retries.

Optional `effectTtlMs` limits the lifetime of the whole effect using native Effect
interruption. It is **not** an Agent execution limit, a round count, or an
Outcome stop reason. Omit it for an unbounded lifetime, and use `RunningEffect`
or its parent signal to cancel. Periodic regulation without a TTL runs until
an explicit stop or cancellation.

## Behavior adaptation

`regulatorBehavior(source, runtime, parentSignal?)` consumes a native
`SubscriptionRef<RegulationInput>` containing complete snapshots. It returns
`observation` and `outcome` SubscriptionRefs and an asynchronous `close()`.
The initial state is explicit, not a failure. It reuses the unchanged Pilot and
its in-flight or latest result when only strategy or Agent binding changes.
Changed observation inputs replace the Pilot and its downstream regulation.
Replacements deliver Abort before launching replacement work without waiting
for old cleanup; late observations and Agent completions cannot publish into
the new generation. Final cleanup is awaited by `close()`.

This is not a transaction across independently updated refs and not a business
lock, repair-task framework, conflict arbiter, or rollback mechanism. An Agent
is responsible for conflicts with external or uncooperative work.

The old `createObjectiveRegulator(instance)`, per-problem action requests and
`RegulationLimits` API are removed. Consumer configuration uses schema version
2 and `agentExecutionLimits.timeoutMs`; old persisted runs must fail explicitly
rather than being silently interpreted as new recipes.
