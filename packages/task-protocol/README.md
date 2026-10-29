# @potential-guide/task-protocol

Pure generic Task DTOs, finite-JSON validation, extension ports and event projection.
No scheduler, database, HTTP listener or built-in business task.

`TaskType<Input, Prepared = Input>` requires pure `validate`/`equals`, `prepare`,
`validatePrepared`, result/progress validators and queued `execute`. Validators
must not coerce values. Invalid `other` inputs return false from `equals`; actual
programming defects must propagate. Inputs need no schema-library dependency.

`reduce(prefix, events)` and `project(facts, taskId, explicitTime)` are pure.
Use `isPending`, `isTimedOut`, `isCanceled`, `isCompleted` and `isExecutionFailed`
independently: cancellation freezes process facts; late completion can also be
timed out. A finish exactly at the deadline is on time. Results are stored once
on Execution and projected through Task's completion association.

See [the engine guide](../../docs/task-engine.md) for ports and composition.
