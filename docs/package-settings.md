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
  "pilot.probe": {
    "timeoutMs": 90000,
    "retry": { "maxRetries": 0, "delayMs": 0 }
  }
}
```

User values are overridden by project values **one complete ID at a time**.
Objects and arrays replace, never deep-merge. Explicit objects must include
all required fields. Only an entirely absent setting receives its package's
validated static default; defaults are visible in `config show` sources and are
never written back. Optional settings without defaults remain absent.
`cli-core.stateDirectory` and `pilot.reportDirectory` have dynamic resource-location
semantics, not static path defaults. State-directory relative paths retain process
cwd resolution; report-directory relative paths retain effective `--cwd`.

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
pguide config set pilot.probe '{"timeoutMs":90000,"retry":{"maxRetries":0,"delayMs":0}}'
pguide config unset pilot.probe --scope project
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
| `reports.enabled` | `pilot.reportsEnabled` | `true` |
| `reports.directory` | `pilot.reportDirectory` | none; reports under state root |
| `retentionDays` | `regulate.retentionDays` | none |
| `agentExecutionLimits.timeoutMs` | `regulate.agentTimeoutMs` | `1800000` |
| same explicit timeout | `pguide.diagnoseAhpTimeoutMs` | `30000` |
| `regulationStrategy.quota` | `regulate.quota` | `{"timeoutMs":300000,"maxAgentRuns":10,"maxStallRuns":3}` |
| `regulationStrategy.probe` | `pilot.probe` | `{"timeoutMs":30000,"retry":{"maxRetries":0,"delayMs":0}}` |
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
`pilot.probe` supports three
independent runtime budgets:

```jsonc
"pilot.probe": {
  "timeoutMs": 300000,
  "checkTimeoutMs": 60000,
  "preparationTimeoutMs": 60000,
  "observationBudget": {
    "timeoutMs": 300000,
    "maxDepth": 32,
    "maxObservations": 128
  },
  "retry": { "maxRetries": 0, "delayMs": 0 }
}
```

`preparationTimeoutMs` defaults to 60000 and bounds root preparation, including
local Git inspection. Each lazily prepared dependency also gets this limit, but
its preparation still consumes the **existing** aggregate observation deadline.
`observationBudget` defaults to 30000 ms, depth 32 and 128 logical observations;
reuse hits still consume the logical count and depth checks. `checkTimeoutMs`
defaults to `timeoutMs` for backward compatibility and bounds each isolated
process check. `timeoutMs` retains the Regulation outer probe deadline and retry
semantics; increasing a check timeout alone never extends the aggregate deadline.
All three settings reach probe and regulate observation bindings.
Diagnostics distinguish `source-preparation-timeout`, `observation-timeout`,
`observation-budget` and `check-timeout`, and retain Objective/check identity.
Continue keeps archived profiles, timeouts, probe/quota and pinned sources,
but re-reads **current** permissions and state/report locations. The saved
permission snapshot never authorizes a new attempt. ACP diagnosis is unaffected.

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
