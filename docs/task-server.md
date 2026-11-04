# Check, Probe and generic Server

For the optional Chinese debugging workbench, see
[Task Engine Web UI](task-engine-web-ui.md). It uses public HTTP only.
It can run independently or be started alongside Engine by the service command.

The generic v5 protocol is now Bundle-based. The Check/Probe composition examples
in this guide are still being switched; they are not valid v5 registration
instructions. See [the current generic API](task-engine.md).

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
config.jsonc > defaults**. Every supplied layer is validated before replacement;
even an overridden invalid value fails. Unknown service fields, duplicate keys,
malformed files and missing explicit files fail. No JavaScript config is imported.
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
are optional; present malformed/unreadable files fail. `--no-global-config`
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
`--ipfs-gateway-url`. Even previously valid or overridden old fields fail with
migration guidance. No user files are automatically changed. Disabled user
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
`createIpfsGatewayClient(gatewayUrl)` from `@potential-guide/ipfs-content`); optional
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

Manifest validity does not prove complete artifact validity. Complete files do
not prove current Node runtime availability. `createArtifactSource` is an
explicit download/unpack/cache layer with allowed origins and scope policy,
including every cache hit. `createCheckTaskType` verifies content again and
persists exact base64 file bytes plus actual Node/platform/architecture/adapter/
configuration identity. Restore never silently downloads newer content.
The environment also hashes the installed worker/adapter implementations.
Prepared `workerRevision` is SHA-256 of the exact CommonJS entry bytes, distinct
from the complete artifact Git-tree digest and from legacy capsule revisions.
Neither identifier is renamed or used as a substitute for the other.
An exact supplied digest must match. Source authorization runs before preparation
and again before allocation, including restored work. Synchronous source grants
also run at Task admission and result-event matching; Promise grants are rejected.
Input equality determines sharing within type/version/environment/scope, not
Prepared equality. Pin content in Input when different resolutions must not share.
Engine owns idempotency, sharing,
independent cancellation, late results and unknown execution interruption.

The extracted checked CommonJS worker remains shared with the legacy Host through
a compatibility shim. New Check code never imports the old Host kernel,
TaskService, scheduler or HTTP protocol. Pool resources are reusable only after
physical worker exit and cleanup. Worker initialize/execute/defer/dispose errors,
undeclared problems, invalid results and resource leaks fail explicitly.

## Local file source boundaries

Trusted composition may add `allowedFileRoots?: readonly string[]` to
`createArtifactSource`. Roots are native absolute directory paths, not URL strings;
absent/empty means **no file access**. References must be strict descendants.
Directory spelling in the root grant is case-sensitive, even on Windows, so
cached/restored authorization cannot conflate distinct case-sensitive directories;
drive letters alone are normalized. Construct URLs from the same native root
spelling used by the trusted configuration. Trailing directory separators are not
archive references.
Roots are normalized/copied when constructing the source. Revoke via the current
`authorize` policy or a replacement trusted source configuration, not by mutating
the caller's readonly roots array. References are snapshotted before asynchronous
authorization so the URL/digest authorized is the URL/digest actually acquired.
Use `pathToFileURL` to construct the `checker.url` and optionally pin `digest`.
File authorization does not use the meaningless `file:` URL origin `"null"`.
The existing `allowedOrigins`, redirects and `download` hook remain HTTPS-only.
There is no filesystem read/upload route in the generic Server.
These roots authorize artifact acquisition, not the filesystem behavior of executed
Checker code; Checkers remain trusted code, not a sandboxed upload format.

The explicit prepare path reads only bounded regular single-link archive files
(72 MiB transport maximum), then applies the same unpack/full-file/digest/References/
subject/runtime rules. Final symlinks, ancestor symlinks/junctions/reparse points,
hard links and path replacement are rejected. Source syntax validation is pure;
an existing path is not a syntax or authorization requirement.

On Windows, a per-read native PowerShell/.NET helper reuses the established
private-compilation approach. It pins every ancestor and final handle without
write/delete sharing, refuses all reparse attributes, verifies final native paths,
binds the configured root by volume/file identity (including case-sensitive
Windows directories), bounds the bytes and confirms metadata before/after.
Only fixed/RAM local drives are allowed. Its compiler scratch is an exclusively
owned `.cache/check-archive-*` directory under the host working directory, with
protected compiler ACLs; the working directory must be trusted and writable.
Native path aliases whose final handle path differs from the requested spelling
(apart from case) are rejected rather than silently remapped. The helper is awaited
through physical exit and scratch cleanup; abort terminates its owned process tree.
Missing native facilities fail closed, never fall back to ordinary unchecked open.

On POSIX, component opens are relative to pinned directory descriptors through
`/proc/self/fd` (Linux) or `/dev/fd` on other POSIX hosts, with required
`O_NOFOLLOW`/`O_DIRECTORY`/`O_NONBLOCK`. Descriptor identities, named entries,
link counts and nanosecond file metadata are verified; reads never exceed the
limit even if a writer grows the file. A host without a working descriptor
filesystem fails with `artifact_file_unsupported`. Platform-specific tests and
actual platform skips are recorded in the implementation evidence; Windows tests
are not proof of POSIX behavior.

Typical explicit failures are `artifact_source_denied`, `artifact_file_missing`,
`artifact_file_not_regular`, `artifact_file_too_large`, `artifact_file_denied`,
`artifact_file_busy`, `artifact_file_changed`, `artifact_file_unsupported` and
`artifact_file_unavailable`; invalid archives/digests retain their existing errors.
No error falls back to another source or network transport.

Every new unpinned Task selects current file bytes. Exact cache grants remain
source/scope/digest-bound and reauthorized; immutable Prepared persists complete
verified bytes. Later file replacement/deletion cannot substitute content.
Recovery can execute stored bytes after deletion if current root configuration
and scope policy still permit the reference; this is intentionally a policy check,
not a reread or an existence check. Revoking the grant prevents allocation.

Browser selection is separate composition: validate a bounded upload without
execution, save an opaque regular archive under a dedicated imports directory,
then return its actual endpoint-host file URL/digest. Disable local upload when
targeting an external endpoint; manual file URLs still refer to that endpoint's
host, not the browser. The repository does not implement that session-specific UI.

## Installation versus imports

We retain authoring APIs and production `esbuild` in `check-artifacts` for backward
compatibility. `/contracts` eliminates preparation/build **imports**, not their
installed dependencies: `esbuild`, platform optional binaries, `tar`, and
`check-runtime-files` still appear in a production install. There is no separate
author-build package in this MVP. A split would change the existing `/build`
consumer contract or leave a compatibility dependency and would not deliver
installation isolation without migration. Packed-consumer evidence records the
actual installed graph rather than claiming a subpath makes dependencies vanish.
Engine's generic Bundle loader reuses the `/files` primitives, so these support
packages now also appear transitively in the Server's production graph. The
author-only `task-sdk` is not a Server production dependency.

## Probe composition

`@potential-guide/probe-task` registers Objective observation on the same Engine.
The `probe-config.mjs` example uses trusted `bindService(engine)` to inject a
scoped child caller before recovery/listener startup. Probe automatically declares
an isolated bounded allocation lane, separate from the Check worker pool.
`allocationLimits` is an optional generic trusted override, not an HTTP option.

Probe pins exact root/static Checker bytes and the actual environment during
preparation. Dynamic Objective selection evidence and child identities appear in
the result transcript; validation replays the same interpreter used by the legacy
ObjectiveService. References are composed from exact artifacts. Dependency
requirements only cause observation and rechecking, never Agent/regulation.
Task deadlines retain generic projection semantics; independent execution wall
limits and cancellation reclaim the physical root worker and exclusively owned
children. Shared child owners survive independently.

Examples live under `examples/task-server`; none import repository source files
or legacy Host packages. `probe-integration.mjs` exercises real HTTP/SSE reconnect
and in-process usage against installed production packages. No artifact-query
routes, Regulate type, automatic retries of unknown work, package publication or
full legacy migration are included.
