# `@potential-guide/pguide-config`

Official configuration editor, installed by default with `pguide`. It can also
be installed independently for the standalone `pguide-config` executable:

```sh
npm install --global pguide
# Or, for the standalone editor only:
npm install --global @potential-guide/pguide-config
```

The former published name `@potential-guide/config` is retired; replace explicit
dependencies/install scripts and remove the old installation to avoid duplicate
`pguide-config` shims. Existing published versions are not renamed or unpublished.
The executable and `config` command metadata are unchanged; new release tags are
`pguide-config-v*` instead of `config-v*`. The public `./bin/config` export lets
`pguide` dispatch via Node even when transitive binaries are not on PATH.
Configuration is JSONC with literal complete setting IDs and no top-level
schemaVersion. User `config.jsonc` and the nearest project `.pguide/config.jsonc`
merge shallowly; objects and arrays replace as a whole. Static package defaults
apply only to missing settings. Old YAML and `--config`/explicit scope are rejected.
See [package settings and manual migration](../../docs/package-settings.md) for
the complete mapping, three independent Agent timeouts, descriptor format and
explicit `config packages register|unregister <root>` recovery commands.

`set pilot.probe '<JSONC object>'` validates the complete timeout/retry object;
`get pilot.probe` reads that whole setting, not a nested path. Known settings
must validate; unknown namespaces may be saved with an unverified warning.
Set/unset retain untouched comments and ordering. Registration never installs
or executes packages; same-identity upgrades revalidate automatically.

The npm package is organization-scoped, while its executable remains
`pguide-config` and advertises the `config` command through
`pguide-command-v1`. Extension package names do not define their command names.

`pguide config edit` opens a temporary copy, validates it, and atomically
replaces the selected configuration only after the editor exits successfully.
Successful edits print a save receipt with scope and file. `--format json`
adds the previously missing success result
`{schemaVersion: 1, status: "updated", path}`; editor stdout goes to stderr in
that mode, keeping stdout independently parseable. Failed edits never report
successful saving.

Default and `--format markdown` reports use headings and labeled paths.
`show` includes redacted effective JSON and complete-ID provenance, explaining
user → nearest project precedence and static defaults. It also exposes invalid
and unverified items. `get` intentionally remains an
unadorned raw value; no heading or provenance is added. Existing JSON fields,
envelopes and exit codes are unchanged for other operations.

## Objective registry

`add-objective`、`update-objective` 已退役并明确拒绝写入；使用
`pguide objectives set|migrate` 将带显式 inputSchema 和 JSONata subject 的声明保存到
独立 objectives.yaml。迁移不猜测旧来源别名的输入或绑定意图。
`remove-objective <name>` 和 `list-objectives` 保留迁入 `objectives.aliases` 的旧来源别名清理与查询。
Names are lowercase kebab-case. Local registrations are saved as absolute paths
relative to `--cwd`; Git URIs are saved unchanged. Entries cannot reference other `@names`.
Edits validate the complete configuration before atomically saving it.

Legacy removal defaults to `--scope project`; `--scope user` selects the user
main file. Removal requires an entry in that scope. The aliases object replaces
as a whole; unset `objectives.aliases` to expose the lower-layer object.
Listing returns effective names, locations and configuration sources.
The default output shows each legacy alias in a separate labeled bullet, with
`Location` and `Source` lines and full, untruncated paths or Git URIs.
An empty registry prints `No registered Objectives.` and explains the effective
search scope and declaration-management commands. Use `--format json` for
machine-readable output; each entry now explicitly marks `semantics: legacy-source-alias`.

`probe`, `regulate` and portfolio goal `pilot` fields accept registered names.
Registration is optional: paths and Git URIs can still be used directly.
Use `@name` to require a registered Objective or `./name` to force a local path.
The machine-readable list contains `schemaVersion: 1` and an `objectives` array
of entries with `name`, `location` and `source`.
This CLI response is not an Objective declaration document and does not carry
the declaration file's `$schema` URI.
See [stdin and registry examples](../pguide/README.md#json-subjects-from-stdin-and-the-objective-registry).

`regulate.permissions` is an optional administrative setting, defaulting to
deny-all: `{ceiling: [{id: "edit-result", operation: "edit", resources:
["D:\\work\\result.json"]}], grants: ["edit-result"]}`. Read/edit rules contain
nonempty absolute exact filesystem paths; execute rules instead contain an exact
complete `command`. Rule IDs are unique and grants must be a subset of those IDs.
No wildcard or directory-recursive authority is inferred.
`pguide config set regulate.permissions '<JSONC object>' --scope user`
validates and saves the complete setting; `get regulate.permissions` reads it.
Normal user/project configuration precedence applies, so protect every
source as trusted administrative input. Subjects and planners cannot grant
permissions. `continue` uses current permissions, not the persisted old ceiling.
These settings mediate ACP requests only; preauthorized Agent flags can bypass
them, and exact commands are not sandboxed. See the pguide permission guide.
For standard AHP requests, operation classification and one-use approval are
not reliably declared; configured grants are not inferred from tool names or
inputs. Such requests receive an explicit denial and safe `unknown`
authorization feedback, not silent policy bypass.

Agent definitions are no longer main configuration. `list-agents`, `show-agent`,
`add-agent`, `update-agent` and `remove-agent` fail with actionable guidance to
`pguide agents`. `config set agents` and edits introducing embedded profiles
are rejected, never silently read in compatibility mode.
Run `pguide agents migrate --scope user|project` explicitly for old files.
The main config retains `agents.defaultAgent`, permission ceilings and ordinary settings;
Agent resources have only USER and PROJECT scopes, not an explicit overlay.
See the [resource manager](../pguide-agents/README.md) for offline validation,
credential references, whole-profile precedence and migration recovery.
See [protocol configuration](../pguide/README.md#protocol-selection-and-legacy-acp-profiles)
and [AHP connection prerequisites](../pguide/README.md#ahp-host-support).
