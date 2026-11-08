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

On Windows, file-symlink tests attempt real link creation. If Windows denies it
with `EPERM` or `EACCES`, only those cases are explicitly reported as skipped;
directory junction, hard-link and ordinary-file tests still run. Enable Windows
Developer Mode or use an account with symlink privileges to run the file-symlink
cases too. Other fixture errors remain failures.

Command-discovery fixtures use their own PATH rather than globally installed
`pguide-*` commands, without changing the developer's shell environment.

Add or update tests for every behavior change. Keep each package's public
exports in its `src/index.ts`, and treat changes to those exports as API
changes.

Follow the [npm publishing guide](./docs/npm-publishing.md) for releases. Never
store an npm publishing token in this repository or in GitHub Actions.
