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

ACP profiles keep `connection.protocolVersion: "1"` as a configuration string;
the client validates a positive safe integer and sends the numeric ACP version
on the wire. Initialization requires the same numeric negotiated version.
Session continuation uses standard `session/load` with the advertised
`loadSession` capability. Prompt summaries use streamed `agent_message_chunk`
text (bounded to 1 MiB), falling back to legacy summaries or the stop reason.

Agent-to-client requests have a separate JSON-RPC ID namespace from pending
client requests. By default, `session/request_permission` receives a cancelled
outcome, while unsupported methods receive `-32601`; no filesystem or terminal
capabilities are advertised or implicitly authorized. Denials emit a
`pguide/request_denied` update without tool arguments. Embedders may explicitly
provide a third `AcpClient` constructor argument with `permissionHandler` and
`permissionTimeoutMs` (default 1000, maximum 30000). The handler receives the
validated active-session request and an abort signal, and must return an offered
option ID. Missing, invalid, failed, timed-out, or shutdown-interrupted decisions
cancel the request. This API does not enable any permission by default.

`PguideConfig.regulationPermissions` stores protocol-neutral named ceiling rules
and an explicit subset of granted IDs. `parseRegulationPermissions` validates the
configuration shape without coupling cli-core to the regulator. Read/edit rules
contain exact absolute `resources`; execute rules contain an exact `command`.
The pguide runtime adapter supplies policy, realpath checks and safe permission
events. Generic ACP handlers remain opt-in; timeout/cancellation never selects an
invalid or unoffered option. Profiles that preauthorize tools can bypass ACP
requests, so these checks are not an OS sandbox.
