# `@potential-guide/config`

Optional official configuration editor for `pguide`. Configuration is standard
YAML and remains usable without this package.

Configuration requires `schemaVersion: 2`. Use
`agentExecutionLimits: { timeoutMs: 30000 }` for each individual Agent execution.
Schema 1 configuration and the legacy top-level `limits` are
explicitly rejected rather than silently reinterpreted.
`regulationStrategy` accepts optional
`quota: { timeoutMs: 300000, maxAgentRuns: 10, maxStallRuns: 3 }` and
`probe: { timeoutMs: 30000, retry: { maxRetries: 0, delayMs: 0 } }`.
These are the CLI defaults. A run finishes on reaching its target or quota;
scheduling belongs to supervisor. Removed `mode` and `effectTtlMs` are rejected.
`set regulationStrategy '<JSON or YAML object>'` validates
all nested fields before saving; `get regulationStrategy` reads the selection.

The npm package is organization-scoped, while its executable remains
`pguide-config` and advertises the `config` command through
`pguide-command-v1`. Extension package names do not define their command names.

`pguide config edit` opens a temporary copy, validates it, and atomically
replaces the selected configuration only after the editor exits successfully.
