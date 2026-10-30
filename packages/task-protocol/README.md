# @potential-guide/task-protocol

Pure generic Task DTOs, finite-JSON validation, extension ports and event projection.
No scheduler, database, HTTP listener or built-in business task.

`TaskType<Input, Prepared = Input>` declares one public `inputSchema` (JSON Schema
Draft 2020-12, root object), plus `prepare`, `validatePrepared`, result/progress
validators and queued `execute`. Authors no longer supply input validate/equals.
`compileInputSchema<Input>(schema, limits?)` returns frozen
`{inputSchema, revision, validate, equals}` for direct consumers. Validation never
coerces, fills defaults or removes fields. Equality compares independent structural
projections, including invalid finite-JSON operands; it never invokes validation.
Resource failures throw instead of returning an equality result.

`reduce(prefix, events)` and `project(facts, taskId, explicitTime)` are pure.
Use `isPending`, `isTimedOut`, `isCanceled`, `isCompleted` and `isExecutionFailed`
independently: cancellation freezes process facts; late completion can also be
timed out. A finish exactly at the deadline is on time. Results are stored once
on Execution and projected through Task's completion association.

See [the engine guide](../../docs/task-engine.md) for ports and composition.
