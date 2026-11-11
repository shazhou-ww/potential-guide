# @potential-guide/cli-runtime

Tool-side explicit npm package preparation and retired execution diagnostics.
No executable commands or business scheduling.

## Host retirement

Checker Host and Objective Host have been removed. `withPilot` now rejects with
`CliError` (`pilot-error`, exit code 2) before source acquisition, reports or callback
execution. The old probe/scaffold/validate package and static artifact CLI are removed.
Remaining legacy `regulate` and `continue` wrappers explicitly reject execution,
including continuation of historical records.
No old source is translated, replayed or silently submitted to a new Engine.

Use the external [`@silvermoon-work/task-builder-cli` and
`@silvermoon-work/task-engine-cli`](https://github.com/silvermoon-work/task-engine)
to build tasks and submit exact Bundle references.
This is an explicit author/consumer workflow, not an automatic CLI migration.

## Retained static capabilities

The old `inspectObjectiveArtifact`, `objectiveArtifactLocation` and
`parseObjectiveArtifactLocation` APIs and their example are removed, not
reimplemented behind a new utility layer. This package no longer installs
`check-artifacts` or validates the legacy `objective.json` format.

`digestObjectivePackage`, `prepareObjectivePackage` and `restoreObjectivePackage`
remain explicit, bounded npm package utilities. Preparation uses npm resolution
and freezes exact content; lifecycle scripts require explicit authorization.
Restoration verifies already-frozen content and never resolves a floating source.
The default package cache is `stateRoot()/packages`; callers can explicitly select
an existing private cache with `cacheDirectory`. Retired Host discovery environment
variables are no longer used.

Objective declarations, Agent resources and CLI configuration remain separate
capabilities. See [package layering](../../docs/package-layering.md).
