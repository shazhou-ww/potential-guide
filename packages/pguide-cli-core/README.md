# @potential-guide/cli-core

Shared configuration, command protocol, atomic persistence, and ACP/AHP clients used
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

`AgentProfile` is the top-level `type: "acp" | "ahp"` discriminated union
of `AcpAgentProfile` and `AhpAgentProfile`. `validateAgentProfile` returns the
normalized shape; `parseConfig` normalizes every profile, including valid
legacy ACP `connection.type` records. New profiles must not repeat the
discriminator in `connection`. `LegacyAcpAgentProfile` remains accepted by
the ACP client for source compatibility; it is not a third normalized variant.
`redactAgentValue` redacts configured environment secrets and sensitive keys.

`executeAhp` uses official SDK 1.0.0 with explicit wire 1.0.0/0.9.0 negotiation,
WebSocket transport and optional environment-sourced query/resource tokens.
It validates the provider and canonical Host directory, persists Host-confirmed
session/default-chat/turn identities through the required `onSession` callback,
and waits for authoritative turn completion. Callers must provide a bounded
`AbortSignal` covering the complete invocation and durable persistence before
the callback resolves. Resume never allocates a replacement or replays an
uncertain dispatch. `inspectAhp` performs only negotiation/provider/authentication
diagnosis. Neither function starts/stops a Host or grants permissions.
By default, `executeAhp` denies standard AHP execution/result confirmations on the wire
without ending the turn; `onPermission` reports their phase/identity for
caller-owned safe authorization records, and `permissionDenials` counts them.
No callback return value can automatically approve a tool. Standard AHP
metadata lacks an authoritative operation kind and one-use grant semantics.
An AHP profile may explicitly set `confirmations: external` to wait for a human
using a trusted client connected to the same Host/session. In this mode pguide
does not dispatch any execution/result confirmation or select any option.
`onPermission` reports the session/chat/turn/tool identities and phase; waiting
uses the caller's existing bounded signal and cancellation path. It is not a
grant, cannot launch/connect a human client, and must not be enabled unattended.
ACP profiles reject this setting. Omitted `confirmations` and explicit `deny`
retain deny-by-default behavior. Persisted profiles retain the chosen mode.
`permissionDenials` also counts Host-observed denials in external mode; pguide
reports unresolved external denial as `authorization-required` after re-observation,
while verified progress still takes precedence.
See [AHP support and recovery boundaries](../pguide/README.md#ahp-host-support).

ACP profiles keep `connection.protocolVersion: "1"` as a configuration string;
the client validates a positive safe integer and sends the numeric ACP version
on the wire. Initialization requires the same numeric negotiated version.
Session continuation uses standard `session/load` with the advertised
`loadSession` capability. Prompt summaries use streamed `agent_message_chunk`
text (bounded to 1 MiB), falling back to legacy summaries or the stop reason.

Embedders may additionally set `AcpClientOptions.maxOutputBytes` to a positive safe
integer to bound combined raw stdout/stderr, including unterminated lines and
non-message output. Exceeding it rejects pending requests; callers must still
stop the client in `finally` and supply an outer deadline. Optional
`requireEndTurn: true` accepts only an explicit `end_turn` prompt response as
completed. Both options are opt-in to preserve legacy caller behavior; the local
self-check uses them without changing its configured tool permissions.

Windows `killProcessTree` snapshots owned PID/parent relationships through the
system PowerShell/CIM provider (bounded to 5 seconds) before PID-scoped `taskkill`.
If concurrent teardown makes taskkill fail, cleanup succeeds only after every
snapshotted owned PID is observed absent, with at most 500 ms of exit observation.
Root exit alone is not evidence that descendants are gone; live or unobservable
PIDs retain the failure. No localized taskkill output is parsed, no termination is
retried, and an exited root is not targeted again. Snapshot failures remain explicit,
even though termination is still attempted for a live root.

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
