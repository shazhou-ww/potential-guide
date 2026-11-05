# pguide task-engine

Install `@potential-guide/pguide-task-engine` beside `pguide`, with its
`pguide-task-engine` executable on PATH (or in pguide commandDirectories).
It implements the existing `pguide-command-v1` discovery protocol. No automatic
settings registration or user configuration writes occur.

```powershell
pguide task-engine --no-global-config --port 0 --database .\new-tasks.sqlite --ipfs-gateway-url http://127.0.0.1:8080
pguide-task-engine --config .\server.yaml --ui
pguide task-engine --help --format json
```

Provide an explicit read-only Trustless Gateway URL through CLI, the specified
YAML/JSON file or `task-engine.ipfsGatewayUrl` in user settings. There is no default
node or public Gateway, RPC selection or fallback. Author publishing/pinning is unchanged.
**Breaking change:** remove `ipfsRpcUrl` / `ipfsTransport`, their `task-engine.`
setting IDs and old flags; use `--ipfs-gateway-url` instead. Old fields in explicit
files or CLI options fail even when overridden; incompatible global configuration
is warned about and ignored. User files are never automatically rewritten.
`--help` prints the actual platform-specific pguide user configuration path,
defaults, all options and boundary rules without opening a DB, listener or Gateway
connection. See [the configuration guide](../../docs/task-server.md).

The package depends on the public Web UI application package, including its
server runtime and browser assets; no source-checkout/private-app dependency is
required. Without `--ui` no UI listener is started. Engine/UI communicate through
public HTTP, not an Engine object or SQLite access.

Incompatible or unreadable global configuration/settings registrations emit a
warning to stderr and the entire global layer is ignored without changing files.
Explicit `--config` files and CLI options still fail on invalid input.
Use `--no-global-config` to skip the global layer without a warning.

The package-owned `objectives.yaml` permits `@potential-guide/task-sdk` only for
the existing development dependency that authors standard Bundle fixtures in
service tests, following the Web UI application's declaration. It is not a
production dependency or a service runtime import; no repository-wide dependency
exception is required.

## Real local Kubo end-to-end verification

The opt-in integration test uses the repository's actual `pguide` discovery and
command executables, not a mock IPFS client or an npm tarball. From the repository
root, after installing dependencies:

```powershell
pnpm exec turbo run build --filter=@potential-guide/pguide-task-engine... --filter=@potential-guide/pguide-task-bundle... --filter=pguide...
$env:PGUIDE_E2E_KUBO_RPC = 'http://127.0.0.1:5001'
$env:PGUIDE_E2E_KUBO_GATEWAY = 'http://127.0.0.1:8080'
pnpm exec tsx --test apps\pguide-task-engine\test\kubo.e2e.test.ts
```

Both URLs must be explicitly supplied; without them the test is skipped. Use an
already running, caller-managed Kubo whose RPC permits CAR imports and whose
Gateway serves raw blocks. The test never starts/stops Kubo or edits its
configuration. It imports and **recursively pins** its generated CAR with
`POST /api/v0/dag/import?pin-roots=true`; imported roots remain pinned afterward,
including roots imported before a later assertion fails. It never removes pins
from the shared node. Only run it when these writes are authorized.

The test initializes a separate author package, reuses the repository's installed
SDK/TypeBox dependencies, builds and checks the CAR, imports it into real Kubo,
and runs a CLI-owned Engine against the Gateway. It verifies streamed Bundle
resource reads, a business-created JSON file, the completed Task/Run result,
`run.started`, `run.dispatched`, `run.progress`, `run.outcome`, `run.exited`,
`run.reclaimed` history and diagnostic logs. Restarting with the same SQLite DB
must preserve the result/history/logs and return the same Task for a repeated
Request. An outcome report is not itself a terminal Task: completion is checked
after physical Worker exit and reclamation.

Each Engine uses a private DB and a random loopback port. Ready diagnostics
include its URL and PID. A test launcher records the owned service PID before
startup, so even a readiness timeout can terminate the actual service rather
than just the dispatching CLI. All owned CLI processes and temporary author/DB files
are cleaned up; the shared Kubo remains running. Windows process termination is
forced, so the test waits for Worker reclamation before stopping its Engine.
It does not claim to verify graceful Windows OS signal delivery.
Optionally set `PGUIDE_E2E_REPORT` to an absolute, writable JSON filename to retain
the CID, Request/Task/Run IDs, endpoints/PIDs, observed events/logs and exact
business artifact content after temporary files and services have been removed.
