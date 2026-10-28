# @potential-guide/cli-runtime

Tool-side source acquisition and runtime assembly (`withPilot`). No executable
commands; declaration selection/binding is the separate protocol-only
`objective-declarations` tool service, and mutation belongs to `pguide-objectives`.
This source service never depends on command packages or regulation.
Callers inject any business-error propagation predicate.
Business packages consume injected capabilities, never this tool implementation.

## Declarative Objective artifacts

`inspectObjectiveArtifact(directory)` verifies a data-only `objective.json` plus
References and returns its exact digest. `objectiveArtifactLocation(directory,
digest)` creates an `artifact+file:` address suitable for declarations or CLI
selection. `withPilot(address, cwd, undefined, use, options)` prepares its fixed
Check/dependency closure; alternatively pass a directory and an exact Objective
digest as the third argument. No package.json, npm resolution, build, JavaScript
Objective entrypoint or registry selection is involved.

`withObjectiveArtifact(directory, digest, use, options)` exposes the same scoped
assembly directly as a low-level capability; use `withPilot` for standard report
lifecycle and the overall preparation deadline.
Host sees only prepared Check execution directories/revisions.
Sources in resulting PilotSpecs contain distinct `artifactDigest`, per-reference
Check logical digests/Host revisions and flat exact dependency bindings.
Recovery uses `withPilot(stableObjectiveId, cwd, undefined, use, { sources })`;
it verifies cached bytes and frozen closure, never resolves a new version.
See [manifest, References and compatibility](../../docs/objective-artifacts.md)
and the [runnable composition example](examples/objective-artifact/build.mjs).

## Legacy package sources

`prepareObjectivePackage` uses npm-package-arg, pacote and Arborist for standard
npm dependency specs. It freezes a single-Objective package tree and returns its
actual package name, versioned content digest, and separate source provenance.
Local-directory preparation uses npm's own packlist and authorized prepare hook,
then copies selected files into a private regular-file staging tree before packing.
This avoids node-tar's cross-directory hardlink packing deadlock without modifying
the caller's directory or weakening delivered-artifact link checks.
`restoreObjectivePackage` only verifies an already-frozen capsule; it never
re-resolves a floating spec. Scripts are not authorized by default.
`withPilot` loads the root objective.yaml and prepares single-link check capsules.
Source-only packages must be explicitly installed/built before consumption.
Legacy Git bindings retain their original commit/tree meaning, not package digests.
See the [npm Objective contract](../../docs/pilot-packages.md).

See [package layering](../../docs/package-layering.md) and the
[command reference](../pguide/README.md).
