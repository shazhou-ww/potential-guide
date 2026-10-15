# Potential Guide

Potential Guide is a pnpm TypeScript monorepo for composable objective packages
and the extensible `pguide` command line:

- `@potential-guide/objective-guide` models one objective through ordered levels,
  independently eligible same-level checks with injected concurrency policy,
  observations, localized guidance, and typed instance creation.
- `@potential-guide/objective-regulator` runs a guarded probe, action, and re-probe loop
  for one Objective Guide instance.
- `@potential-guide/objective-portfolio-supervisor` coordinates multiple regulators
  through an injected portfolio policy.
- `@potential-guide/cli-core` provides command protocol and CLI infrastructure
  without depending on Objective logic.
- `@potential-guide/config` is an optional scoped extension whose executable is
  `pguide-config` and whose command name is `config`.
- `pguide` is the composition package invoked by `npx pguide`. It owns the
  official Objective command adapters and discovers other independent
  `pguide-<command>` executables.

Objective dependencies flow from Guide to Regulator to Portfolio Supervisor.
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
pguide scaffold guide ./my-guide
pguide validate guide ./my-guide/objective-guide.yaml
pguide probe --guide ./my-guide/objective-guide.yaml --subject-file ./subject.json
```

`pguide regulate` uses only named ACP Agent profiles from user, project, or
explicit YAML configuration. Regulation state and protocol-visible transcript
are stored under the platform state directory; credentials are never persisted.

## Publishing

Releases use package-specific tags and npm Trusted Publishing. Manually publish
minimal `0.0.0` placeholders, configure their Trusted Publishers, and let
GitHub Actions publish the first product versions with provenance. See the
[npm publishing guide](./docs/npm-publishing.md) for the one-time setup and
release procedure.
