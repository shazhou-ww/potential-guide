# `@potential-guide/objective-portfolio-supervisor`

Observes multiple Pilot regulation inputs, asks an injected policy to
plan defensive and opportunistic work, and executes directives in policy order.
Portfolio observations are explicitly non-atomic, and levels are never compared
across different Objectives.

Every registration must be represented by either one directive or one deferred
entry. Safety-threshold recovery precedes opportunistic work.

## Public API

- `createObjectivePortfolioSupervisor(registrations, policy)` validates stable,
  unique registrations and their Objective-local safety levels.
  Each registration contains `{ id, input: RegulationInput,
  runtime: RegulationRuntime, safety }`, keeping serializable recipes separate
  from executable probe and Agent bindings.
- `observe` probes registrations sequentially and returns a non-atomic portfolio.
- `plan` invokes the policy, requires complete directive-or-deferral coverage, and
  enforces defensive recovery before opportunistic work.
- `execute` preserves directive order and runs each directive through the native
  regulation Effect. Directives carry `agentExecutionLimits: { timeoutMs }`,
  never cross-round iteration or stalled budgets.
- `ObjectivePortfolioError` reports invalid registrations, observations, and plans.

The package is domain logic only. The `pguide` composition package owns the
`supervise` CLI adapter and its configuration and ACP integration.

## Usage

```ts
import { createObjectivePortfolioSupervisor } from
  "@potential-guide/objective-portfolio-supervisor";

const supervisor = createObjectivePortfolioSupervisor(registrations, async (sample) => {
  return policy.plan(sample);
});

const observation = await supervisor.observe();
const plan = await supervisor.plan(observation);
const result = await supervisor.execute(plan);
```

`observe(signal?)` and `execute(plan, signal?)` accept cancellation. Invocation
failures reject portfolio observation rather than manufacturing a level. Agent
execution receives complete observations; regulation re-observes after repair.
Result entries contain `RegulationOutcome` with `stopReason` and an envelope in
`latestObservation`. Legacy Guide instances, action executors, and regulation
budgets are not supported. Policies must not compare or aggregate level IDs
across Objectives.
