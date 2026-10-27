# @potential-guide/cli-core

Shared configuration, command protocol, atomic persistence, and ACP/AHP clients used
by the `pguide` command packages. This package is an implementation component;
most users should install `pguide` and the desired command packages instead.

## Output compatibility

Ordinary commands default to human-readable Markdown; `--format json` selects
their existing machine envelope. Human summaries identify the result, its scope
and source, and an applicable next action. Lists have explicit empty states;
details may include fenced configuration or schema content. Shared Markdown
helpers escape dynamic labels, fence paths and code safely, and remove terminal
formatting from displayed values without changing their machine representation.

For compatibility, ordinary command results and error envelopes retain stdout
and their existing exit codes. Diagnostics from child editors belong on stderr
when JSON output is requested. The contract migration tool has its own
documented result-format option and retains stderr for ordinary usage failures.
These stream boundaries are deliberate: changing an error's presentation does
not silently change its machine category, process status, or output stream.

`CliError.humanMessage` optionally provides readable input issues while
`message`, `status`, `exitCode`, and `guidance` retain the existing machine
contract. `formatCliError` shares this presentation between standalone commands
and the main dispatcher. Optional human details are not serialized as machine
fields. Observation input failures carry structured issues or supported locales
through the runtime instead of reparsing error-message text.

Shell completion scripts, command-discovery metadata, raw `config get` values,
Objective check/runtime envelopes, and report files remain machine or verbatim
outputs. Do not wrap them in human headings or infer Objective completion from
a successful observation or a scheduler interval.

## Resources and execution

Agent profiles are loaded from independent user/project `agents.yaml` resources,
not `PguideConfig`. `loadAgents(cwd)` explicitly loads the effective whole-profile
map, source scopes and paths only for profile-consuming commands. `loadConfig`
does not read or validate Agent resources, so malformed resources cannot break
unrelated config or Objective operations. Main configuration has only user/project
JSONC scopes, never a third Agent scope. `parseAgents` validates canonical discriminated
profiles offline and rejects unknown schema URIs and untyped legacy profiles;
only explicit migration normalizes embedded legacy ACP definitions.
The Draft2020-12 public schema is exported at
`@potential-guide/cli-core/schemas/agents/v1.json`.
Agent profiles inherit credentials only by environment-variable name; common
secret-bearing transport arguments are rejected before profiles can be shown
or persisted. Main configuration is a generic complete-ID JSONC record, with
per-package static schemas and whole-setting defaults. `loadConfig(cwd, namespaces)`
checks each selected layer for the consumer's namespaces; omitted namespaces
validate all, and `[]` gives the neutral issue-bearing view. Syntax, duplicates,
descriptor damage and ownership conflicts always fail. `setting<T>` and
`requiredSetting<T>` let consumers own their types, including third-party packages.
`parseConfig` parses JSONC structure, while `inspectSettings` validates values
against the loaded catalog. `parseLegacyConfig` is reserved for explicit
independent-resource migration, never ordinary main-config loading.
Metadata-only imports do not initialize JSONC/YAML parsers, built-in settings
validators or the AHP SDK. These load when their operation needs them; only
immutable code and bundled descriptions are reused. Registered descriptions,
configuration values and Agent resources are still read and validated on each
explicit load, and existing execution deadlines are unchanged.
See [package settings](../../docs/package-settings.md) for defaults, registration,
comment-preserving edits and manual migration. `regulate.quota` remains separate
from `pilot.probe` and the regulation/diagnostic Agent timeouts.
Periodic request scheduling belongs to the Coordinator library.
The generic JSON `digest` utility supports persisted subject integrity;
production observation identity/version comes from the Git source commit.

`AgentProfile` is the top-level `type: "acp" | "ahp"` discriminated union
of `AcpAgentProfile` and `AhpAgentProfile`. `validateAgentProfile` returns the
normalized shape for internal/persisted callers, including valid legacy ACP
`connection.type` recovery records and explicit migration inputs.
`parseConfig` rejects legacy top-level fields and embedded profiles; `parseAgents` requires canonical ones.
New profiles must not repeat the
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

Windows `killProcessTree` snapshots owned PID/parent relationships through
Toolhelp32 (`TH32CS_SNAPPROCESS`, `Process32FirstW`/`Process32NextW`), using in-memory
C# P/Invoke compiled by the fixed system PowerShell host (bounded to 10000 ms),
before PID-scoped `taskkill`. It does not depend on CIM/WMI services, inspect process
memory, or install a native package/binary. `PROCESSENTRY32W` uses the host's
pointer-sized `ULONG_PTR` and sequential Win32 layout (568 bytes in a 64-bit host,
556 in a 32-bit host, with maximum packing of 8); only numeric PID/parent PID
rows leave the subprocess. Invalid snapshot handles and native enumeration errors
fail explicitly; only `ERROR_NO_MORE_FILES` ends enumeration normally. Every valid
snapshot handle is closed in `finally`, including enumeration failures.
If concurrent teardown makes taskkill fail, cleanup succeeds only after every
snapshotted owned PID is observed absent, with at most 500 ms of exit observation.
Root exit alone is not evidence that descendants are gone; live or unobservable
PIDs retain the failure. No localized taskkill output is parsed, no termination is
retried, and an exited root is not targeted again. Snapshot failures remain explicit,
even though termination is still attempted for a live root.

The snapshot watchdog bounds internal ownership measurement, not Agent execution,
regulation, subject or process execution. In setup it runs inside the current
regulation/sanity work; existing subject and outer-process cancellation can stop
the containing tree earlier. It grants no additional execution time and does not
guarantee the query gets 10000 ms. Setup's default 20000 ms subject, 24000 ms Pilot
cap under the default 30000 ms process budget, and explicit 60000/75000 ms local
budgets are unchanged. The 6000 ms outer headroom covers startup/output and outer
runtime teardown (including its own taskkill), not this inner snapshot query.
SSH limits and consent are unchanged.

The fixed PowerShell query accepts no input, so its owner ends the subprocess's
stdin pipe immediately rather than leaving it waiting for EOF. That child session
disables module autoload and explicitly imports only the built-in
`Microsoft.PowerShell.Utility` manifest at the absolute `$PSHOME\Modules` path;
`Add-Type` and `ConvertTo-Json` are module-qualified. It does not discover modules
through inherited `PSModulePath`, change the parent's environment, or bypass
execution policy/security checks. Failure diagnostics
expose only fixed error labels, a bounded unsigned Win32 error code (`nativeCode`,
or `none`), and the last fixed script phase: `unreported`, `started`, `importing`,
`imported`, `compiling`, `compiled`, `query-started`, `queried`, `serialized` or
`exiting`. `importing` brackets the explicit trusted import; `compiling` is emitted
only after it succeeds, immediately before the module-qualified `Add-Type` call.
Explicit import, compilation and native enumeration share the same
watchdog; there is no additional import or compilation
allowance. `exiting` means the command body finished,
not that process exit and stdio closure have been acknowledged. No arbitrary
stderr, paths or authentication data are forwarded.

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
