# Package settings and manual migration

Main configuration is **JSONC only**. `pguide config path` reports the user
`config.jsonc` (`%APPDATA%\pguide\config.jsonc` on Windows, or
`$XDG_CONFIG_HOME/pguide/config.jsonc`, falling back to `~/.config/pguide`)
and the nearest `.pguide/config.jsonc` discovered upwards from effective `--cwd`.
Only that project file participates. A missing file is permitted for ordinary
commands; setup/self-check additionally require at least one actual discovered file.

```jsonc
{
  // Complete IDs: dots are literal, not nested object paths.
  "agents.defaultAgent": "local",
  "regulate.quota": {
    "timeoutMs": 90000,
    "maxAgentRuns": 2,
    "maxStallRuns": 1
  }
}
```

User values are overridden by project values **one complete ID at a time**.
Objects and arrays replace, never deep-merge. Explicit objects must include
all required fields. Only an entirely absent setting receives its package's
validated static default; defaults are visible in `config show` sources and are
never written back. Optional settings without defaults remain absent.
`cli-core.stateDirectory` has dynamic resource-location semantics, not a static
path default. State-directory relative paths retain process cwd resolution.
The removed Pilot command package no longer supplies `pilot.probe`,
`pilot.reportsEnabled` or `pilot.reportDirectory` descriptors/defaults.

Syntax errors, duplicate keys (including nested keys), descriptor/registration
damage and namespace conflicts always fail. Every selected layer is checked;
an override cannot hide an invalid lower-scope value. Commands reject semantic
errors in namespaces they consume, including shared namespaces, without being
blocked by unrelated namespaces. `config show` exposes `issues`, `unverified`,
`files` and complete-ID `sources`; `config validate` reports all known errors.
Unknown namespaces are retained and reported as unverified, not rejected.
Validation with only unknown namespaces exits successfully with status
`unverified`, not `valid`. No validation result proves Agent authentication.

## Editing and registration

```powershell
pguide config set agents.defaultAgent '"local"' --scope user
pguide config get agents.defaultAgent
pguide config set regulate.quota '{"timeoutMs":90000,"maxAgentRuns":2,"maxStallRuns":1}'
pguide config unset regulate.quota --scope project
pguide config edit --scope user
```

`set` accepts a JSONC value. Complete IDs never mean dot-path traversal.
Local edits preserve untouched key order and comments. Invalid known settings
and structural errors cannot be saved; unknown namespaces can be saved with
an explicit stderr warning. Editor failures preserve the original file. JSON
mode keeps editor chatter on stderr and emits the existing save receipt.
`get` remains a raw human-readable value, without headings.
Project writes target **effective cwd's** `.pguide/config.jsonc`, not an ancestor's
discovered file; receipts identify the actual target.

Packages own explicit namespaces rather than inheriting ownership from their names.
A package includes `settings.json` in its published files and declares:

```json
{ "name": "@example/tools", "pguide": { "settings": "./settings.json" } }
```

```json
{
  "schemaVersion": 1,
  "namespace": "example-tools",
  "settings": {
    "example-tools.enabled": {
      "description": "Enable the package feature.",
      "schema": { "type": "boolean" },
      "default": true
    }
  }
}
```

The namespace matches `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`; all IDs begin with
that namespace plus a dot. Descriptions use synchronous, locally compiled JSON Schema
(Draft 7 supported by bundled AJV); invalid/unsupported schemas fail at registration.
Defaults must validate. Schemas are not fetched, and descriptor loading never
executes package code. Built-in descriptions are generated at build time from
their owning package metadata; they do not introduce command runtime dependencies.
Third parties need no changes to a central TypeScript setting enumeration.

After installing a third-party package **with an external package manager**:

```powershell
pguide config packages register D:\installed\example-tools
pguide config packages path
pguide config packages unregister D:\installed\example-tools
```

The standalone `pguide-config packages ...` has the same behavior. Registration
is user-level, independent of value scopes, in `settings-packages.json` beside
the user main configuration. It records package name, canonical installation
root and namespace, not a version approval. Same-root, same-name, same-namespace
upgrades are revalidated automatically. Identity or namespace changes require
explicit unregister/register. Different owners cannot share a namespace;
conflicting descriptions from the same owner also fail. Identical descriptions
and repeated roots are deduplicated.

Missing/damaged registered packages or descriptors fail closed, even for an
unrelated command. Restore the package or use `packages unregister` to remove
its exact root; this recovery operation does not load registered package code
or require normal discovery. `packages path` remains usable with a damaged registry:
back up and manually repair the file's
`{"schemaVersion":1,"packages":[{"name":"...","root":"absolute path","namespace":"..."}]}`
structure. Do not silently delete registrations or scan for a replacement.
Registration grants no execution permission and does not install anything.

## Manual migration from YAML v2

There is no main-config migration command. Back up the old files first. Translate
each explicitly configured field using this table into the same user/project
scope, retaining all values. Omit old `schemaVersion: 2`. Move old `config.yaml`
or `config.yml` out of discovery after migration: old files are rejected even
when new JSONC exists beside them, and discovery never skips a nearer old file
to select a farther new file.

| Old field | Complete ID | Static default when the whole setting is absent |
| --- | --- | --- |
| `defaultAgent` | `agents.defaultAgent` | none |
| `commandDirectories` | `pguide.commandDirectories` | `[]` |
| `defaultLanguage`, `format`, `color`, `logLevel`, `stateDirectory` | `cli-core.<sameName>` | none |
| `reports.enabled` | retired; remove rather than map | none |
| `reports.directory` | retired; remove rather than map | none |
| `retentionDays` | `regulate.retentionDays` | none |
| `agentExecutionLimits.timeoutMs` | `regulate.agentTimeoutMs` | `1800000` |
| same explicit timeout | `pguide.diagnoseAhpTimeoutMs` | `30000` |
| `regulationStrategy.quota` | `regulate.quota` | `{"timeoutMs":300000,"maxAgentRuns":10,"maxStallRuns":3}` |
| `regulationStrategy.probe` | retired with the old Pilot CLI; no replacement mapping | none |
| `regulationPermissions` | `regulate.permissions` | `{"ceiling":[],"grants":[]}` |
| `objectives` | `objectives.aliases` | `{}` |

Copy a valid **explicit** old timeout into all three timeout settings. An absent
timeout or empty old `agentExecutionLimits` object does not count as explicit;
retain the three distinct defaults. Timer values are integers `1..2147483647`;
retry delay also permits zero. Counts are safe integers; retries allow zero,
quota run/stall counts require positive values. See each package's `settings.json`
for exact field constraints. Permission rules retain uniqueness, exact absolute
non-glob resources and grants-within-ceiling checks; never invent grants.

Do not accidentally activate previously stored language/format/color/log-level
preferences: CLI option behavior is unchanged. Existing `PGUIDE_FORMAT`,
`PGUIDE_LANGUAGE`, and `PGUIDE_STATE_DIRECTORY` overrides remain visible as
`environment`, not a third file layer. Other CLI/env inputs remain supported.
`--config` (including `--config=...`) and main-config `--scope explicit` are
retired with explicit diagnostics; use user/project discovery and `--cwd`.

Quota belongs to regulation. The retired `supervise.agentTimeoutMs` setting
should be removed; it no longer has a built-in descriptor or default.
The old Pilot probe/report settings should also be removed from active settings.
Unknown namespaces remain visible as unverified, not as restored command
support. No old timeout or retry setting is silently translated to Task Bundle
execution. Saved regulation records are not resumed or rewritten by this
cleanup; the remaining legacy continuation wrapper rejects execution.
ACP/AHP diagnosis and resource/config validation are unaffected.

Independent `agents.yaml` and `objectives.yaml` resources keep their locations
and schemas; do not re-migrate them. The explicit resource migration commands'
`--legacy-config` remains a YAML-only migration input, not a main-config overlay.
Aliases now replace as a whole object; removing one alias does not expose a
lower-layer alias until the overriding setting itself is unset.

## setup/self-check declarations

New setup/self-check subject contracts reject `configPath`; there is no assertion
or optional compatibility form. Discovery uses the target user's normal directory
and `workingDirectory`, never scratch. At least one actual selected `config.jsonc`
must exist, otherwise `configuration-missing`; invalid configuration reports
`configuration-invalid`. Defaults or independent Agent resources do not satisfy
this presence check. `userHome` still changes HOME/USERPROFILE only, not APPDATA
or XDG precedence. SSH discovers B's configuration without uploading A's state.

After backing up local declarations/inputs, remove only the relevant
setup/self-check JSONata subject projection's `configPath` field. Remove its
inputSchema property/required/dependency and input value **only where actually
dependent on that field**; preserve all other required fields, permissions,
names, URIs, model selections, budgets and directories. Do not rebuild
`objectives.yaml`, run resource migrations, or rewrite old pinned snapshots
or continue archives. The outer `objective/v1.json` and `objectives/v1.json`
schema identities do not change. Validate the projection and binding against
the newly accepted source revision, not an edited historical pin.

Setup creates its own bounded fixture JSONC with the existing effective
permissions, not new grants, and isolates state/reports. Self-check still uses
one direct sanity session with `allow_once`, not nested regulation or
`allow_always`. Preserve explicit long probe budgets (for example 90000 ms)
independently of the three Agent timeout settings.
