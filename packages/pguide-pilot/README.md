# @potential-guide/pguide-pilot

Optional Pilot authoring and observation commands: `pguide-probe`,
`pguide-scaffold`, `pguide-validate`. Install independently, or alongside `pguide`
to discover `probe`, `scaffold`, `validate`. They share source/definition
conventions and preserve existing options, output envelopes and exit codes.

```sh
pguide-scaffold pilot ./objective --check ready --problem not-ready
pguide-validate pilot ./objective
pguide-probe --help
```

Detailed options: each binary's `--help`; shared behavior:
[command reference](../pguide/README.md), [migration](../../docs/package-layering.md).
