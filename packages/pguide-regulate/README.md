# @potential-guide/pguide-regulate

Optional `pguide-regulate` and `pguide-continue` commands. These cooperate through
persisted regulation state and Agent sessions, so ship together. Standalone
binaries do not require `pguide`; install alongside it to discover `regulate`
and `continue`. Agent execution and process-worker helpers are public tool APIs
used by supervision without a reverse dependency.

Use `--help` for options, [command reference](../pguide/README.md) for execution,
permissions and persistence, and [migration](../../docs/package-layering.md) for
installation. Existing output envelopes and exit codes are preserved.
