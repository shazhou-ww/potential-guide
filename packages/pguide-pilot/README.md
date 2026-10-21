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

Default output and `--format markdown` share the same human-readable receipts.
Scaffolding reports the destination, manifest, languages and next validation
step. Validation identifies the Objective and explicitly checks only the manifest
and localized references, not runtime readiness; unknown options are rejected.
Observation summaries identify the Objective, current level, problems and Pilot
references, with local attainment guidance and a next action. Observing the real
highest business ID explicitly reports completion; terminal is only its target
alias. Dependency subjects are not printed.

Scaffolds use Manifest v2 and a business `ready` level by default. `--level`
selects a business ID; reserved `initial` and `terminal` are rejected. Intrinsic
initial has no business checks. See [attainment and explicit migration](../../docs/objective-contracts.md).

`--format json` retains the original observation envelope and scaffold/validation
fields. A failed check invocation still returns its observation envelope on stdout
and exit code 6; human summaries include the root cause without implying that the
Objective was successfully observed.

Detailed options: each binary's `--help`; shared behavior:
[command reference](../pguide/README.md), [migration](../../docs/package-layering.md).
