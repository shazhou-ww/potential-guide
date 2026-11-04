# Task SDK

`@potential-guide/task-sdk` provides the generated Worker runtime. Author tools
import `buildTaskBundle`/`compileTaskBundle` from `@potential-guide/task-sdk/build`,
`checkTaskArtifact` from `/artifact`, and `createIpfsClient`/`importTaskBundle` from `/publish`;
the runtime entry never imports the builder.

The preferred author workflow is [pguide task-bundle](../pguide-task-bundle/README.md):
`task.build.yaml` plus a TypeBox contract and typed callback generate the complete
artifact. No author-maintained runtime YAML or include command is needed.
The low-level compiler API remains available for repository tooling and the SDK's
`examples/echo`/`check-diagnostics` fixtures: its `declaration` accepts a JSON-compatible
definition or a declaration-source filename; it always generates the exact manifest.
This is not a fallback for loading legacy artifacts. Old no-manifest artifacts are
rejected by artifact checking, publishing and Engine admission with rebuild guidance.
Only Node built-ins may remain external to `worker.cjs`.

`compileTaskBundle` returns validated in-memory bytes without writing.
`buildTaskBundle` writes a complete clean artifact, including a YAML-formatted
`task.yaml`. An existing output must pass exact artifact validation before
replacement; unknown files, invalid artifacts and links are refused.
Failed compilation preserves prior output. No persistent sidecar is generated.
A matching legacy `.pguide-task-bundle.json` ownership marker is removed after
a successful build; a conflicting marker is refused rather than deleted.

`context.log({level, message, fields?})` provides async typed diagnostic receipts,
independent of business outputs. The sole **v1** declaration includes its dedicated
channel; the project is unreleased and evolves v1 in place. Removed v2 and future
schema URLs are rejected, not aliased. Disabled/custom-host diagnostics remain unavailable. See
[Run Logs, limits and independent install verification](../../docs/task-run-logs.md)
and the packaged `examples/check-diagnostics` assertion sample.

Shared JSON Schema files are supplied through `schemas: [{path, digest}]`.
Generated in-memory schemas can instead use `schemaDocuments`; both paths use
the same offline resolver and produce ordinary `schemas/` files.
Each lock is `sha256:` plus the SHA-256 of the exact JSON file bytes. Every
resource needs an absolute `$id`; supply the entire transitive closure. The
builder never resolves references over the network. A changed lock, missing
resource, conflicting ID, unsupported Schema feature or unresolved fragment fails
the build. The generated runtime embeds the same resolved contracts.
Declarations may reference exact Bundle-relative Schema paths such as
`schemas/0.json` (including fragments), as well as their absolute `$id` values.
All build, artifact-check and Engine paths use the same offline file mapping.

The builder returns `{directory, cid, declaration}`. The CID is the standard
UnixFS directory root, computed offline with fixed import settings; no Bundle
tree digest or archive is required. Publish with
`importTaskBundle(directory, await createIpfsClient("http://127.0.0.1:5001"))`.
The independently running local Kubo node must already exist. Publication pins
the root; that pin belongs to the publisher/caller, never the Engine.
Submit a root CID string or `{cid, hint}`; `hint` is a nonempty HTTP(S) gateway
base URI or ordered nonempty array. Hints are not content identity; changing their
representation/order still changes raw Request intent.
Names are display text, not identifiers. The fixed declaration `$schema` also
identifies the generation-scoped Worker communication contract; there is no
independent numeric format/protocol version.

`context.bundle.read(relativePath, {signal?})` always returns a standard
`ReadableStream<Uint8Array>`. It is demand-driven, supports cancellation and
surfaces creation/midstream errors. Buffer explicitly when needed:

```ts
const chunks: Uint8Array[] = [];
for await (const chunk of context.bundle.read("resources/data.bin")) chunks.push(chunk);
const bytes = Buffer.concat(chunks);
```

Resources belong to the current root; absolute paths, traversal and absent files
fail. Do not locate resources with `__dirname`, `import.meta.url` or cwd:
Workers may execute verified CommonJS source in memory without a Bundle directory.
Bundle bytes are immutable. Runtime output belongs outside the Bundle.
Workers are isolation/lifecycle boundaries, not security sandboxes.

The generation-scoped message contract is documented in
[`docs/task-bundle-worker.md`](https://github.com/shazhou-ww/potential-guide/blob/main/docs/task-bundle-worker.md).
