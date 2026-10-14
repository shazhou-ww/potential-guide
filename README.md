# TypeScript base preset

The root preset for strict TypeScript projects managed with pnpm. It contains
the development baseline shared by more specialized presets without assuming an
npm package, monorepo, application framework, or hosting platform.

## Included

- pnpm with a committed lockfile
- strict TypeScript and generated declaration files
- ESLint and Prettier
- Vitest with V8 coverage thresholds
- CI on the oldest supported and current Node.js releases
- Dependabot updates for npm and GitHub Actions

## Derive a repository

Derive a repository while retaining Git ancestry:

```sh
git-lineage derive \
  https://github.com/shazhou-ww/preset-typescript-base.git \
  my-project \
  --branch main
cd my-project
```

You can also use GitHub's **Use this template** button if you do not need to
retain lineage.

This is the root of the preset tree, so it intentionally has no
`.git-lineage.yaml`. The `git-lineage derive` command creates that file in the
derived repository.

## Preset inheritance

Each derived preset has one immediate parent and receives parent changes through
ordinary Git merges:

```sh
git-lineage update
```

Each preset documents its own capabilities and does not enumerate its
descendants.

The root package is private because it supplies development tooling rather than
an npm artifact.

## Requirements

- Node.js 22.13 or newer
- pnpm 11.22 or newer

## Development

```sh
pnpm install
pnpm check
```

Useful individual commands:

| Command              | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `pnpm build`         | Compile ESM JavaScript, declarations, and source maps |
| `pnpm typecheck`     | Type-check without emitting files                     |
| `pnpm lint`          | Run ESLint                                            |
| `pnpm format`        | Format supported files with Prettier                  |
| `pnpm test`          | Run the test suite once                               |
| `pnpm test:watch`    | Run tests in watch mode                               |
| `pnpm test:coverage` | Run tests and enforce coverage thresholds             |

The example entry point is `src/index.ts`. Tests belong in `test/`, and build
artifacts are written to `dist/`. A derived preset may replace this layout when
its specialization requires a different project structure.

## License

MIT
