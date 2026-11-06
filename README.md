# Potential Guide

Potential Guide is a pnpm TypeScript monorepo for composable objective packages
and the extensible `pguide` command line:

- `@potential-guide/effects` reuses Effect for cancellable computations, running
  handles, current-value observations, and dependency-scoped replacement.
- `@potential-guide/git-source` observes Git refs and provides immutable,
  commit-bound repository snapshots without depending on Objective concepts.
- The [generic Task engine](./docs/task-engine.md) accepts declarative input
  Schemas, derives validation/structural equality, and exposes authorized current
  type discovery with optional submission revision guards. Check/Probe use type
  version 2; historical contracts are never silently reinterpreted.
- [`@potential-guide/check-artifacts`](./packages/check-artifacts/README.md) explicitly
  builds/packs standalone Checks and prepares digest-pinned local/HTTPS artifacts
  for Check Host, without consumer-side Check installation or builds.
- `@potential-guide/pilot-protocol` independently provides Pilot definitions,
  schema compilation, strict parsing, reference validation and subject projection.
- `@potential-guide/objective-pilot` consumes those definitions,
  evaluates ordered levels through uniform probes, and provides localized Wiki
  guidance. A Pilot observes; it never invokes an Agent.
- `@potential-guide/objective-regulator` combines a serializable regulation recipe
  with a separate subject and runs the observe, Agent, and re-observe process.
- `@potential-guide/regulation-coordinator` durably schedules immutable timed
  requests and recurring successors, with resource-aware execution, recovery and
  replayable exhaustion facts; it does not require a Planner Agent.
- `@potential-guide/cli-core` provides command protocol and CLI infrastructure
  without depending on Objective logic.
- `@potential-guide/objective-declarations` shares declaration selection/binding
  using protocol only; `@potential-guide/cli-runtime` retains explicit npm package
  preparation and legacy execution rejection, without static artifact CLI validation.
- `@potential-guide/pguide-config` is the configuration extension whose executable is
  `pguide-config` and whose command name is `config`.
- `@potential-guide/pguide-agents` manages independent user/project `agents.yaml`
  resources through `pguide agents`; profiles no longer belong in the main config.
- `pguide` is a discovery/dispatch entrypoint that installs configuration,
  Agent resources and Objective declaration management by default. The old
  `pguide-pilot` command package is retired. Regulation remains optional.
  `@potential-guide/pguide-regulate` owns `regulate`, `continue`;
  `@potential-guide/pguide-objectives` owns `objectives`.

There are exactly three layers: **tools → business logic → protocol**.
Tools may also use protocol directly; same-layer dependencies are allowed.
`effects` remains the protocol's lifecycle primitives. Git source and the four
concrete Objective packages are explicitly deferred externalization, not a fourth
layer. See [package layering and command migration](./docs/package-layering.md).
`pnpm layers:check` enforces the manifest and production-import boundaries.

## Requirements

- Node.js 22.13 or newer
- Corepack with pnpm 11.22.0

## Lineage

This repository inherits its workspace baseline from
[`shazhou-ww/preset-pnpm-monorepo`](https://github.com/shazhou-ww/preset-pnpm-monorepo).
The immediate parent and branch are recorded in `.git-lineage.yaml`. Run
`git-lineage update` from a clean worktree to merge future preset updates.

## Development

Workspaces are discovered only under `packages/*`; this repository does not use
an `apps/` workspace directory.

```sh
corepack pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Run `pnpm check` for the default repository verification: source drift, build/layer
boundaries, formatting, lint, production and test types, tests, and packed artifact
structure. Checked-in settings and embedded task Workers are snapshot-guarded
across the build: regeneration drift fails validation and restores the original
sources, even on a failed build. This allows cold builds to supply the dependencies
needed by Worker validation without silently repairing drift. Objective staging resources are Turbo build outputs;
`pnpm test` builds or restores them instead of rebuilding every Worker unconditionally.

Run `pnpm consumers:check` for the full isolated package-consumer suite (including
production dependency isolation, authoring, SDK, task bundles and services), and
`pnpm deployment:verify` for the same full consumer suite plus npm installation,
CLI discovery and runtime deployment checks. Full delivery validation is
`pnpm check && pnpm deployment:verify`; it does not publish packages. CI runs
default checks on Node 22/24 and the full consumer/deployment suite on Linux,
macOS and Windows. This retains platform-specific artifact and Worker assertions
while removing two redundant consumer runs from the Node matrix.
The publishing workflow explicitly retains `pnpm consumers:check` after default
checks; this validation split does not change release permissions or publish packages.
Direct `node scripts/check-packages.mjs` retains full consumer validation;
`--structure` selects artifact structure only and cannot be combined with consumer
scope flags.

The manually dispatched **Check performance** workflow measures cold build/Turbo
outputs and then warm caches for an exact revision, preserving stage timings and
exit codes. Cold excludes dependency installation; each measurement job starts
with a fresh checkout. `node scripts/verify-worker-cache.mjs` checks byte-for-byte
restoration of `.staging` after a successful build.
Supply the workflow's optional `baseline` revision to run control cold/warm checks
before candidate cold/warm checks on the **same runner**. This avoids confounding
results with the rolling image versions behind `ubuntu-latest`.
The test command runs at most two workspace suites at once because each suite
can also start parallel test files, child processes and Workers.
Generated `.test-*` fixture directories are ignored by Git and Biome; keep
new runtime fixtures under `.cache/` so repository scans do not race their
cleanup, and hand-written test sources under `test/`.
Production-only Bundle consumer checks use an owned temporary directory outside
the repository so missing author dependencies cannot resolve from ancestor workspaces.

## CLI

`pguide` installs the `config`, `agents` and `objectives` command extensions;
`diagnose` and `complete` are built in. Old top-level `probe`, `check`,
`validate` and `scaffold` commands and `pguide-pilot` are retired.
No replacement command packages are created in advance.

New checks use [Check SDK](./packages/check-sdk/README.md) and ordinary
[Task Bundles](./packages/pguide-task-bundle/README.md).
[Environment checks](./packages/check-environment/README.md) demonstrate the
standard authoring, Reference and result contracts.

```sh
pguide config path
pguide agents list
pguide objectives list
pguide diagnose
pguide task-bundle init my-task
pguide task-bundle check author my-task/task.build.yaml
pguide task-bundle build my-task/task.build.yaml
```

`task-bundle` and `task-engine` are optional extensions, not bundled default
commands. Install their packages explicitly; upload/import/pin generated CARs
with a caller-authorized external tool, then submit their exact CIDs to Engine.
The new `task-bundle check`, `config validate` and `agents validate` operations
remain supported. See [CLI guide](./packages/pguide/README.md) and
[service configuration](./docs/task-server.md).

Repository Objective declarations and their shared business implementations
remain available, but are not executed through the removed Pilot command.
Use `pnpm check` for current repository validation and
`pguide objectives show standardize --scope directory` to inspect declarations.
The old `verify-monorepo-pilot.mjs` CLI verifier is retired.
Setup, self-check and health retain their independently documented helper
boundaries; no automatic Task Bundle or persisted-state migration is claimed.

## Publishing

Releases use package-specific tags and npm Trusted Publishing. Manually publish
minimal `0.0.0` placeholders, configure their Trusted Publishers, and let
GitHub Actions publish the first product versions with provenance. See the
[npm publishing guide](./docs/npm-publishing.md) for the one-time setup and
release procedure.

The functional migration is intentionally breaking and does not retain the old
Objective Guide API or input aliases. Product candidates remain on `0.x` and
publish to npm's `rc` tag; breaking changes advance the minor version rather
than introducing `1.0`.

See the [functional migration guide](./docs/functional-migration.md) for
consumer imports, specification/subject separation, the probe envelope,
Agent input, CLI/config changes, and running-effect cancellation.

The [requirements-led pnpm monorepo Objective](./packages/objective-monorepo-standard/README.md)
checks structure before dependency, build and delivery preparation. It works on
independent target repositories, reports unsupported or missing proof explicitly,
and never installs, publishes, deploys or runs migrations.

The repository-owned Pilots are delivered by four complete private workspace
packages; the monorepo package contains separate repository and package Pilots.
See [Pilot package architecture and URI migration](./docs/pilot-packages.md) for
their ownership, standalone resources, generation checks and consumption boundaries.
