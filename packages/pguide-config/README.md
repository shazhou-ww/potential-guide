# pguide-config

Optional official configuration editor for `pguide`. Configuration is standard
YAML and remains usable without this package.

`pguide config edit` opens a temporary copy, validates it, and atomically
replaces the selected configuration only after the editor exits successfully.
