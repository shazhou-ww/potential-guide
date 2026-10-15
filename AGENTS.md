# Project Guidelines

## Development

- This repository uses pnpm workspaces and Turborepo. Keep executable apps
  under `apps/` and reusable packages under `packages/`.
- Use Node.js 22.13 or newer and pnpm 11.22 or newer.
- Install dependencies with `pnpm install`.
- Run `pnpm check` before submitting changes.
- Keep shared third-party versions in the pnpm catalog and internal workspace
  dependencies on the appropriate `workspace:` range.
- Keep each workspace's build, lint, test, and typecheck scripts aligned with
  `turbo.json`.
- Use Biome for formatting and linting, and Node's test runner through `tsx`
  for tests.

## Skills

- Manage project skills with `npx skills`.
- Keep all project skills under `.agent/skills/<skill-name>/`, with each skill's
  `SKILL.md` in its directory.
