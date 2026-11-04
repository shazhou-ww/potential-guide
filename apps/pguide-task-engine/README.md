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
setting IDs and old flags; use `--ipfs-gateway-url` instead. Old fields fail even
when overridden. User files are never automatically rewritten.
`--help` prints the actual platform-specific pguide user configuration path,
defaults, all options and boundary rules without opening a DB, listener or Gateway
connection. See [the configuration guide](../../docs/task-server.md).

The package depends on the public Web UI application package, including its
server runtime and browser assets; no source-checkout/private-app dependency is
required. Without `--ui` no UI listener is started. Engine/UI communicate through
public HTTP, not an Engine object or SQLite access.
