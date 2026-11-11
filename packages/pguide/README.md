# pguide

The Potential Guide CLI discovers and dispatches `pguide-<command>` executables.
It installs `config`, `agents` and `objectives`; `diagnose` and `complete` are
built in. The old `probe`, `check`, `validate` and `scaffold` command
implementations and `@potential-guide/pguide-pilot` are retired. No empty
`pguide-probe` or `pguide-check` package is created in advance.

Task construction and execution have moved to
[silvermoon-work/task-engine](https://github.com/silvermoon-work/task-engine).
Install `@silvermoon-work/task-builder-cli` and `@silvermoon-work/task-engine-cli`
and invoke their standalone `task-builder` and `task-engine` commands, not
`pguide` extensions. This repository retains Check and Objective definitions.
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
See [settings and migration](../../docs/package-settings.md), the
[config command](../pguide-config/README.md), independent
[Agent resources](../pguide-agents/README.md) and
[Objective declarations](../pguide-objectives/README.md).

Resource lists show identity, scope and provenance with explicit empty states;
detail views show schema/subject or redacted profiles. Writes require explicit
scope and identify the changed file. Editor chatter goes to stderr in JSON
mode. JSON envelopes and exit codes remain distinct from human Markdown.
`config validate` and `agents validate` are retained; they are not the removed
top-level validation command.

Objective declarations may still be inspected and managed without executing
them. The removed CLI no longer validates legacy `objective.json` artifact
directories. No source resolution or execution is implied by listing a
declaration.

## Diagnosis and completion

`pguide diagnose` reports configuration paths, command sources and conflicts
without starting an Agent. `pguide diagnose agent <profile>` explicitly starts
the selected ACP/AHP connection and reports initialization; it does not prove
authentication, permissions or successful repair.
`complete` emits an unadorned shell script, not a Markdown envelope.

Keep tokens out of settings, subjects, logs and distributed Bundles. Agent
credentials remain references managed by the selected transport. See the
Agent command documentation for ACP, AHP and permission boundaries.
