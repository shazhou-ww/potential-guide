# pguide

The Potential Guide CLI discovers and dispatches `pguide-<command>` executables.
It installs `config`, `agents` and `objectives`; `diagnose` and `complete` are
built in. The old `probe`, `check`, `validate` and `scaffold` command
implementations and `@potential-guide/pguide-pilot` are retired. No empty
`pguide-probe` or `pguide-check` package is created in advance.

The optional [`pguide-task-bundle`](../pguide-task-bundle/README.md) extension
provides `task-bundle init`, `check` and `build`. The optional
[`pguide-task-engine`](../../apps/pguide-task-engine/README.md) extension provides
foreground loopback Engine and optional Web UI startup. These are new
architecture commands, not replacements that translate old Objective state.
New checks use [`check-sdk`](../check-sdk/README.md); see
[`check-environment`](../check-environment/README.md) for complete examples.

```sh
pguide config path
pguide config validate
pguide agents list
pguide agents validate
pguide objectives list
pguide diagnose
pguide complete --shell powershell
```

`regulate` and `continue` remain optional legacy command wrappers that explicitly
reject execution. Neither historical records nor source formats are replayed or
converted automatically.

## Discovery and dispatch

Configured command directories take precedence over PATH. The cwd PATH entry
is excluded, duplicate same-priority executables fail as ambiguous, and
`pguide-command-v1` metadata is required. When no external candidate or conflict
exists, config/agents/objectives use the installed dependencies' public bin
exports through the current Node runtime. This works even if transitive bins
are not exposed; help and diagnosis report source `bundled`.

Incompatible external commands and conflicts are never hidden by fallback.
Generic third-party discovery is unchanged, so remove independently installed
old Pilot binaries from PATH; their presence does not restore bundled support.
Future independently implemented probe/check extensions can use ordinary
discovery without a legacy implementation or pre-created package.

Missing retained optional commands identify their installation package.
Missing retired commands do not advertise a replacement package to install.
`@potential-guide/config` was renamed to `@potential-guide/pguide-config`;
uninstall the old name to avoid competing `pguide-config` binaries.

## Configuration and resources

Main settings use user/project `config.jsonc`, not command-line overlays.
Only the separate task-engine service extension accepts `--config`.
See [settings and migration](../../docs/package-settings.md), the
[config command](../pguide-config/README.md), independent
[Agent resources](../pguide-agents/README.md) and
[Objective declarations](../pguide-objectives/README.md).

Resource lists show identity, scope and provenance with explicit empty states;
detail views show schema/subject or redacted profiles. Writes require explicit
scope and identify the changed file. Editor chatter goes to stderr in JSON
mode. JSON envelopes and exit codes remain distinct from human Markdown.
`config validate`, `agents validate`, and the new Task Bundle `check`
subcommand are retained; they are not the removed top-level validation command.

Objective declarations may still be inspected and managed without executing
them. The removed CLI no longer validates legacy `objective.json` artifact
directories. No source resolution or execution is implied by listing a
declaration.

## Diagnosis, completion and service extensions

`pguide diagnose` reports configuration paths, command sources and conflicts
without starting an Agent. `pguide diagnose agent <profile>` explicitly starts
the selected ACP/AHP connection and reports initialization; it does not prove
authentication, permissions or successful repair.
`complete` emits an unadorned shell script, not a Markdown envelope.

The task-engine extension uses CLI > explicit YAML/JSON > user JSONC > defaults;
project service settings are excluded. With `--no-global-config`, expose the
extension through PATH or project commandDirectories rather than user config.
See [service configuration](../../docs/task-server.md) and
[Task Bundle authoring](../pguide-task-bundle/README.md).

Keep tokens out of settings, subjects, logs and distributed Bundles. Agent
credentials remain references managed by the selected transport. See the
Agent command documentation for ACP, AHP and permission boundaries.
