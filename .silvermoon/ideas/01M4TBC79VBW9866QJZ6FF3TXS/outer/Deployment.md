# Deployment

## Steps

### D-S01: Synchronize the verified package suite

Synchronize the accepted implementation and its package artifacts to the configured primary branch without publishing them to a registry.

### D-S02: Verify isolated package consumption

Pack all three workspaces and install their artifacts in an isolated consumer project that imports each declared public entry point.

## Acceptance criteria

### D-AC01: Primary contains the accepted suite

The accepted implementation commit is reachable from refreshed primary, and the three package manifests and generated artifacts correspond to that commit.

### D-AC02: Packed packages work together

An isolated consumer installs the packed artifacts, resolves the declared dependency chain, imports each package, and runs a representative Guide-to-Regulator-to-Portfolio flow successfully.
