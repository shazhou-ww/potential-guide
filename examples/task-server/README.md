# Public-package Task Bundle examples

The author builder emits the sole evolving v1 Bundle protocol. Check emits selected per-problem
diagnostics (index/kind/problem ID, not parameter/environment dumps) through
`context.log`; its existing Result/evidence schema remains unchanged. See
[Run Logs](../../docs/task-run-logs.md) and the concise SDK assertion sample.

The generic server installs Engine/HTTP/Storage/Server, **not** SDK, Check or Probe.
Install `@potential-guide/pguide-task-engine` and run
`pguide-task-engine --config ./server.yaml` against an independently managed
Kubo RPC, or select `--ipfs-transport gateway --ipfs-gateway-url http://127.0.0.1:8080`
for read-only consumption without RPC. A Gateway URL alone does not change the
default RPC transport; authors still write/pin through RPC.
See [service configuration](../../docs/task-server.md) for user settings,
precedence, `--no-global-config` and optional `--ui`.
The token-free CLI is fixed-loopback and single-scope only.
The `.mjs` examples are **programmatic composition helpers**, never CLI config
inputs: import `configureTaskServer` and pass its result to `startTaskServer`
when custom token authentication or injected clients are required.
`check-config.mjs` and `probe-config.mjs` intentionally use that identical
business-free configuration. Use a new v5 database path; older domains are
rejected without migration or rewriting their bytes.

On a separate author installation with `@potential-guide/task-sdk` (and the
chosen business packages), copy `build-bundles.mjs` and `echo-type.mjs`.
`node build-bundles.mjs echo .cache/author-echo` builds a fixed Bundle reference.
For Check use `check` and explicitly authorize `CHECK_ORIGIN` and/or
`CHECK_FILE_ROOT`. These are **business callback** policy, never a server
registration. For Probe also supply `CHILD_SERVICE_URL`, `CHILD_SERVICE_TOKEN`
and `CHECK_BUNDLE` (an exact root CID or `{cid,hint}` JSON Check Bundle reference).
Child credentials are explicit private author configuration; never put real
credentials in source control or publicly distributed Bundles. Run callbacks
do not inherit general host credentials.

The SDK produces a self-contained `worker.cjs`, declaration, locked Schema
closure and opaque resources. Import/pin the resulting directory on the
caller-managed IPFS node, not author source or `node_modules`. The returned root
CID is standard UnixFS content identity; name is display-only, not a selector.
Callbacks read bundled resources via `context.bundle.read(path)` byte streams,
not `import.meta.url` or physical host paths. Existing business Checker/Objective
archives and their URL/Digest inputs are unchanged.

POST `/tasks` with JSON and a fresh ULID `Idempotency-Key` (add a bearer token
only when using the authenticated programmatic example):

```json
{
  "bundle": "<exact-task-bundle-root-CID>",
  "timeoutMs": 30000,
  "checker": {
    "kind": "checker",
    "url": "https://trusted.example/checker.tgz",
    "digest": "sha256:<exact-64-hex-root-tree>"
  },
  "subject": {}
}
```

The receipt is `preparing`, `accepted` or `rejected`, not a Task snapshot.
Use `/requests/:requestId/status?waitMs=1000` until a terminal decision; observation
disconnects do not cancel preparation. `/requests/:requestId` reads original
intent separately. Only accepted decisions expose a real Task ID. Then read
`/tasks/:taskId`, its history, and independent `/runs/:runId` / Run history.
There is no type directory or registered selector, and no fabricated preparing
Task. Reuse an identical request ID only for the identical original request.

`node check-in-process.mjs <bundle-cid-or-json> <checker-url> <checker-digest>`
uses the same asynchronous admission protocol without Server.
`file:` business URLs require an explicit callback-owned trusted root; a browser
file picker does not grant remote filesystem access. The generic server has no
business upload or raw filesystem route.

Collection/SSE reads use a complete frozen baseline and source revision.
Reconnect with the last acknowledged `Last-Event-ID`; source members remain
atomic. CLI readiness is a JSON `ready` line. Catchable signals close cleanly;
Windows forced termination exercises restart recovery, not graceful shutdown.

`node probe-integration.mjs` exercises real authored Check/Probe Bundles,
negative business observations and evidence, direct/HTTP agreement, SSE
reconnect, child history, SQLite reopen, and physical business Worker cleanup.
`pnpm pack:check` runs it on installed production tarballs. Its local opaque
resources are fixture callback configuration, not host resource bridges.
The stronger separate-install proof is
`node scripts/check-packages.mjs --task-bundles`: author dependencies/source
are removed before a distinct business-free production process consumes both
CID-addressed directories and validates their actual results/evidence.
