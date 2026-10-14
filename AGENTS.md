# Project Guidelines

## Scope

This repository is the root TypeScript base preset. It provides shared
development tooling, not an application framework or a publishable npm package.
Keep its guidance and documentation specific to this baseline; do not list
derived presets.

## Development

- Use Node.js 22.13 or newer and pnpm 11.22 or newer.
- Install dependencies with `pnpm install`.
- Run `pnpm check` before submitting changes. It runs formatting, linting,
  type-checking, coverage tests, and the build.
- Keep public TypeScript exports in `src/index.ts` and tests in `test/`.

## Skills

- Manage project skills with `npx skills`.
- Keep all project skills under `.agent/skills/<skill-name>/`, with each skill's
  `SKILL.md` in its directory.
- Keep skills appropriate to this root TypeScript baseline; specialized presets
  should provide their own agent guidance and skills.
