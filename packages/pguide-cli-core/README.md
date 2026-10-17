# @potential-guide/cli-core

Shared configuration, command protocol, atomic persistence, and ACP client used
by the `pguide` command packages. This package is an implementation component;
most users should install `pguide` and the desired command packages instead.
Agent profiles inherit credentials only by environment-variable name; common
secret-bearing transport arguments are rejected before profiles can be shown
or persisted. Configuration uses `schemaVersion: 2`. Optional
`agentExecutionLimits: { timeoutMs: 30000 }` limits each Agent execution,
not the complete regulation feedback loop. Version 1 configuration and old
`limits` fields are rejected.
Optional `regulationStrategy` configures
`quota: { timeoutMs, maxAgentRuns, maxStallRuns }` for one regulation run and
`probe: { timeoutMs, retry: { maxRetries, delayMs } }`.
The CLI defaults to a 300000 ms run quota, 10 Agent calls, 3 stalled rounds,
a 30000 ms probe timeout and zero retries. Removed `mode` and `effectTtlMs`
fields are rejected rather than silently changing old periodic recipes.
Periodic observation and subsequent run scheduling belong to supervisor.
The generic JSON `digest` utility supports persisted subject integrity;
production observation identity/version comes from the Git source commit.
