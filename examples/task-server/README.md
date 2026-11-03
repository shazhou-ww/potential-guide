# Public-package Task Bundle examples

The author builder now emits explicit v2 Bundles. Check emits selected per-problem
diagnostics (index/kind/problem ID, not parameter/environment dumps) through
`context.log`; its existing Result/evidence schema remains unchanged. See
[Run Logs](../../docs/task-run-logs.md) and the concise SDK assertion sample.

The generic server installs Engine/HTTP/Storage/Server, **not** SDK, Check or Probe.
Run `task-engine-server --config ./echo-config.mjs` with `TASK_SERVER_TOKEN`
and optionally `TASK_SERVER_PORT` / `TASK_SERVER_DATABASE`.
`check-config.mjs` and `probe-config.mjs` intentionally use that identical
business-free configuration. Use a new v5 database path; older domains are
rejected without migration or rewriting their bytes.

On a separate author installation with `@potential-guide/task-sdk` (and the
chosen business packages), copy `build-bundles.mjs` and `echo-type.mjs`.
`node build-bundles.mjs echo .cache/author-echo` builds a fixed Bundle reference.
For Check use `check` and explicitly authorize `CHECK_ORIGIN` and/or
`CHECK_FILE_ROOT`. These are **business callback** policy, never a server
registration. For Probe also supply `CHILD_SERVICE_URL`, `CHILD_SERVICE_TOKEN`
and `CHECK_BUNDLE` (an exact JSON `{url,digest}` Check Bundle reference).
Child credentials are explicit private author configuration; never put real
credentials in source control or publicly distributed Bundles. Run callbacks
do not inherit general host credentials.

The SDK produces a self-contained `worker.cjs`, declaration, locked Schema
closure and opaque resources. Deploy only the resulting archive, not author
source or `node_modules`. The returned Digest is the Git SHA-256 **file tree**
identity, not the tar.gz checksum. Name is display-only, not a selector.

POST `/tasks` with JSON, bearer token and a fresh ULID `Idempotency-Key`:

```json
{
  "bundle": {
    "url": "https://trusted.example/check-task.tar.gz",
    "digest": "sha256:<exact-64-hex-root-tree>"
  },
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

`node check-in-process.mjs <bundle-url> <bundle-digest> <checker-url> <checker-digest>`
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
archives and validates their actual results/evidence.
