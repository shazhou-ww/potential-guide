# @potential-guide/cli-core

Shared configuration, command protocol, atomic persistence, and ACP client used
by the `pguide` command packages. This package is an implementation component;
most users should install `pguide` and the desired command packages instead.
Agent profiles inherit credentials only by environment-variable name; common
secret-bearing transport arguments are rejected before profiles can be shown
or persisted. Configuration uses `schemaVersion: 2`. Optional
`agentExecutionLimits: { timeoutMs: 30000 }` limits each Agent execution,
not the complete regulation feedback loop. Version 1 configuration and old
`limits` fields are rejected; remove iteration/stalled budgets when migrating.
Optional `regulationStrategy` configures `mode` (`adhoc`, or `periodic` with
`intervalMs`), `probe: { timeoutMs, retry: { maxRetries, delayMs } }`, and
`effectTtlMs`. Omitted values default to ad hoc mode, a 30000 ms probe timeout,
zero retries, and no effect TTL. These settings do not add repair-round budgets.
The generic JSON `digest` utility supports persisted subject integrity;
production observation identity/version comes from the Git source commit.
