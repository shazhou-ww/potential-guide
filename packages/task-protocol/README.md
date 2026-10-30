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
Optional `authorize(input, binding, executionPrepared?, result?)` is synchronous;
Promise grants are rejected rather than awaited or treated as permission.

The only match policies are `started-after-eligible` (default) and
`terminated-after-eligible`. They bind only at their corresponding Execution
event, with an inclusive effective-eligibility lower bound. Termination means
success or failure, not physical cleanup. Prepared does not gate matching.
Facts use projection version 2; old formats and `completed-after-eligible`
are rejected, not silently reinterpreted.

`reduce(prefix, events)` and `project(facts, taskId, explicitTime)` are pure.
Use `isPending`, `isTimedOut`, `isCanceled`, `isCompleted` and `isExecutionFailed`
independently: cancellation freezes process facts; late completion can also be
timed out. A finish exactly at the deadline is on time. Results are stored once
on Execution and projected through Task's completion association.

`TaskService.listTasks(TaskQuery, page, caller)` exposes a bounded, stable
directory of retained Task summaries, separate from event history. `TaskPage`
contains observation/expiry times and an optional opaque continuation cursor.
Authorization uses the distinct `list` operation. Summary `updatedAt` follows
accepted Task changes and bound live Execution progress, not read time.
The optional stored `TaskRecord.updatedAt` preserves supported v2 checkpoints
with their original `contractRevision` but without update metadata;
`restoreTaskUpdates(StoreView)` reconstructs absent values from protected retained
events, failing on missing history rather than guessing a timestamp.
It does not invent a missing contract identity or bypass original-schema checks.

See [the engine guide](../../docs/task-engine.md) for ports and composition.
