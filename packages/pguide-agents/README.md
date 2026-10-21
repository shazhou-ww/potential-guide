# @potential-guide/pguide-agents

Independent Agent resources and management for pguide. Installed with `pguide`,
or install this package to expose `pguide-agents`.

`pguide agents list|show|set|remove|edit|validate|path|migrate` manages two scopes:
`user` and `project`. Writes require `--scope`. Files are `agents.yaml` beside
the corresponding `config.yaml`; a project resource can exist without a main
config. Discovery uses the nearest existing project main config directory; if
there is no project main config, it uses the nearest existing project Agent
resource, or `--cwd\.pguide` for a new resource. An explicit main config does
not affect that discovery.
Project profiles replace same-name user profiles completely; no protocol fields
are deep-merged. Read commands show the selected scope and path. `--config`
continues to select a main config only, not an extra Agent scope.

Default and `--format markdown` output includes labeled names, types, scopes
and source files. Lists summarize profiles; `show <name>` expands the redacted
profile in a YAML code block. Empty lists include discovery paths and an
actionable `set` command. Writes identify the action, target, scope and file;
migration also reports the exact source backup. `--format json` preserves the
existing envelopes and redaction. In JSON mode editor stdout is redirected to
stderr so a successful `edit` emits only the parseable result on stdout.
`validate` checks resources offline, not initialization, authentication or repair.

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json
agents:
  local:
    type: acp
    connection: { protocolVersion: "1" }
    transport: { type: stdio, command: my-agent, env: [AGENT_TOKEN] }
```

Use `pguide agents set local --from profile.yaml --scope project` to replace a
whole profile. `profile.yaml` contains the profile, not the file wrapper.
`defaultAgent: local` remains in the YAML main config. ACP and AHP profiles use
the same offline validator as regulation and supervision. Unknown schema URIs
are rejected without network access. Values must reference credentials through
environment names, never embed credentials.
The public schema uses Draft2020-12. New resource files and `set` inputs require
canonical top-level `type: acp|ahp`; untyped legacy ACP definitions are rejected.
Only explicit `migrate` normalizes old embedded profiles into this canonical form.
Main configuration and Objective-only commands do not validate Agent resources;
profile-consuming commands explicitly use the shared loader and fail on invalid files.

Old embedded main-config `agents` are rejected. Run
`pguide agents migrate --scope user` or `--scope project` explicitly. An optional
`--legacy-config <path>` must refer to the main file beside the selected resource.
Migration validates all profiles, rejects destination name conflicts, keeps an
exact private `.agents-migration.<id>.bak` source backup, and removes only the
YAML `agents` node, preserving other fields and comments. Unknown main-config
fields are preserved, not silently accepted by the runtime.

Writes use private files, cooperative exclusive locks, atomic replacement and
snapshot checks. Malformed existing resources are never overwritten. Editor
changes are validated in a separate draft; concurrent changes cancel the write.
Inspect interrupted `.lock` files before manually removing them. Migration
rollback restores the destination on source-write failure while the original
source remains unchanged. If the source has already committed or another writer
changed it, the validated destination is retained to prevent profile loss; inspect
both files and the backup before retrying. The retained source backup
also supplies crash-recovery evidence. This is not a distributed multi-file
transaction: after abrupt process termination, inspect both endpoints and the
backup before retrying. No operation grants permissions or changes trust ceilings.
