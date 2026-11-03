# pguide task-engine

Install `@potential-guide/pguide-task-engine` beside `pguide`, with its
`pguide-task-engine` executable on PATH (or in pguide commandDirectories).
It implements the existing `pguide-command-v1` discovery protocol. No automatic
settings registration or user configuration writes occur.

```powershell
pguide task-engine --no-global-config --port 0 --database .\new-tasks.sqlite --ipfs-rpc-url http://127.0.0.1:5001
pguide-task-engine --config .\server.yaml --ui
pguide task-engine --help --format json
```

Only run these against an independently managed Kubo RPC you intend to use.
`--help` prints the actual platform-specific pguide user configuration path,
defaults, all options and boundary rules without opening a DB, listener or RPC
connection. See [the configuration guide](../../docs/task-server.md).

The package depends on the public Web UI application package, including its
server runtime and browser assets; no source-checkout/private-app dependency is
required. Without `--ui` no UI listener is started. Engine/UI communicate through
public HTTP, not an Engine object or SQLite access.
