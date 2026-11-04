# Task Bundle authoring

`@potential-guide/pguide-task-bundle` installs `pguide-task-bundle`, advertising
`task-bundle` through the existing `pguide-command-v1` discovery protocol. Put its
binary on PATH (or in `pguide.commandDirectories`); no Engine/server is installed
or started. Node >=22.13 and TypeBox **@sinclair/typebox 0.34.52** are supported.

```text
pguide task-bundle init [directory]
pguide task-bundle check author task.build.yaml
pguide task-bundle build task.build.yaml
pguide task-bundle check artifact dist.car
pguide task-bundle publish dist.car --ipfs-rpc http://127.0.0.1:5001
```

The independent executable takes the same arguments. All commands support the
shared `--cwd`, `--format json`, `--help` and `--version` options.
There is **no include command**. `check` requires an explicit `author` or
`artifact` mode; it never writes output or publishes.

With `--format json`, successful operations return
`{schemaVersion: 1, command: "task-bundle <operation>", status: "ok", result}`.
Check results contain `declaration`, `resolved`, `cid` and exact `files`;
build returns `directory`, `car`, `cid` and `declaration`; publish returns only `cid`.
The final distribution artifact is `<outDirectory>.car`; the directory remains
available for local Worker execution and backwards-compatible directory inputs.
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
The generated `.gitignore` excludes `node_modules/`, `dist/` and `dist.car`. An existing
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
cross-platform Node command that removes only this task's `dist` directory and `dist.car`.
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

The SDK supplies Worker runtime/types only. All author tooling, including the
low-level compiler used by repository fixtures, lives in this package. The
runtime dependency closure does not include Check artifact or Check host packages.

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

### Low-level tooling API

Repository tools that already supply a declaration and callback can use
`buildTaskBundle`/`compileTaskBundle` from `@potential-guide/pguide-task-bundle/build`,
`checkTaskArtifact` from `/artifact`, and `createIpfsClient`/`importTaskBundle`
from `/publish`. These are author tools, never Worker runtime entrypoints.
Prefer the build-file CLI workflow for new tasks; see `examples/echo`.
The migrated `examples/low-level/echo` and `examples/low-level/check-diagnostics`
fixtures demonstrate the declaration-based API.

The compiler's `declaration` accepts a JSON-compatible definition or a
declaration-source filename. It always generates an exact manifest;
`compileTaskBundle` returns validated in-memory bytes, while `buildTaskBundle`
writes the complete directory and sibling CAR. Existing output must pass exact validation before
replacement. Unknown files, links and invalid artifacts are refused; failed
compilation preserves prior output. A matching legacy ownership sidecar is
removed after success, while a conflicting one is refused.

Locked Schema files use `schemas: [{path, digest}]`, with a `sha256:` lock over
the exact JSON bytes. Generated in-memory resources use `schemaDocuments`.
Both produce ordinary `schemas/` files and use the same offline resolver.
Every shared resource needs an absolute `$id` and the complete transitive closure.
Changed locks, conflicting IDs, unsupported Schema features and unresolved
fragments fail without network resolution.

Author check/build **evaluate the trusted contract module** in the local process.
They are not sandboxes; do not check untrusted source. They bundle but do not
execute the business callback. Artifact check/publish never evaluate source or
load the author's contract, TypeBox modules or dependencies.

All build paths validate the contracts and offline reference closure, then bind
the declaration only. They do not generate or bind standalone validators.
The Engine validates input/message before dispatch and result/checkpoint/failure
evidence before acceptance. The Worker retains protocol and payload budgets, but
has no automatic business validator, schema-runtime, Ajv or CID parser.
Type-only contract imports do not load validators.
Authors may explicitly import their own runtime validator, including Ajv; that
is a business dependency, not SDK overhead. Explicit entries can call a local
wrapper delegating to `runTask` without changing build configuration: the
builder binds immutable declaration data, never selects wrappers or
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
- Successful builds leave the artifact directory and final `<outDirectory>.car`, without a persistent
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
- Fixed Helia UnixFS import settings and deterministic Worker output produce the root
  CID and CAR offline. No self-referential CID field, network publishing or pin
  operation occurs during build.

The final CAR uses official `@helia/car`/`@ipld/car` framing. Artifact checking
verifies its single root, every block hash, full DAG completeness, canonical file-tree
identity and the exact manifest before admission. Missing/extra blocks, special
nodes, empty directories, unsafe paths and capacity overruns fail closed.
A previous CAR sibling must match the validated previous directory before replacement;
unmanaged or corrupt CAR siblings are preserved and refused.

Publish accepts the CAR alone (no author inputs, npm dependencies or extracted
directory required). Directory input remains supported and is encoded offline first.
It reads one immutable snapshot, imports the admitted CAR through Kubo `dag/import`
with `pin-roots=false`, then separately confirms a recursive root pin.
It never uploads custom `block/put` frames or relies on daemon chunking defaults.
The node must already exist and belongs to
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
