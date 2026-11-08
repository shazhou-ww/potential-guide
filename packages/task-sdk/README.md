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
and call `runTask(callback)`. The builder binds the verified declaration
into the SDK, not through author configuration or
`workerData`. A custom wrapper may delegate to `runTask` without builder
recognition or configuration changes.
The Engine validates input and business messages before dispatch, and validates
checkpoint, complete and RunFailure result evidence before acceptance or storage.
The Worker trusts those input/message checks; it contains no automatic business
Schema validator, schema-runtime, projection engine, or Ajv dependency.
Build-time contract, reference and budget checks remain in the author tools.

The Engine also checks JSON shape, nesting/node and byte limits, and log/progress
payloads. The SDK forwards host-validated input/messages and sends author outputs
without walking or normalizing their payloads. Queue bounds, generation/Run routing,
declaration equality, cancellation and resource streams remain in the SDK.
Startup declaration comparison still uses canonical JSON; it is not business
payload validation.

IPC uses Node's structured clone: sendable non-JSON values (such as cycles,
BigInt and Date) are rejected by the host. Values that cannot be cloned, such as
functions, reject locally with `invalid_payload`; failed sends do not consume
message IDs or pending credits. Structured clone may evaluate getters and normalize
custom objects before the host sees them. Authors should send plain JSON data;
the host validates the received representation, not the original object descriptors.
Receiver byte limits govern acceptance, not the memory allocated while cloning
or transporting a message.
A rejected checkpoint remains a failed output even if the callback catches its
promise. Rejected completion becomes a failure report; rejected failure evidence
is re-reported using the host's error without that evidence. Normal completion or
failure release follows an acknowledged terminal fact; cancellation retains its
stopping/release path, and an unavailable terminal channel reports uncertainty.
Custom hosts must implement the same full validation and negative-ACK lifecycle,
not simply acknowledge every frame. Authors may import their own validators;
those business dependencies remain bundled and are separately attributable.

The host owns CID parsing, supported codec/hash checks, DAG verification and
Bundle-relative path resolution. The SDK treats the host-verified CID as an
opaque, nonempty string of at most 256 characters and echoes it in the ready
handshake; the SDK itself does not import a CID parser. Declaration equality is
still checked against the build-locked binding, and the host must match the handshake against
its verified Bundle before dispatching a Run.

`context.bundle.cid` exposes that host-verified executing root as a readonly
property on the frozen Bundle context. It is not taken from task input or
compiled into the hashed worker. Wrappers can use it for independently
resolvable immutable resource URIs without a self-referential build identity.
Custom hosts must supply the actual admitted root through the existing trusted
Worker configuration and enforce the ready handshake; this is not author attestation.

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

## Host-mediated child Tasks

`context.invokeTask({key, cid, path, input, timeoutMs})` returns the independently
validated child result. `key` is a stable parent-Run-local idempotency key; retries
must keep the identical intent. `path` selects an embedded directory under the
verified parent `resources/` DAG; its root must equal the canonical `cid`.
Input is a JSON object without Task envelope fields.

The host supplies the inherited caller, content source and authorization; the
Worker does not supply addresses, credentials or scope. Composition is denied
unless the host explicitly enables `authorizeChild`. Default limits are 4 levels,
4 children in flight per parent, 4 executing children per depth, and 64 children
over the whole root Run. Each depth has its own bounded lane, avoiding waiting
parents exhausting their children's execution capacity. Default invocation and
cleanup budgets are 30 seconds and 5 seconds; parent Task and execution deadlines
can only narrow them.

The association and request intent are persisted before admission. Parent
cancellation, timeout, Worker exit and host recovery cancel descendants.
Success waits for child physical-release proof; failed cleanup reports
`reclamation_unknown`. Recovery cancels demand but never invents proof of physical
release after a crashed host. No child Worker is loaded into the parent. Existing
non-composing Bundles remain unchanged and need no extra configuration.

The generation-scoped message contract is documented in
[`docs/task-bundle-worker.md`](https://github.com/shazhou-ww/potential-guide/blob/main/docs/task-bundle-worker.md).
