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

## Objective registry

`add-objective`、`update-objective` 已退役并明确拒绝写入；使用
`pguide objectives set|migrate` 将带显式 inputSchema 和 JSONata subject 的声明保存到
独立 objectives.yaml。迁移不猜测旧来源别名的输入或绑定意图。
`remove-objective <name>` 和 `list-objectives` 保留旧 config.objectives 的清理与查询。
Names are lowercase kebab-case. Local registrations are saved as absolute paths
relative to `--cwd`; Git URIs are saved unchanged. Entries cannot reference other `@names`.
Edits validate the complete configuration before atomically saving it.

Legacy removal defaults to `--scope project`; `--scope user` and
`--scope explicit --config <path>` work as for Agent profiles. Removal requires an entry in that
scope. Legacy source aliases merge by name, with project overriding user and explicit
overriding project. Removing an override exposes a lower-scope entry if present.
Listing returns effective names, locations and configuration sources.
The default output shows each Objective in a separate block, with labeled
`Location` and `Source` lines and full, untruncated paths or Git URIs.
An empty registry prints `No registered Objectives.` Use `--format json` for
machine-readable output; each entry now explicitly marks `semantics: legacy-source-alias`.

`probe`, `regulate` and portfolio goal `pilot` fields accept registered names.
Registration is optional: paths and Git URIs can still be used directly.
Use `@name` to require a registered Objective or `./name` to force a local path.
The machine-readable list contains `schemaVersion: 1` and an `objectives` array
of entries with `name`, `location` and `source`.
See [stdin and registry examples](../pguide/README.md#json-subjects-from-stdin-and-the-objective-registry).

`regulationPermissions` is an optional administrative setting, defaulting to
deny-all: `{ceiling: [{id: "edit-result", operation: "edit", resources:
["D:\\work\\result.json"]}], grants: ["edit-result"]}`. Read/edit rules contain
nonempty absolute exact filesystem paths; execute rules instead contain an exact
complete `command`. Rule IDs are unique and grants must be a subset of those IDs.
No wildcard or directory-recursive authority is inferred.
`pguide config set regulationPermissions '<JSON or YAML object>' --scope user`
validates and saves the complete setting; `get regulationPermissions` reads it.
Normal user/project/explicit configuration precedence applies, so protect every
source as trusted administrative input. Subjects and planners cannot grant
permissions. `continue` uses current permissions, not the persisted old ceiling.
These settings mediate ACP requests only; preauthorized Agent flags can bypass
them, and exact commands are not sandboxed. See the pguide permission guide.
For standard AHP requests, operation classification and one-use approval are
not reliably declared; configured grants are not inferred from tool names or
inputs. Such requests receive an explicit denial and safe `unknown`
authorization feedback, not silent policy bypass.

Agent profiles use top-level `type: acp | ahp`; `connection.type` is accepted
only in a valid legacy ACP profile and is normalized away on save. The editor,
`add-agent`, `update-agent`, `show-agent`, `get` and `list-agents` share the same
validator and normalized profiles. `list-agents` includes the protocol `type`
alongside protocol version and transport. Mixed/missing selectors and
credential literals are rejected without replacing the configuration.
See [protocol configuration](../pguide/README.md#protocol-selection-and-legacy-acp-profiles)
and [AHP connection prerequisites](../pguide/README.md#ahp-host-support).
