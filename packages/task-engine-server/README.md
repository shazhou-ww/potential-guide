# Task Engine Server

Generic Node HTTP/SSE assembly and CLI. Registers only trusted TaskTypes; has no
Checker, Objective, or artifact dependency. See [server guide](../../docs/task-server.md).

```js
import { startTaskServer } from "@potential-guide/task-engine-server";
const server = await startTaskServer(trustedOptions);
console.log(server.url); // listening, Store claimed, recovery complete
await server.close(); // rejects when physical cleanup cannot be confirmed
```

`task-engine-server --config ./trusted-config.mjs` accepts a default exported
options object or async factory. The CLI alone owns SIGINT/SIGTERM handlers.
Use `--help` for text or `--help --format json` for machine-readable usage.
SQLite is the default; programmatic Store injection is supported. Injection
does not transfer Store ownership unless `ownStore: true`.
