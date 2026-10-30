# @potential-guide/task-engine

Embedded, explicitly started generic task coordination. Depends only on
task-protocol and Node built-ins; HTTP and SQLite are optional host composition.
No built-in Check, readiness gate or implicit retry.

Types declare `inputSchema`; registration generates validation and structural
equality. `discoverTypes(caller)` exposes only current public contracts.
`submit(request, caller, {expectedRevision?})` optionally guards schema drift.
Persisted task/execution bindings must have the original `contractRevision`;
missing identities or changed same-version schemas fail explicitly.

Exports `createTaskEngine`, `TaskEngine`, `newId`; `/pool` exports the bounded
`ExecutorPool`; `/testing` exports explicitly non-durable `MemoryStore` and
`VirtualClock`. No import starts a listener or timer.

See [the engine guide](../../docs/task-engine.md) for startup handshakes, ownership,
recurrence, authorization, retention and resource-control requirements.
