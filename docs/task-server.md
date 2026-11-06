# Generic Task Server

For the optional Chinese debugging workbench, see
[Task Engine Web UI](task-engine-webui.md). It uses public HTTP only.
It can run independently or be started alongside Engine by the service command.

The generic v5 protocol is Bundle-based. Old Check and Probe task adapters,
registration APIs and their authoring/integration examples are retired.
See [the current generic API](task-engine.md).

The generic Server composes Engine, HTTP adapter and SQLite. It neither interprets
Check/Objective business artifacts nor grants permissions based on Request fields. The standalone command
is `pguide-task-engine` from `@potential-guide/pguide-task-engine`. Importing the programmatic
entry opens no listener and installs no global signal handlers.

## Declarative local service

Install the command package alongside `pguide` and expose its binary on PATH or
through existing `pguide.commandDirectories`. Both entries share one parser:

```powershell
pguide task-engine --config .\server.yaml --port 0
pguide-task-engine --no-global-config --database .\new-tasks.sqlite --port 0 --ipfs-gateway-url http://127.0.0.1:8080
pguide task-engine --help --format json
```

```yaml
host: localhost
port: 3000
database: ./tasks.sqlite
ipfsGatewayUrl: http://127.0.0.1:8080
scope: local
ui: true
uiOptions:
  host: 127.0.0.1
  port: 4310
  favoritesFile: ./task-favorites.json
```

Precedence is **explicit CLI > explicit YAML/JSON file > pguide user
config.jsonc > defaults**. An invalid, incompatible or unreadable global
configuration or settings registry emits a warning to stderr; the entire global
layer is ignored without modifying its files. Explicit file and CLI layers are
validated even when overridden: unknown fields, duplicate keys, malformed files
and missing explicit files fail. No JavaScript config is imported.
No project service values or environment service overrides are added.

The user file uses complete setting IDs, for example
`{"task-engine.port":3001,"task-engine.database":"./tasks.sqlite","task-engine.ipfsGatewayUrl":"http://127.0.0.1:8080"}`. Settings are
`task-engine.host`, `.port`, `.database`,
`.ipfsGatewayUrl`, `.scope`, `.ui` and
`.uiOptions`; dots identify complete settings, not nested property paths.
Other namespaces remain valid shared settings. Objects replace as a whole:
`uiOptions` must contain exactly host, port and favoritesFile in every layer
that supplies it. CLI equivalent is `--ui-options '<complete JSON object>'`.
Use `--ui` / `--no-ui` for an explicit boolean. No `ipfsEndpoint` or
`ipfs.rpcUrl` aliases exist.

The service is **Gateway-only**. An explicit `ipfsGatewayUrl` /
`--ipfs-gateway-url` must be supplied by an enabled layer, for example:

```yaml
ipfsGatewayUrl: http://127.0.0.1:8080/content
```

Equivalent user settings are
`{"task-engine.ipfsGatewayUrl":"http://127.0.0.1:8080/content"}`.
There is no default node or public Gateway, RPC probe or fallback. Missing URLs
fail before a database or listener is opened. URLs accept only HTTP(S) without
credentials, query or fragment, even when overridden. Gateway
base paths are preserved: `/content` and `/content/` both request
`/content/ipfs/{cid}?format=raw` with Accept `application/vnd.ipld.raw`.
Gateway is an independent primary read backend: it never connects or falls back
to RPC, including on failure. Non-200 status, wrong MIME, encoded bodies,
redirects, corrupt CIDs and capacity violations fail explicitly.
Responses are streamed with a 2 MiB/block limit and a 30-second timeout through
body completion; preparation cancellation aborts reads. Existing verified UnixFS
export, DAG, file and total protection limits remain in force.
No local Kubo executable or management API is required.
Authors still import/write/pin with RPC; Gateway does not publish or promise
availability/persistence. Engine-only and optional UI use the same read backend.

The existing user path is `%APPDATA%\pguide\config.jsonc` on Windows
(fallback `~\AppData\Roaming\pguide\config.jsonc`) and
`$XDG_CONFIG_HOME/pguide/config.jsonc` elsewhere (fallback
`~/.config/pguide/config.jsonc`). Help prints the actual path. Missing user files
are optional; malformed/unreadable global files or incompatible registered
settings emit a warning and the entire global layer is ignored. `--no-global-config`
skips the user main file, including its commandDirectories during top-level
discovery. PATH and project command discovery still work; project service values
never participate. Other commands continue rejecting the retired global `--config`.
No configuration file or registration is automatically written.

`--cwd` selects the effective CWD at either entry. CLI paths and the path passed
to `--config` resolve there. File-provided paths resolve against that file's own
directory, including paths in uiOptions; overriding another value does not move
their anchor. Defaults are 127.0.0.1:3000, tasks.sqlite,
scope local and UI off, with no default content endpoint. Default UI is 127.0.0.1:4310 with
task-favorites.json in effective CWD. Port 0 selects a free port; ready output
reports actual Engine and optional UI URLs.

CLI is token-free **local-only**, not a multiuser security boundary. Only
127.0.0.1, localhost (normalized to 127.0.0.1), and ::1 are accepted.
Caller `local-cli` can use the explicit supported operations only in the
configured scope. Host, Origin and browser fetch-site are checked; only GET/POST
are admitted and POST requires application/json. UI retains its own same-origin
and CSRF rules and connects to Engine over HTTP. Do not expose this service
through a proxy. Other local users/processes are not isolated.

Foreground startup owns only the Engine and optional UI it creates. UI startup
failure rolls Engine back; catchable SIGINT/SIGTERM closes UI then Engine.
It never starts/stops Kubo, manages pins/GC/IPFS_PATH, replaces occupied listeners,
or cancels Tasks when a browser closes. Windows forced process termination is
not graceful cleanup. No system daemon or autostart is installed.

**Breaking change:** service `ipfsRpcUrl`, `ipfsTransport`, the full user IDs
`task-engine.ipfsRpcUrl` / `task-engine.ipfsTransport`, and CLI flags
`--ipfs-rpc-url` / `--ipfs-transport` are retired. Remove them and supply a
read-only Gateway using `ipfsGatewayUrl`, `task-engine.ipfsGatewayUrl` or
`--ipfs-gateway-url`. Old fields in explicit files or CLI options fail with migration guidance;
old global service fields cause a warning and the entire global layer is ignored.
No user files are automatically changed. Disabled user
configuration is not read or validated; project service values remain excluded.
Author Kubo write/import/pin APIs and programmatic `IpfsClient` injection remain
available; this removal applies only to service configuration and assembly.

The old `task-engine-server` binary and `.mjs` configuration import path are
retired. Convert service `IPFS_API` usage to `--ipfs-gateway-url` or `ipfsGatewayUrl`
with a Gateway endpoint (not a Kubo RPC URL),
`TASK_SERVER_PORT` to `--port`, and `TASK_SERVER_DATABASE` to `--database`.
Those old example environment variables are not read by the new command.
The local CLI does not use `TASK_SERVER_TOKEN`; applications needing custom
authentication/callbacks must use the unchanged programmatic assembly below.

## Trusted assembly

Pass `authorize`, `resolveCaller`, and a caller-owned generic `ipfsClient`
(for example `await createIpfsClient(rpcUrl)` or
`createIpfsGatewayClient(gatewayUrl)` from `@potential-guide/task-engine`); optional
`bundleLimits` and `bundleConcurrency` govern preparation. Registry options
`types`, `currentVersions`, and `allocationLimits` are rejected.
`resolveCaller` authenticates every HTTP request (including SSE reconnect);
Engine `authorize` checks every operation and every stream pull. Scope is trusted
Caller context, never a business field. Deny by default. Local callers must pass
the same authorization policy. HTTP cannot load config modules or change resource
limits. Programmatic composition is trusted application code; CLI configuration
is data only and cannot serialize authorization or resource callbacks.

`startTaskServer` defaults to loopback port 3000 and `tasks.sqlite`. `port: 0`
requests an ephemeral port. The returned URL means Store recovery and listening
have succeeded. HTTP request/body/parser/subscription limits and socket/request
timeouts are bounded. Put TLS and rate quotas at the deployment boundary.

There is no `/task-types`. POST `/tasks` carries a root CID string or `{cid,hint}`;
the optional ordered gateway hints never become content identity. The Engine
validates every DAG block and the full Bundle before creating a Task, runs verified
CommonJS source without a mandatory content directory, and never stops the node,
closes a shared client, or removes shared pins.
Idempotency-Key supplies requestId. Old If-Match guards are rejected.
preparing returns 202 without a Task; accepted/rejected return the stored terminal
decision with 200. GET `/requests/:id/status?waitMs=…` observes the same Request,
separately from GET `/requests/:id` for its immutable original intent.

GET `/runs` 通过独立 `list-runs` 权限返回按 scope 授权的冻结完整 Run 摘要；
明确更新允许列表，不从 Task 权限推导 Run 目录权限。摘要不含 Input/Result/owner。
已绑定关联需求通过 GET `/tasks?runId=...` 及独立 Task `list` 权限查询。
两种目录的游标域独立，重启/历史清理后失效；见
[目录契约](task-engine.md#授权目录与查询)。旧目录与查询字段不提供兼容别名。
Engine 直接启动 SDK 生成的 worker.cjs，不接受类型 factory，也不执行历史业务复验。
Facts/SQLite v5 在写入前拒绝 v4 等旧数据库；新部署须显式选择新路径，不能覆盖、删除或迁移旧库，
也不能将新域身份或 revision 冒充旧域连续历史。

The HTTP protocol includes POST `/tasks` with `Idempotency-Key`, GET
`/tasks/:id`, POST `/tasks/:id/cancel`, GET `/event-history?taskId=...`, GET
`/events?taskId=...` with an explicit `fromRevision` or `Last-Event-ID`. Task and Run
also have independent `/:id/history` and `/:id/events` routes; `/tasks/events` and
`/runs/events` emit complete source envelopes. Creation returns 202. Freeze the
entire paged baseline before subscribing from its revision. A source may affect
multiple members: apply its whole envelope before advancing the anchor, and never
deduplicate individual members by source sequence alone. Disconnect
does not cancel a Task. Business `ok:false` is a normal completed Check result.

## Resource ownership

Server does not expose Bundle cache management APIs. Persistent content belongs to
the independent IPFS node; Engine's verified in-memory load results and leases are
internal runtime state. See [content storage and reuse](./task-bundle-cache.md).

The Server owns its listener and subscriptions; Engine owns lifecycle and
execution tracking. Check owns its generic pool and each physical worker.
The trusted composition owns artifact-source IO and explicitly supplies
`closeResources`. Server invokes that callback on rollback and shutdown,
after Engine execution reclamation and before releasing the Store lease.
Injected Stores remain caller-owned by default; `ownStore` transfers close
responsibility. SQLite created by Server is always owned.

Shutdown closes admission/listeners and active streams, then reclaims Engine
resources, composition resources, Store lease and owned Store. Failure/time
budget exhaustion rejects rather than claiming success; unconfirmed cleanup
retains the Store lease. CLI reports failure and exits nonzero, never `closed`.
This includes startup rollback failures: the CLI explicitly terminates rather
than claiming clean shutdown. Configuration modules are never executed.
Programmatic callers must handle failure and may not reuse unconfirmed resources.
No global signal hooks are installed by the library.

SQLite preserves IDs, original contract bindings and deadlines. Unstarted work
resumes; started work without reliable final evidence becomes
`execution_interrupted`, not a retry. Same-process worker threads die with their
process; artifacts must not launch detached/unmanaged external services.
Physical termination is not proof that external side effects did not occur.

## Check and artifacts

`@potential-guide/check-artifacts/contracts` exports the existing validators,
not another schema truth: manifest parsing, full file-set/Git-tree digest and
References validation, runtime checks, mapping, subject and result validation.
It imports no preparation or filesystem/worker modules. All inputs are supplied
bytes/objects; functions do not download, write disk or start workers.

These legacy contract/file APIs remain for existing CLI consumers; they do not
provide an Engine Check registration or generic business execution layer.
`check-task` and its `createArtifactSource` / `createCheckTaskType` APIs have
been removed. New checks use `check-sdk` and the normal Task Bundle authoring
flow, as demonstrated by `check-environment`. The Engine receives Bundle CIDs
and business inputs, not old Checker source/digest/subject envelopes.

## Local file source boundaries

The removed Check task adapter no longer exposes `allowedFileRoots`,
download/cache policy or Checker file-URL execution. The generic Server has no
filesystem read/upload route, and a browser selection grants no backend file
access. Bundle callbacks remain trusted application code, not a security sandbox.

The separate `check-runtime-files` library still exports `readConfinedFile` for
existing consumers. It reads bounded regular files beneath explicitly allowed
native directory roots and rejects links, root escapes and concurrent replacement.
Windows uses native no-reparse handles without write/delete sharing and owned
compiler scratch; POSIX pins directory-relative descriptors with no-follow
flags. Unsupported native facilities fail closed. These private/confined-file
guards are not removed or weakened by task-adapter retirement and do not imply
an active Checker source adapter or HTTP route.

## Installation versus imports

We retain authoring APIs and production `esbuild` in `check-artifacts` for backward
compatibility. `/contracts` eliminates preparation/build **imports**, not their
installed dependencies: `esbuild`, platform optional binaries, `tar`, and
`check-runtime-files` still appear in a production install. There is no separate
author-build package in this MVP. A split would change the existing `/build`
consumer contract or leave a compatibility dependency and would not deliver
installation isolation without migration. Packed-consumer evidence records the
actual installed graph rather than claiming a subpath makes dependencies vanish.
Engine's generic Bundle loader uses `task-protocol`, not the Check `/files`
primitives. Check support packages and the author-only `task-sdk` are not
Server production dependencies.

## Check and Probe retirement

Both `@potential-guide/check-task` and `@potential-guide/probe-task`, their author
callbacks and their integration examples have been removed. There is no
compatibility registration, replacement Probe command or automatic migration of
Objective observation/state. New standalone checks use
`check-sdk` and the normal Task Bundle authoring flow, as demonstrated by
`check-environment`. The generic Engine, child Task APIs and business-free
Server remain supported and are not deprecated.
