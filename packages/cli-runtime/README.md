# @potential-guide/cli-runtime

Tool-side static Objective artifact inspection and explicit npm package preparation.
No executable commands or business scheduling.

## Host retirement

Checker Host and Objective Host have been removed. `withPilot` now rejects with
`CliError` (`pilot-error`, exit code 2) before source acquisition, reports or callback
execution. CLI `probe`, `regulate` and `continue` are not yet migrated to Task Bundles;
they explicitly reject execution, including continuation of historical records.
No old source is translated, replayed or silently submitted to a new Engine.

Use [`task-sdk`](../task-sdk/README.md) to build Task Bundles and the
[Task Engine Server](../task-engine-server/README.md) to submit exact Bundle references.
This is an explicit author/consumer workflow, not an automatic CLI migration.

## Retained static capabilities

`inspectObjectiveArtifact(directory)` validates the local data-only `objective.json`,
declared file set and mappings and calculates its exact content digest.
`objectiveArtifactLocation(directory, digest)` and
`parseObjectiveArtifactLocation(location)` round-trip exact `artifact+file:` addresses.
Inspection does not download external Check or dependency references or execute Checks.
`pguide validate artifact` reports `validationScope: "local-artifact"` accordingly.

`digestObjectivePackage`, `prepareObjectivePackage` and `restoreObjectivePackage`
remain explicit, bounded npm package utilities. Preparation uses npm resolution
and freezes exact content; lifecycle scripts require explicit authorization.
Restoration verifies already-frozen content and never resolves a floating source.
The default package cache is `stateRoot()/packages`; callers can explicitly select
an existing private cache with `cacheDirectory`. Retired Host discovery environment
variables are no longer used.

Static Pilot validation, scaffolding, Objective declarations and CLI configuration
remain separate capabilities. See [package layering](../../docs/package-layering.md).
