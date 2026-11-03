# Task Bundle authoring

`@potential-guide/pguide-task-bundle` installs `pguide-task-bundle`, advertising
`task-bundle` through the existing `pguide-command-v1` discovery protocol. Put its
binary on PATH (or in `pguide.commandDirectories`); no Engine/server is installed
or started. Node >=22.13 and TypeBox **@sinclair/typebox 0.34.52** are supported.

```text
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

## Author input

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task-build/v1.json
name: Echo
runtime:
  minVersion: "22.13.0"
source:
  entry: src/main.ts
  contract: src/contract.ts
  # exportName: default
include:
  - from: assets/**/*.json
    to: resources/
outDirectory: dist
```

Paths are relative to the build file, use portable `/` separators, and cannot
escape its directory or traverse links. There is no second author-maintained
`task.yaml`. `include` and `source.exportName` are optional; unknown fields fail.
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
const callback: BundleCallback<typeof contract> = async (input) => ({ text: input.text });
export default callback;
```

Install TypeBox in the author's project. `Static<typeof contract.input>` can
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
three generated root schemas receive stable IDs unless the author supplies them,
are stored under `schemas/`, and are referenced by the generated declaration.

Author check/build **evaluate the trusted contract module** in the local process.
They are not sandboxes; do not check untrusted source. They bundle but do not
execute the business callback. Artifact check/publish never evaluate source or
load the author's contract, TypeBox modules or dependencies.

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
  compile retains the previous artifact. Managed output is replaced, not merged,
  so deleted resources disappear.
- The sibling `dist.pguide-task-bundle.json` records output ownership, not Bundle
  content. Existing unowned directories, or managed artifacts with unexpected
  files, are never recursively overwritten. Keep the marker for rebuilds; copy
  **only dist** for distribution. Do not edit the marker or recover a stale lock
  while another build is running.
- Replacement is an operation-level rollback, not a crash-durable filesystem
  transaction or a guarantee of gap-free directory visibility. A process crash
  can leave a lock and staging/backup siblings. Builds fail closed on that lock:
  stop the owning process, inspect the marker and validate the output or backup
  with `check artifact`, then recover only those owned paths. Do not remove a lock
  automatically or delete a backup before confirming a valid retained artifact.
- `task.yaml` contains a required, exact `include` list including itself,
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
