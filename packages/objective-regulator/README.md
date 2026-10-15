# `@potential-guide/objective-regulator`

Runs a guarded loop around one `ObjectiveGuideInstance`: probe, select the first
actionable problem, request one Agent action, and probe again. Target levels remain
instance-bound, and iteration, timeout, and stalled-progress limits prevent an
unbounded loop.

The package never performs real-world mutations itself. Callers inject the Agent
executor and retain responsibility for cancellation within that executor.

## Public API

- `createObjectiveRegulator(instance)` binds regulation to one Guide Instance.
- `ObjectiveRegulator.regulate` targets one explicit local level or terminal.
- `ObjectiveActionExecutor` performs exactly one requested real-world action.
- `RegulationLimits` bounds requested actions, elapsed time, and stalled probes.
- `RegulationResult` distinguishes success, blocking, stalling, exhaustion, timeout,
  and an observation with no actionable problem.
- Configuration and initial-observation timeout defects reject through explicit
  error classes.

The package is domain logic only. The `pguide` composition package owns the
`regulate` and `continue` CLI adapters, including configuration, ACP, and
persistence concerns.

## Usage

```ts
import { createObjectiveRegulator } from "@potential-guide/objective-regulator";

const regulator = createObjectiveRegulator(instance);
const result = await regulator.regulate(
  {
    targetLevelId: "terminal",
    limits: {
      maxIterations: 5,
      maxStalledIterations: 2,
      timeoutMs: 30_000,
    },
  },
  async ({ observation, problem }) => {
    await performOneAction(observation, problem);
    return { status: "completed", summary: "Action completed." };
  },
);
```

A completed action is never treated as progress by itself. The regulator probes
again and compares the resulting level within the same Guide Instance.
