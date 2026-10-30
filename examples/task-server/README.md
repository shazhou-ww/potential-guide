# Public-package examples

Install the corresponding packed packages and dependencies into an independent
consumer; copy these files there. They import package exports, never source paths.

- `task-engine-server --config ./echo-config.mjs`: no artifact/business dependency.
- `task-engine-server --config ./check-config.mjs`: trusted source registration.
- `node check-in-process.mjs https://trusted.example/checker.tgz sha256:…`: no Server.

Set `TASK_SERVER_TOKEN`, optionally `TASK_SERVER_PORT` / `TASK_SERVER_DATABASE`.
Check Server also requires `CHECK_ORIGIN`; `CHECK_WORKERS` selects its owned
snapshot directory. The examples intentionally do not inherit worker credentials.

POST `/tasks` with JSON, bearer token and a fresh ULID `Idempotency-Key`:

```json
{
  "type": "check",
  "timeoutMs": 30000,
  "checker": {
    "kind": "checker",
    "url": "https://trusted.example/checker.tgz",
    "digest": "sha256:<exact-64-hex-root-tree>"
  },
  "subject": {}
}
```

Follow `/tasks/:taskId`, `/event-history?taskId=...`, and `/events?taskId=...`.
Reconnect SSE with the last acknowledged `Last-Event-ID`; deduplicate by event
sequence. CLI readiness is a JSON `ready` line. SIGINT/SIGTERM cleanly close it
where the OS delivers catchable signals; Windows forced process termination is
crash recovery, not graceful shutdown.
# Probe composition

`probe-config.mjs` registers Check and Probe with the same generic Server and a
trusted scoped in-process child caller. Start it with the existing CLI:

```sh
task-engine-server --config ./probe-config.mjs
```

Set `TASK_SERVER_TOKEN`, `CHECK_ORIGIN`, and optionally `TASK_SERVER_DATABASE`,
`TASK_SERVER_PORT`, `CHECK_WORKERS`. Sources are authorized HTTPS archives.
The Check worker count is deliberately one; Probe has two separate parent slots.

With the required packages installed beside both files, run
`node probe-integration.mjs` for a disposable, repository-relative fixture:
real worker artifacts, in-process/HTTP comparison, SSE reconnect, scoped child
history, SQLite reopen, and physical cleanup. It does not publish or deploy.
`pnpm pack:check` runs this exact runner against installed production tarballs.
