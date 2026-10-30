# Check, Probe and generic Server

The generic Server composes Engine, HTTP adapter and SQLite. It neither understands
artifacts nor grants permissions based on Request fields. The standalone command
belongs to `task-engine-server`, not `task-engine-http`. Importing the programmatic
entry opens no listener and installs no global signal handlers.

## Trusted assembly

Pass `types`, `currentVersions`, `authorize` and `resolveCaller` explicitly.
`resolveCaller` authenticates every HTTP request (including SSE reconnect);
Engine `authorize` checks every operation and every stream pull. Scope is trusted
Caller context, never a business field. Deny by default. Local callers must pass
the same authorization policy. HTTP cannot load config modules or change resource
limits. A trusted CLI config is arbitrary local code and must not be writable by
HTTP clients.

`startTaskServer` defaults to loopback port 3000 and `tasks.sqlite`. `port: 0`
requests an ephemeral port. The returned URL means Store recovery and listening
have succeeded. HTTP request/body/parser/subscription limits and socket/request
timeouts are bounded. Put TLS and rate quotas at the deployment boundary.

The HTTP protocol is unchanged: POST `/tasks` with `Idempotency-Key`, GET
`/tasks/:id`, POST `/tasks/:id/cancel`, GET `/event-history?taskId=...`, GET
`/events?taskId=...` with `Last-Event-ID`. Creation returns 202. Cursor pagination
and SSE use the same durable history; deduplicate events by sequence. Disconnect
does not cancel a Task. Business `ok:false` is a normal completed Check result.

## Resource ownership

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
This includes rejected configuration imports/factories and startup rollback
failures: the CLI explicitly terminates rather than only setting `exitCode`,
which cannot stop a process held open by configuration-owned resources.
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
and again before allocation, including restored work. Full Prepared equality
prevents different content/environment sharing; Engine owns idempotency, sharing,
independent cancellation, late results and unknown execution interruption.

The extracted checked CommonJS worker remains shared with the legacy Host through
a compatibility shim. New Check code never imports the old Host kernel,
TaskService, scheduler or HTTP protocol. Pool resources are reusable only after
physical worker exit and cleanup. Worker initialize/execute/defer/dispose errors,
undeclared problems, invalid results and resource leaks fail explicitly.

## Installation versus imports

We retain authoring APIs and production `esbuild` in `check-artifacts` for backward
compatibility. `/contracts` eliminates preparation/build **imports**, not their
installed dependencies: `esbuild`, platform optional binaries, `tar`, and
`check-runtime-files` still appear in a production install. There is no separate
author-build package in this MVP. A split would change the existing `/build`
consumer contract or leave a compatibility dependency and would not deliver
installation isolation without migration. Packed-consumer evidence records the
actual installed graph rather than claiming a subpath makes dependencies vanish.

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
