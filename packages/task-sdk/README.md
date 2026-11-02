# Task SDK

`@potential-guide/task-sdk` provides the generated Worker runtime. Author tools
import `buildTaskBundle` and `packTaskBundle` from `@potential-guide/task-sdk/build`;
the runtime entry never imports the builder.

Write `task.yaml` and a callback `(input, context) => Promise<result>` independently.
See `examples/echo`; run its `build.mjs` after building the workspace. Output must
not already exist. Only Node built-ins may remain external to `worker.cjs`.

Shared JSON Schema files are supplied through `schemas: [{path, digest}]`.
Each lock is `sha256:` plus the SHA-256 of the exact JSON file bytes. Every
resource needs an absolute `$id`; supply the entire transitive closure. The
builder never resolves references over the network. A changed lock, missing
resource, conflicting ID, unsupported Schema feature or unresolved fragment fails
the build. The generated runtime embeds the same resolved contracts.

The returned Bundle Digest is the Git SHA-256 root tree OID, not a tarball hash.
Publish the archive separately and submit its complete `{url, digest}` reference.
Names are display text, not identifiers. The fixed declaration `$schema` also
identifies the generation-scoped Worker communication contract; there is no
independent numeric format/protocol version.

Bundle bytes are immutable. Runtime output belongs outside the Bundle directory.
Workers are isolation/lifecycle boundaries, not security sandboxes.

The generation-scoped message contract is documented in
[`docs/task-bundle-worker.md`](https://github.com/shazhou-ww/potential-guide/blob/main/docs/task-bundle-worker.md).
