# Potential Guide

Potential Guide is a pnpm TypeScript monorepo for composable objective packages
and the extensible `pguide` command line:

- `@potential-guide/effects` reuses Effect for cancellable computations, running
  handles, current-value observations, and dependency-scoped replacement.
- `@potential-guide/git-source` observes Git refs and provides immutable,
  commit-bound repository snapshots without depending on Objective concepts.
- `@potential-guide/objective-pilot` loads serializable objective specifications,
  evaluates ordered levels through uniform probes, and provides localized Wiki
  guidance. A Pilot observes; it never invokes an Agent.
- `@potential-guide/objective-regulator` combines a serializable regulation recipe
  with a separate subject and runs the observe, Agent, and re-observe process.
- `@potential-guide/objective-portfolio-supervisor` coordinates multiple regulators
  through an injected portfolio policy.
- `@potential-guide/cli-core` provides command protocol and CLI infrastructure
  without depending on Objective logic.
- `@potential-guide/config` is an optional scoped extension whose executable is
  `pguide-config` and whose command name is `config`.
- `pguide` is the composition package invoked by `npx pguide`. It owns the
  official Objective command adapters and discovers other independent
  `pguide-<command>` executables.

Objective dependencies flow from Pilot to Regulator to Portfolio Supervisor.
Git source observation is independent of that domain graph; the composition
layer connects commit-bound resources to Pilot specification loading.
CLI dependencies flow from CLI Core into extensions and the `pguide`
composition layer; Objective logic never depends on CLI Core.

## Requirements

- Node.js 22.13 or newer
- Corepack with pnpm 11.22.0

## Lineage

This repository inherits its workspace baseline from
[`shazhou-ww/preset-pnpm-monorepo`](https://github.com/shazhou-ww/preset-pnpm-monorepo).
The immediate parent and branch are recorded in `.git-lineage.yaml`. Run
`git-lineage update` from a clean worktree to merge future preset updates.

## Development

```sh
corepack pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Run `pnpm check` for the complete repository verification.

## CLI

```sh
npx pguide --help
pguide scaffold pilot ./my-pilot
pguide validate pilot ./my-pilot/pilot.yaml
pguide probe --pilot ./my-pilot/pilot.yaml --subject-file ./subject.json
```

Commit the specification and its resources before probing so that the reported
version identifies the contents actually evaluated. Validation and scaffolding
do not require a committed version.

`pguide regulate` uses only named ACP Agent profiles from user, project, or
explicit YAML configuration. Regulation state and protocol-visible transcript
are stored under the platform state directory; credentials are never persisted.

### Set up this device

The repository-owned [setup Objective](./objectives/pguide-setup/README.md) checks
the current user's installation, configuration and ACP readiness, then optionally
runs one real, isolated detect-repair-recheck. It is a Git-subdirectory Pilot,
not a new CLI command:

```sh
pguide probe --pilot 'git+https://github.com/shazhou-ww/potential-guide.git#objectives/pguide-setup/pilot.yaml' --revision <commit> --subject-file <absolute-subject.json> --format json
```

Start with its external-Agent bootstrap instructions if `pguide` is not installed.
The native Node helper also runs directly from a checkout without snapshot
dependencies. Sanity requires explicit consent, can incur Agent costs, and never
uses a real project as its repair target. Existing environment-based credentials
are available only in the direct shell entrypoint, not silently forwarded into
sanitized Pilot probes; the guide documents existing file-authentication options.

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
