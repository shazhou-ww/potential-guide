# Task Bundle authoring

`@potential-guide/pguide-task-bundle` installs `pguide-task-bundle`, advertising
`task-bundle` through the existing `pguide-command-v1` discovery protocol. Put its
binary on PATH (or in `pguide.commandDirectories`); no Engine/server is installed
or started. Node >=22.13 and TypeBox **@sinclair/typebox 0.34.52** are supported.

```text
pguide task-bundle init [directory]
pguide task-bundle check author task.build.yaml
pguide task-bundle build task.build.yaml
pguide task-bundle check artifact dist
pguide task-bundle publish dist --ipfs-rpc http://127.0.0.1:5001
```

The independent executable takes the same arguments. All commands support the
shared `--cwd`, `--format json`, `--help` and `--version` options.
There is **no include command**. `check` requires an explicit `author` or
`artifact` mode; it never writes output or publishes.

With `--format json`, successful operations return
`{schemaVersion: 1, command: "task-bundle <operation>", status: "ok", result}`.
Check results contain `declaration`, `resolved`, `cid` and exact `files`;
build returns `directory`, `cid` and `declaration`; publish returns only `cid`.
Help and discovery use the existing CLI metadata contracts. Errors and exit
statuses use the shared pguide CLI handling, not a second diagnostics protocol.

## Start a minimal task

```text
pguide task-bundle init my-task
cd my-task
pnpm install
pnpm run build
pnpm run clean
```

`init` defaults to the current directory and honors `--cwd`. It creates
`.gitignore`, `task.build.yaml`, `src/contract.ts` and `src/main.ts`: a typed Echo callback with
object input/result and no messages or resources. The entry explicitly imports
`runTask` from the public Task SDK and calls it; the CLI need not be installed locally.
The generated `.gitignore` excludes `node_modules/` and `dist/`. An existing
regular `.gitignore` is preserved byte for byte; add these rules yourself if
needed. Directory or linked `.gitignore` paths are rejected.

Starting at the target directory, `init` searches upward for the nearest
`package.json`. If found, it reuses that package and adds
`@sinclair/typebox: "0.34.52"` and `@potential-guide/task-sdk: "0.1.0-rc.0"` to
`dependencies` only when each dependency is not already
declared in dependencies, devDependencies, optionalDependencies or
peerDependencies. Existing version specifications and other package fields are
preserved; it does not change module type or package manager.
If no ancestor package exists, it creates a private ESM `package.json` in the
target directory with those dependencies.

Only when the task directory has its own `package.json` (new or existing),
`init` fills in missing `scripts.build` and `scripts.clean`.
Build runs `pguide task-bundle build task.build.yaml`; clean uses a
cross-platform Node command that removes only this task's `dist` directory.
Cleaning missing output succeeds; sources and dependencies are retained.
Other scripts and existing `build`/`clean` are preserved.
When reusing an ancestor package, `init` only declares the dependency:
it never adds or changes that package's scripts.
The CLI must be available on PATH (for example through the global link).

Initialization is offline: it declares dependencies but never runs an install,
updates a lockfile or starts an Engine. Run your package manager's install command
in the returned **packageDirectory**, which can be above the task directory;
then run the generated build script from that package directory. When reusing
an ancestor package or if `build` already existed, invoke
`pguide task-bundle build task.build.yaml` from the task
directory instead. The example uses pnpm; existing npm/yarn/bun
projects keep using their own package manager. Existing TypeBox versions must
remain compatible with the supported version above.

Existing template files, directory links and malformed manifests fail without
overwriting user files. Use a separate target directory if an existing package
already has `src/main.ts` or `task.build.yaml`. JSON init results include
`directory`, `buildFile`, `packageDirectory`, `packageFile`, `packageCreated`,
`dependencyAdded`, `buildScriptAdded`, `cleanScriptAdded`, written `files` and `nextSteps`.

## Author input

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task-build/v1.json
name: Echo
runtime:
  minVersion: "22.13.0"
source:
  entry: src/main.ts
  contract: src/contract.ts
  mode: explicit
include:
  - from: assets/**/*.json
    to: resources/
outDirectory: dist
```

Paths are relative to the build file, use portable `/` separators, and cannot
escape its directory or traverse links. There is no second author-maintained
`task.yaml`. `include`, `source.mode` and `source.exportName` are optional; unknown fields fail.
New templates use `mode: explicit`: the author entry starts the Worker itself.
Absent `mode` (or `mode: callback`) preserves the old lazy callback-export path,
including `exportName` (default `default`). Do not combine `exportName` with
explicit mode. Existing callback tasks need no migration.
The [machine schema](../../schemas/artifacts/task-build/v1.json) describes the
exact fields; filesystem and Schema semantics receive additional validation.

`src/contract.ts`:

```ts
import { Type } from "@sinclair/typebox";
export default {
  input: Type.Object({ text: Type.String() }),
  result: Type.Object({ text: Type.String() }),
  message: Type.Never(),
};
```

`src/main.ts`:

```ts
import type contract from "./contract.js";
import type { BundleCallback } from "@potential-guide/pguide-task-bundle";
import { runTask } from "@potential-guide/task-sdk";
const callback: BundleCallback<typeof contract> = async (input) => ({ text: input.text });
runTask(callback);
```

Install TypeBox and the Task SDK in the author's project. `Static<typeof contract.input>` can
also be imported from TypeBox directly. Type-only imports do not bundle the
author library into the Worker. Run the author's TypeScript typecheck: build
transpiles code but does not replace TypeScript typechecking.

Supported kinds: Object, String, Number, Integer, Boolean, Null, Literal, Array,
Tuple, Union, Intersect, Record, Ref and Never, subject to strict Engine
Draft 2020-12 validation. Tuple's Draft-7 `items` array becomes `prefixItems`
with `items: false`; Never retains its equivalent `{not:{}}` representation.
Tuple `additionalItems` overrides other than `false` are rejected, not discarded.
Optional/readonly metadata has no second runtime validator. Transform, Unsafe,
Date, function, non-JSON and unknown metadata/kinds fail. `format` and content
annotations are rejected rather than silently treated as enforced constraints.
The input must resolve to an object root; legal extra fields remain visible
to the Worker **and input equality**, never stripped.

An optional `schemas: [sharedTypeBoxSchema, ...]` in the default export supplies
the complete offline reference closure. Every shared resource needs an absolute
`$id`; conflicting IDs, unresolved fragments and cyclic references fail. The
three generated root schemas receive stable IDs unless the author supplies them
and are stored under `schemas/`. The generated YAML references their actual
Bundle-relative paths: `schemas/0.json`, `schemas/1.json` and `schemas/2.json`.
Artifact checking, publishing and Engine loading resolve those files offline;
their `$id` values still resolve shared references within the Schema documents.

Author check/build **evaluate the trusted contract module** in the local process.
They are not sandboxes; do not check untrusted source. They bundle but do not
execute the business callback. Artifact check/publish never evaluate source or
load the author's contract, TypeBox modules or dependencies.

All build paths precompile input, result and message validators using Ajv
standalone. The Worker retains automatic validation, projection and payload
budgets, but contains no general Ajv compiler (small required `ajv/runtime`
helpers are bundled). Type-only contract imports do not load validators.
Authors may explicitly import their own runtime validator, including Ajv; that
is a business dependency, not SDK overhead. Explicit entries can call a local
wrapper delegating to `runTask` without changing build configuration: the
builder binds immutable declaration/validator data, never selects wrappers or
calls `runTask` again. It does not implement `runCheck` or `runProbe`.

## Selection, output and identity

- Patterns support `*` and `?` inside a segment and whole-segment `**` (zero or
  more directories). Braces, character classes, negation and backslashes fail.
- Each rule traverses its static directory prefix; paths below that prefix are
  preserved under `to`, which must be a `resources/` directory ending in `/`.
  A literal filename uses its parent as the prefix.
- Hidden entries and `node_modules` are excluded. Empty matches, duplicate source
  selection, destination collisions, ambiguous casing, links and special files
  fail. Selection cannot traverse the output directory.
- A complete candidate is compiled and validated before replacing output.
  Staging/backup siblings and an exclusive lock protect replacement; a failed
  compile retains the previous artifact. Output is replaced, not merged,
  so deleted resources disappear. An existing output must be a complete valid
  Task Bundle with no unexpected files; arbitrary directories are never overwritten.
- Successful builds leave only the artifact directory, without a persistent
  `dist.pguide-task-bundle.json` sidecar. A matching ownership marker from an older
  build is removed after success; a conflicting marker fails without deleting it.
- Replacement is an operation-level rollback, not a crash-durable filesystem
  transaction or a guarantee of gap-free directory visibility. A process crash
  can leave a lock and staging/backup siblings. Builds fail closed on that lock:
  stop the owning process and validate the output or backup
  with `check artifact`, then recover only those owned paths. Do not remove a lock
  automatically or delete a backup before confirming a valid retained artifact.
- `task.yaml` uses YAML block formatting and contains a required, exact `include` list including itself,
  `worker.cjs`, schemas and selected resources. No globs, absent files or extra
  files are accepted. Old no-manifest bundles fail with rebuild/new-CID guidance.
- Fixed UnixFS import settings and deterministic Worker output produce the root
  CID offline. No self-referential CID field, archive, network publishing or pin
  operation occurs during build.

Publish reads one validated byte snapshot, imports precisely that set, verifies
block/root CIDs and pins that root. The node must already exist and belongs to
the publisher; success does not imply public reachability or durable replicas.
`--ipfs-rpc` overrides `task-bundle.ipfsRpc` from pguide's normal
user → nearest project `config.jsonc`. No default endpoint is assumed. The package
provides static `settings.json`; register it with `pguide config packages register`
when the normal installation discovery does not find it. Never store credentials
in the RPC URL. Publish does not rebuild, edit the artifact, create a Task or
start/stop Kubo. Execution is a separate Engine consumer's responsibility.

## Repository verification (no npm publish)

After `pnpm build`, run `pnpm --filter @potential-guide/pguide-task-bundle test`
for author/Schema/real Worker and isolated HTTP RPC tests. To pack the runtime
dependency closure, install into an independent consumer and verify both discovery
and the standalone binary:

```text
node scripts/check-packages.mjs --bundle-authoring
```

`node scripts/check-packages.mjs --task-bundles` separately tests packed
SDK/Engine consumption by CID on a business-free host. Both commands own and
clean their `.cache` fixtures; `PGUIDE_KEEP_PACK_CONSUMERS=1` retains them for
inspection. They do not use an existing Kubo or publish any package to npm.
