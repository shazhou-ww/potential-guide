# Potential Guide

Potential Guide is a pnpm TypeScript monorepo for three composable objective packages:

- `@potential-guide/objective-guide` models one objective through ordered levels,
  independently eligible same-level checks with injected concurrency policy,
  observations, localized guidance, and typed instance creation.
- `@potential-guide/objective-regulator` runs a guarded probe, action, and re-probe loop
  for one Objective Guide instance.
- `@potential-guide/objective-portfolio-supervisor` coordinates multiple regulators
  through an injected portfolio policy.

Dependencies flow in that order and never back toward the core.

## Requirements

- Node.js 22.12 or newer
- Corepack with pnpm 11.22.0

## Development

```sh
corepack pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Run `pnpm check` for the complete repository verification.
