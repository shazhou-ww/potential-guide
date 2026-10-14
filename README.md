# pnpm monorepo preset

A neutral TypeScript monorepo baseline built with pnpm workspaces and Turborepo.
It provides dependency topology, caching, shared quality tooling, and examples
without choosing a product shape such as CLI, web app, service, or publishable
package.

## Derive a repository

```sh
git-lineage derive \
  https://github.com/shazhou-ww/preset-pnpm-monorepo.git \
  my-workspace \
  --branch main
cd my-workspace
pnpm install
pnpm check
```

This preset derives from
[`preset-typescript-base`](https://github.com/shazhou-ww/preset-typescript-base).
Its `.git-lineage.yaml` records that immediate parent. Run `git-lineage update`
to merge future baseline changes. This preset documents its own capabilities
and does not enumerate descendants.

## Structure

```text
apps/
  example/       executable project example
packages/
  core/          reusable library example
pnpm-workspace.yaml
turbo.json
```

The example app depends on `@workspace/core` through `workspace:*`. Replace both
examples as soon as the real workspace shape is known; they exist to keep
dependency ordering, type resolution, tests, and builds continuously verified.

## Workspace conventions

- Executable and deployable projects belong in `apps/`.
- Reusable code belongs in `packages/`.
- Shared third-party versions belong in the pnpm catalog in
  `pnpm-workspace.yaml`.
- Internal dependencies use `workspace:*`.
- Each workspace owns its build, lint, test, and typecheck scripts.
- Root commands use Turborepo to respect dependency order and cache outputs.

Add a dependency from the repository root:

```sh
pnpm --filter @workspace/example-app add some-package
pnpm --filter @workspace/core add --save-dev some-dev-tool
```

Run a command for one workspace:

```sh
pnpm --filter @workspace/core test
```

## Commands

| Command          | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| `pnpm build`     | Build every workspace in dependency order      |
| `pnpm lint`      | Lint every workspace                           |
| `pnpm typecheck` | Type-check every workspace                     |
| `pnpm test`      | Test every workspace with coverage             |
| `pnpm check`     | Run formatting, lint, types, tests, and builds |
| `pnpm clean`     | Remove workspace outputs and Turborepo state   |

## Adding a workspace

Every direct child of `apps/` or `packages/` is discovered automatically. Give
it a unique package name and the standard scripts consumed by `turbo.json`. Keep
application packages private. A library may become publishable later, but this
preset does not impose a release strategy.

## License

MIT
