# Task SDK

`@potential-guide/task-sdk` provides only the generation-scoped Task Worker
runtime (`runTask`, `RunFailure`) and callback/context types. Its only runtime
dependency is `@potential-guide/task-protocol`.

Build, artifact validation and publishing belong to
[pguide task-bundle](../pguide-task-bundle/README.md), not the SDK.
Use `task.build.yaml`, a TypeBox contract and a typed callback to generate the
complete self-contained artifact. The SDK has no author-build scripts, tool subpaths
or author examples; tooling fixtures live with the author CLI.

New entries explicitly `import { runTask } from "@potential-guide/task-sdk"`
and call `runTask(callback)`. The builder binds the verified declaration and
standalone validators into the SDK, not through author configuration or
`workerData`. A custom wrapper may delegate to `runTask` without builder
recognition or configuration changes.
Input/result/message validators are precompiled by the author CLI. The Worker
runtime executes those bound functions without importing the Schema compiler.

`context.log({level, message, fields?})` provides async typed diagnostic receipts,
independent of business outputs. The sole **v1** declaration includes its dedicated
channel; the project is unreleased and evolves v1 in place. Removed v2 and future
schema URLs are rejected, not aliased. Disabled/custom-host diagnostics remain
unavailable. See [Run Logs](../../docs/task-run-logs.md) and the author's
[diagnostics example](../pguide-task-bundle/examples/low-level/check-diagnostics/callback.ts).

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
