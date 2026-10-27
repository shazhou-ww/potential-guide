# Potential Guide

Potential Guide is a pnpm TypeScript monorepo for composable objective packages
and the extensible `pguide` command line:

- `@potential-guide/effects` reuses Effect for cancellable computations, running
  handles, current-value observations, and dependency-scoped replacement.
- `@potential-guide/git-source` observes Git refs and provides immutable,
  commit-bound repository snapshots without depending on Objective concepts.
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
- `@potential-guide/objective-portfolio-supervisor` coordinates multiple regulators
  through an injected portfolio policy; this existing API remains separate from
  the request-driven Coordinator.
- `@potential-guide/cli-core` provides command protocol and CLI infrastructure
  without depending on Objective logic.
- `@potential-guide/objective-declarations` shares declaration selection/binding
  using protocol only; `@potential-guide/cli-runtime` assembles Git-backed Pilots.
- `@potential-guide/pguide-config` is the configuration extension whose executable is
  `pguide-config` and whose command name is `config`.
- `@potential-guide/pguide-agents` manages independent user/project `agents.yaml`
  resources through `pguide agents`; profiles no longer belong in the main config.
- `pguide` is a discovery/dispatch entrypoint that installs Pilot commands and
  configuration and Objective declaration management by default. Regulation and supervision
  remain optional.
  `@potential-guide/pguide-pilot` owns `probe`, `scaffold`, `validate`;
  `@potential-guide/pguide-regulate` owns `regulate`, `continue`;
  `@potential-guide/pguide-supervise` owns `supervise`; and
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

Run `pnpm check` for the complete repository verification.

## CLI

```sh
npm install --global pguide
pguide --help
pguide scaffold pilot ./my-pilot
pguide validate pilot ./my-pilot/objective.yaml
pguide probe --pilot ./my-pilot/objective.yaml --subject-file ./subject.json
```

Add `@potential-guide/pguide-regulate` for regulation, `@potential-guide/pguide-supervise`
for supervision. Pilot, config and objectives packages are production dependencies of `pguide`; their commands
work even when a package manager does not expose transitive binaries on PATH.
Each command package also provides
standalone `pguide-<command>` binaries; no `pguide` installation is required for
those entrypoints. Install selected RC versions explicitly when testing a candidate.
The formerly published `@potential-guide/config` is now
`@potential-guide/pguide-config`; remove the old package from explicit installations
to avoid competing `pguide-config` shims. See [migration](./docs/package-layering.md).

Commit the specification and its resources before probing so that the reported
version identifies the contents actually evaluated. Validation and scaffolding
do not require a committed version.

`pguide regulate` uses named ACP/AHP profiles from user/project `agents.yaml`.
Project same-name profiles replace whole user profiles. Main config retains
`agents.defaultAgent` in user/project `config.jsonc`; `--config` is retired.
See [package settings and manual migration](docs/package-settings.md).
Migrate old embedded
profiles explicitly with `pguide agents migrate --scope user|project`.
See the [Agent manager](./packages/pguide-agents/README.md).
Regulation state and protocol-visible transcript
are stored under the platform state directory; credentials are never persisted.

### Govern this repository

The root [Objective declarations](./objectives.yaml) expose `standardize` with
Unit input (no extra parameters). Each workspace owns its own `standardize`
declaration; the root discovers pnpm workspaces, observes those Objectives through
the dependency API, and enforces common policy and joint delivery requirements.
See the [ownership and migration guide](./packages/objective-monorepo-standard/README.md).

```sh
pguide objectives show standardize --scope directory
pguide probe --objective standardize --scope directory --format json
pguide regulate --objective standardize --scope directory --target terminal --agent copilot
```

Run these commands from the repository root. The Pilot is loaded from the
upstream Git directory; the subject is the current local checkout, including
uncommitted changes. Each invocation resolves the source and records its exact
commit/tree evidence without pinning the declaration. Regulation requires an
existing Agent profile (`copilot` above is an example) and appropriate permissions.
An already satisfied target does not require an Agent repair.
The upstream source must contain this migration before the default declaration
can be consumed; an uncommitted local Pilot is not an upstream snapshot. Before
publication, `scripts/verify-monorepo-pilot.mjs` verifies the generated resources
from its own committed local Git fixture. Package directories expose the same
command for independent observation. Dependency handoffs are advanced by the
Supervisor, never by nested regulation inside checks.

This entry checks the existing workspace-wide contract; it does not yet split
that contract into per-package Objectives. It checks structure and delivery
preparation without executing builds, publishing or deploying. Run `pnpm check`
separately for formatting, lint, types, tests and package validation.

### Set up a target device

For an already installed local device, prefer the standalone
[self-check Objective](./packages/objective-pguide-self-check/README.md). Its
`initial → installed → configured → verified` cumulative attainment checks verify installation,
ACP stdio configuration and one isolated, directly prompted marker repair with
independent exact-content verification. It does not nest regulation or require
an extra `allowSanity` input; existing tool permissions still apply. Each check
defaults to 20 seconds (24-second Pilot maximum within the default 30-second
probe deadline). Remote setup integration remains future work.

The [credential-free Docker harness](./scripts/self-check-docker/README.md)
builds an explicit source commit, installs packed packages in a clean Linux
consumer, and verifies positive and negative marker repairs with a local ACP
fixture—without credentials or real model calls.

The repository-owned [setup Objective](./packages/objective-pguide-setup/README.md) checks
installation, configuration and ACP readiness on target **B**, while an already-ready
control machine **A** runs setup regulation and guides its Agent to install/configure
B. An explicit SSH target uses a dependency-free Node helper on POSIX B: B does
not need pguide to begin checking. Omitting `target` (or `type:local`) preserves
local bootstrap. It is a Git-subdirectory Pilot, not a new CLI command:

```sh
pguide probe --pilot 'git+https://github.com/shazhou-ww/potential-guide.git#packages/objective-pguide-setup/objective.yaml' --revision <commit> --subject-file <absolute-subject.json> --format json
```

Start with its control-Agent bootstrap instructions if B lacks Node or `pguide`.
The native Node helper also runs directly from a checkout without snapshot
dependencies. Sanity requires explicit consent, can incur Agent costs, and never
uses a real project as its repair target. SSH requires existing host trust and
noninteractive authorization, never forwards A's credentials/HOME, and never falls
back to local checks. Target hostname/user evidence is separate from its SSH alias.
Existing environment-based credentials
are available only in the direct shell entrypoint, not silently forwarded into
sanitized local Pilot probes; the guide documents existing file-authentication options.
For real Agents needing longer startup, the direct helper accepts explicit
`timeoutMs:180000`; Pilot wrappers reject budgets beyond their 30-second outer
probe allowance. A successful direct check is not a cached Git Pilot terminal receipt.

### Maintain a development environment

The independent [development-machine health Pilot](./packages/objective-devbox-health/README.md)
checks a dedicated Linux account, basic system health, selected TypeScript/Python/C++/Rust
toolchains, task residue and sampled health trends. Checks do not install or repair;
an authorized Agent performs maintenance and re-observes. Docker targets are inspected
inside the named container, never by falling back to the host.

Run `pnpm health:verify --report <absolute-report.json>` for the local Docker
healthy/fault/recovery matrix after committing the Pilot and verification script.
It uses disposable, resource-bounded containers without host mounts, Docker socket
access or external runtime networking. Docker verification is the delivery scope;
it does not establish native Linux, WSL host or long-term health.

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
