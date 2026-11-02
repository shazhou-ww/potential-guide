# Task Engine Server

Generic Node HTTP/SSE assembly and CLI. Requests carry fixed Bundle references;
there is no type registry or discovery. It reuses generic artifact primitives,
without Checker/Objective business hosts or a production Task SDK dependency.
See [Engine guide](../../docs/task-engine.md).

```js
import { startTaskServer } from "@potential-guide/task-engine-server";
const server = await startTaskServer(trustedOptions);
console.log(server.url); // listening, Store claimed, recovery complete
await server.close(); // rejects when physical cleanup cannot be confirmed
```

`task-engine-server --config ./trusted-config.mjs` accepts a default exported
options object or async factory. The CLI alone owns SIGINT/SIGTERM handlers.
Use `--help` for text or `--help --format json` for machine-readable usage.
Fatal configuration/import/startup failures terminate the standalone process
nonzero even when configuration or failed rollback retains handles; the diagnostic
explicitly states that physical cleanup is unconfirmed, never `ready` or `closed`.
SQLite is the default; programmatic Store injection is supported. Injection
does not transfer Store ownership unless `ownStore: true`.
The default shutdown budget is 15,000ms and must cover the configured
`stopGraceMs + forceExitWaitMs` (both default to 5,000ms). Shorter compositions
must explicitly configure all three budgets; startup rejects inconsistent limits.
The 30,000ms request timeout is not an SSE response lifetime.

Configure `bundleDirectory`, optional `bundleLimits`/`bundleConcurrency`, and
the existing authorization/HTTP/Engine limits. `types`, `currentVersions`, and
`allocationLimits` are rejected legacy configuration.
`bindService(engine)` remains a trusted composition hook, not registration.
SQLite v5 refuses old databases before mutation; explicitly select a new path.
Check/Probe examples are still being switched to fixed Bundle references.
