# @potential-guide/pguide-pilot

Default Pilot authoring and observation commands: `pguide-probe`,
`pguide-scaffold`, `pguide-validate`. Installed with `pguide`, or independently
for standalone use. `pguide` exposes `probe`, `scaffold`, `validate` even when
transitive bins are not on PATH, through the public `./bin/probe`,
`./bin/scaffold`, and `./bin/validate` exports. They share source/definition
conventions and preserve existing options, output envelopes and exit codes.

```sh
pguide-scaffold pilot ./objective --check ready --problem not-ready
pguide-validate pilot ./objective
pguide-probe --help
```

Detailed options: each binary's `--help`; shared behavior:
[command reference](../pguide/README.md), [migration](../../docs/package-layering.md).
