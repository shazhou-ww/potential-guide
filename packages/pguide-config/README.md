# `@potential-guide/config`

Optional official configuration editor for `pguide`. Configuration is standard
YAML and remains usable without this package.

The npm package is organization-scoped, while its executable remains
`pguide-config` and advertises the `config` command through
`pguide-command-v1`. Extension package names do not define their command names.

`pguide config edit` opens a temporary copy, validates it, and atomically
replaces the selected configuration only after the editor exits successfully.
