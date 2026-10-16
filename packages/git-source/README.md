# @potential-guide/git-source

Domain-independent, immutable Git snapshots using the installed Git CLI and native
Effect scopes, schedules and SubscriptionRefs. No Objective, Pilot or domain
envelope types are imported. Nothing from the repository is executed.

```ts
import { Effect } from "@potential-guide/effects";
import { loadGitSnapshot, makeGitSourceSpec } from "@potential-guide/git-source";

const source = makeGitSourceSpec({
  repository: "https://example.test/team/repository.git",
  revision: { type: "ref", value: "refs/heads/main" },
  refresh: { type: "once" },
});

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const snapshot = yield* loadGitSnapshot({}, source);
  console.log(snapshot.repository, snapshot.commit);
  const text = yield* snapshot.readText("definitions/config.json");
  // Interpret text in a domain adapter, not in git-source.
  console.log(text);
})));
```

## Contracts

- `GitSourceSpec` contains only `repository`, `revision`, and `refresh`.
  Repository is an absolute local path or a credential-free HTTPS, SSH or file
  URL. SCP-style repository strings are intentionally not accepted. SSH usernames
  are allowed; URL passwords, HTTPS usernames, query strings and fragments are
  not. `commit` requires a full 40- or 64-character hash; `ref` accepts a Git ref
  name (including `HEAD`), not an arbitrary revision expression.
- `makeGitSourceSpec` validates and freezes a copy; malformed input throws a
  structured `GitSourceError`. `validateGitSourceSpec(unknown)` returns diagnostics
  without I/O.
- `loadGitSnapshot(environment, spec)` is
  `Effect<GitSnapshot, GitSourceError, Scope>`. Each acquisition owns an isolated
  bare cache; no shared checkout is read. It resolves the fetched revision to a
  commit and pins that commit. Paths are read from that immutable object's tree,
  so later ref moves, dirty worktrees and subsequent loads cannot change a
  snapshot's version/content pairing. Each snapshot caches successful immutable
  tree listings by object ID, avoiding repeated `ls-tree` processes when reading
  files in shared directories. Errors and file contents are not cached; cache
  hits still check that the owning Scope remains open.
- A snapshot exposes `repository`, `commit`, `readFile(path)` (bytes),
  `readText(path)` (strict UTF-8), and `readDirectory(path?)` (name/kind entries).
  All reads are Effects with structured errors. Logical repository paths use `/`.
  Empty string or `.` lists the root. Absolute paths, traversal, control
  characters, backslashes and colon syntax are rejected. Symlinks and submodules
  can be listed but are not followed or read as regular files.
- Snapshots are live only inside their acquisition Scope. Closing the Scope
  removes the cache; later reads fail explicitly with `closed`. Consumers needing
  old snapshots must keep their owning Scope open. No cache is written to the
  source repository.

## Watching and cancellation

`watchGitSnapshot(environment, spec)` returns
`Effect<SubscriptionRef<GitSourceState>, never, Scope>`. Its current value starts
as `initial`; native `SubscriptionRef.get` reads current state and
`SubscriptionRef.changes` observes it, including initial/current state. The Scope
owns the worker, in-flight commands and cache. A successful sample is
`{ state: "ready", snapshot }`; a source failure is
`{ state: "failed", error }`, never an empty successful snapshot. Clone/validation
failures are terminal samples. A failed poll is published explicitly and later
polls may recover. `{ type: "once" }` performs one load; `{ type: "poll",
intervalMs: positiveInteger }` uses native Effect scheduling. Sequential polls do
not overlap. Previously emitted snapshots stay readable until the watch Scope
closes.

Wrap the consumer in `Effect.scoped`, then run through `startEffect` to bridge a
parent AbortSignal. `cancel()` requests cancellation; `exit()` waits for command
termination and cache release. Interruption stays runtime interruption, not a
source failure or business outcome.

## Local capabilities and safety

`GitSourceEnvironment` optionally supplies `cacheDirectory`, an
`environment` map for Git credential helpers/configuration, and `runGit` for an
injected local command capability. Credentials must stay in this environment or
the user's Git/SSH helpers, never in a serializable source spec. The default
`runGitCommand` spawns Git with argument arrays, no shell, no interactive prompts,
and no stderr/command-line leakage into errors. Command failures retain their
operation and exit code in both structured fields and the safe error message.
Git must be installed. On Windows each invocation enables `core.longpaths` so
nested consumer caches and commit-pin refs can exceed MAX_PATH without changing
user or global Git configuration. Commands
are terminated and awaited on interruption. Output is limited to 64 MiB per
command; oversized blobs fail explicitly. Injected command capabilities must
honor interruption and await their own cleanup.

Cache directories are unique children of the injected `cacheDirectory`, or
`cwd/.cache` by default. Relative injected paths resolve against the current
working directory. The cache parent is created if needed; Scope cleanup removes
only the owned child, not the shared cache parent. Tests also keep all temporary
repositories and snapshot caches under `cwd/.cache`, never the OS temporary
directory.

Bare caches avoid checkout traversal and OS symlink privilege requirements.
Network/SSH credential helpers remain the local environment's responsibility.
Cleanup failures are Effect defects rather than hidden success. This adapter
does not promise that cancelling a local Git process cancels remote work.

## Validation

Tests create real temporary local repositories and require no network:

```text
pnpm --filter @potential-guide/git-source test
pnpm --filter @potential-guide/git-source typecheck
```
