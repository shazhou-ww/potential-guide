# `@potential-guide/config`

Optional official configuration editor for `pguide`. Configuration is standard
YAML and remains usable without this package.

Configuration requires `schemaVersion: 2`. Use
`agentExecutionLimits: { timeoutMs: 30000 }` for each individual Agent execution.
Schema 1 configuration and `limits` (including iteration/stalled budgets) are
explicitly rejected rather than silently reinterpreted.
`regulationStrategy` accepts optional `mode: { type: adhoc }` or
`mode: { type: periodic, intervalMs: 1000 }`, optional
`probe: { timeoutMs: 30000, retry: { maxRetries: 0, delayMs: 0 } }`, and optional
`effectTtlMs`. Defaults are ad hoc execution, a 30000 ms probe timeout, zero
retries and no TTL. `set regulationStrategy '<JSON or YAML object>'` validates
all nested fields before saving; `get regulationStrategy` reads the selection.

The npm package is organization-scoped, while its executable remains
`pguide-config` and advertises the `config` command through
`pguide-command-v1`. Extension package names do not define their command names.

`pguide config edit` opens a temporary copy, validates it, and atomically
replaces the selected configuration only after the editor exits successfully.
