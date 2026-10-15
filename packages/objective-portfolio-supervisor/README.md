# `@potential-guide/objective-portfolio-supervisor`

Observes multiple instance-bound Objective Regulators, asks an injected policy to
plan defensive and opportunistic work, and executes directives in policy order.
Portfolio observations are explicitly non-atomic, and levels are never compared
across different Objectives.

Every registration must be represented by either one directive or one deferred
entry. Safety-threshold recovery precedes opportunistic work.

## CLI

The package owns `pguide-supervise`, which loads a portfolio description, plans
directives, and can execute them through a configured ACP Agent profile.

## Public API

- `createObjectivePortfolioSupervisor(registrations, policy)` validates stable,
  unique registrations and their instance-local safety levels.
- `observe` probes registrations sequentially and returns a non-atomic portfolio.
- `plan` invokes the policy, requires complete directive-or-deferral coverage, and
  enforces defensive recovery before opportunistic work.
- `execute` preserves directive order and delegates each target to its regulator.
- `ObjectivePortfolioError` reports invalid registrations, observations, and plans.

## Usage

```ts
import { createObjectivePortfolioSupervisor } from
  "@potential-guide/objective-portfolio-supervisor";

const supervisor = createObjectivePortfolioSupervisor(registrations, async (sample) => {
  return policy.plan(sample);
});

const observation = await supervisor.observe();
const plan = await supervisor.plan(observation);
const result = await supervisor.execute(plan, executeOneObjectiveAction);
```

The policy can use typed budget, window, and exclusivity dependencies captured in
its own closure. It must not compare or aggregate level IDs across Objectives.
