# Public-package Task Bundle examples

The generic server installs Engine/HTTP/Storage/Server, not author SDKs or
business adapters. The old Check task and Probe adapters, their configuration
helpers and execution examples are retired. They have no compatibility
registration or automatic Objective/state migration.

## Author and run Echo

On a separate author installation with `@potential-guide/pguide-task-bundle`
and `@potential-guide/task-sdk`, copy `build-bundles.mjs` and `echo-type.mjs`.

```powershell
node build-bundles.mjs echo .cache/author-echo
```

The builder accepts only `echo` and emits the current v1 directory, CAR and
standard UnixFS root CID. Import/upload and pin the CAR using a caller-selected
external tool. Authoring does not upload, publish npm packages or grant general
host credentials to callbacks.

For new business Checks, use [`check-sdk`](../../packages/check-sdk/README.md)
and the standard Task Bundle authoring flow.
[`check-environment`](../../packages/check-environment/README.md) provides
working tools/directories/network examples with direct business inputs and
`{pass, problems?}` results. Do not send an old Checker URL/digest/subject
envelope to these new Bundles.

Install `@potential-guide/pguide-task-engine` and run
`pguide-task-engine --config ./server.yaml` against an independently managed
read-only Trustless Gateway, or provide `--ipfs-gateway-url http://127.0.0.1:8080`.
There is no default content endpoint, RPC fallback or transport selection.
See [service configuration](../../docs/task-server.md) for user settings,
precedence, `--no-global-config` and optional `--ui`.

The token-free CLI is fixed-loopback and single-scope only. `echo-config.mjs`
is a **programmatic composition helper**, not CLI configuration: import
`configureTaskServer` and pass its result to `startTaskServer` for token
authentication or injected clients. It requires an injected `ipfsClient` or
explicit `IPFS_GATEWAY`; it never defaults to Kubo RPC.
Install Engine/Protocol alongside the programmatic Server packages it imports.
Use a new v5 database path; older domains are rejected without rewriting them.

POST `/tasks` with JSON and a fresh ULID `Idempotency-Key` (add a bearer token
only when using the authenticated programmatic helper):

```json
{
  "bundle": "<exact-echo-task-bundle-root-CID>",
  "timeoutMs": 30000,
  "text": "hello"
}
```

The receipt is `preparing`, `accepted` or `rejected`, not a Task snapshot.
Use `/requests/:requestId/status?waitMs=1000` until a terminal decision; observation
disconnects do not cancel preparation. `/requests/:requestId` reads original
intent separately. Only accepted decisions expose a Task ID. Then read its
Task history and independent Run/Run history. Reuse an identical request ID
only for the identical original request.

Callbacks read bundled resources via `context.bundle.read(path)` byte streams,
not author paths. Gateway data is fetched on demand; `bundlePrefetch: true`
restores complete prefetch in programmatic composition. A browser file picker
does not grant remote filesystem access; Server has no business upload or raw
filesystem route.

Collection/SSE reads use a frozen baseline and source revision. Reconnect with
the last acknowledged `Last-Event-ID`. CLI readiness is a JSON `ready` line;
catchable signals close cleanly. Windows forced termination tests restart
recovery, not graceful shutdown.

## Verification

`node scripts/check-packages.mjs --task-sdk` verifies a self-contained SDK Worker
with author dependencies unavailable. `--task-service` verifies independent
service/CLI consumption, and `--bundle-authoring` verifies the author commands.
The removed `--task-bundles` Check-adapter consumer scope is rejected rather
than silently running a different scenario. Run diagnostic logging is described
in [Run Logs](../../docs/task-run-logs.md).
