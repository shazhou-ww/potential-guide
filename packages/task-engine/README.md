# @potential-guide/task-engine

Embedded, explicitly started generic task coordination. Depends only on
task-protocol and Node built-ins; HTTP and SQLite are optional host composition.
No built-in Check, readiness gate or implicit retry.

Exports `createTaskEngine`, `TaskEngine`, `newId`; `/pool` exports the bounded
`ExecutorPool`; `/testing` exports explicitly non-durable `MemoryStore` and
`VirtualClock`. No import starts a listener or timer.

See [the engine guide](../../docs/task-engine.md) for startup handshakes, ownership,
recurrence, authorization, retention and resource-control requirements.
