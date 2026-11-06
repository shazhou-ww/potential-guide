# Public-package Task Bundle examples

The author builder emits the sole evolving v1 Bundle protocol. Check emits selected per-problem
diagnostics (index/kind/problem ID, not parameter/environment dumps) through
`context.log`; its existing Result/evidence schema remains unchanged. See
[Run Logs](../../docs/task-run-logs.md) and the concise SDK assertion sample.

The generic server installs Engine/HTTP/Storage/Server, **not** SDK, Check or Probe.
Install `@potential-guide/pguide-task-engine` and run
`pguide-task-engine --config ./server.yaml` against an independently managed
read-only Trustless Gateway, or provide `--ipfs-gateway-url http://127.0.0.1:8080`.
The URL is required: no default node, transport selection or RPC fallback exists.
Authors build CARs offline and choose an external upload/import/pin tool.
Old service RPC/transport fields and flags are rejected.
See [service configuration](../../docs/task-server.md) for user settings,
precedence, `--no-global-config` and optional `--ui`.
The token-free CLI is fixed-loopback and single-scope only.
The `.mjs` examples are **programmatic composition helpers**, never CLI config
inputs: import `configureTaskServer` and pass its result to `startTaskServer`
when custom token authentication or injected clients are required.
These programmatic helpers require an injected `ipfsClient` or an explicit
`IPFS_GATEWAY` URL; they no longer default to Kubo RPC. `check-in-process.mjs`
also requires `IPFS_GATEWAY`. These helper environment variables are not service
CLI configuration layers; the author builder no longer uses `IPFS_API`.
Install `@potential-guide/task-engine` and `@potential-guide/task-protocol`
alongside the programmatic helpers and Server/Engine packages they import.
`check-config.mjs` and `probe-config.mjs` intentionally use that identical
business-free configuration. Use a new v5 database path; older domains are
rejected without migration or rewriting their bytes.

On a separate author installation with `@potential-guide/pguide-task-bundle`,
`@potential-guide/task-sdk` (and the
chosen business packages), copy `build-bundles.mjs` and `echo-type.mjs`.
`node build-bundles.mjs echo .cache/author-echo` prints the offline directory, CAR and root CID.
For Check use `check` and explicitly authorize `CHECK_ORIGIN` and/or
`CHECK_FILE_ROOT`. These are **business callback** policy, never a server
registration. For Probe also supply `CHILD_SERVICE_URL`, `CHILD_SERVICE_TOKEN`
and `CHECK_BUNDLE` (an exact root CID or `{cid,hint}` JSON Check Bundle reference).
Child credentials are explicit private author configuration; never put real
credentials in source control or publicly distributed Bundles. Run callbacks
do not inherit general host credentials.

The SDK produces a self-contained `worker.cjs`, declaration, locked Schema
closure and selected resources. `buildExampleBundle` forwards explicit final-path
`binary` patterns to the ordinary builder; embedding an archive requires, for example,
`binary: ["resources/checker.tgz"]`. `resources` alone does not declare binary, and
neither this helper nor the compiler guesses from an extension. Other resources use
the default strict UTF-8/LF rules. Import/upload and pin the resulting CAR using an
external tool and destination of your choice, not author source or `node_modules`. The returned root
CID is standard UnixFS content identity; name is display-only, not a selector.
Callbacks read bundled resources via `context.bundle.read(path)` byte streams,
not `import.meta.url` or physical host paths. Existing business Checker/Objective
archives and their URL/Digest inputs are unchanged.
Gateway URLs must be root origins without path prefixes. Explicit binary data is fetched on demand
by default, so a later Gateway failure can fail a Run; default text is validated before admission.
`bundlePrefetch: true` restores
complete prefetch when composing an Engine/Server programmatically.

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
