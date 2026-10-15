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
- `pguide` discovers and safely dispatches independent `pguide-<command>`
  executables. Official commands cover probing, regulation and continuation,
  portfolio supervision, scaffolding, validation, diagnostics, completion, and
  optional configuration management.

Dependencies flow in that order and never back toward the core.

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
