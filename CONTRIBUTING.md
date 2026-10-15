# Contributing

Install the pinned pnpm release through Corepack or pnpm itself, then install
dependencies:

```sh
corepack enable
pnpm install
```

Before opening a pull request, run:

```sh
pnpm check
```

Add or update tests for every behavior change. Keep each package's public
exports in its `src/index.ts`, and treat changes to those exports as API
changes.
