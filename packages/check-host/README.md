# @potential-guide/check-host

## Host v2: observation Tasks

The same authenticated loopback Host now assembles an Artifact Manager, a
Task Scheduler and the execution Kernel. Ordinary v2 callers never supply a
server directory/revision or install/build Check dependencies:

```ts
const client = await connectHost();
const task = await client.check({
  check: { url: "https://github.com/owner/repo/releases/download/v1/check.tgz" },
  subject: { root: "D:\\project" },
  timeoutMs: 30_000,
});
const observation = await task.result();
// observation.result is business data: completed does not mean business passed.
// observation.artifact.digest/revision and executionId identify the actual content/run.
```

`check.url` is required. Optional `check.digest` pins the logical artifact;
without it **each new Task** confirms its source. Fixed cache hits reverify all
bytes, including after a Host restart; floating requests never fall back to an
old URL mapping. A digest establishes content identity, not publisher authentication.
Sources require normal TLS and an explicit HTTPS-origin policy. Defaults allow
`github.com`, `release-assets.githubusercontent.com` and
`objects.githubusercontent.com`. Host owners may replace this list with
comma-separated `PGUIDE_CHECK_SOURCE_ORIGINS` at startup. Every redirect is
reauthorized (maximum four); embedded credentials, fragments and protocol
downgrades are rejected. No credentials/cookies are forwarded.

| Method | v2 route |
| --- | --- |
| POST | `/v2/check-tasks` |
| GET | `/v2/check-tasks/{taskId}` |
| POST | `/v2/check-tasks/{taskId}/cancel` |
| GET | `/v2/events?taskId=a&taskId=b` (SSE) |
| GET | `/v2/events?scope=all` (authenticated owner's Tasks) |
| POST | `/v2/artifacts/resolve` with `{url}` |
| GET | `/v2/artifacts/{digest}` |
| GET | `/v2/artifacts/{digest}/references/{referenceId}` |

Reference IDs include `check`, `problems/<problemId>`, and exact declared
Reference paths. Results/provenance expose no cache paths, URL query or
userinfo; source evidence is origin-only. After restarting, metadata recovered
solely from verified content reports `retained-cache`, not invented source history.
There is no per-Task event route. Filters are deduplicated and validated as a
whole; missing/expired records are 404, forbidden scopes 403. Empty filters are
400 unless explicitly `scope=all`. Every subscription/reconnection starts with
current snapshots, including terminal states. Revision markers permit deduplication.
An open subscription reports `unavailable.code=task_expired` without changing the
last terminal snapshot. Slow consumers are disconnected rather than queued without bound.

`task.snapshot()`, `task.events({signal})`, `task.cancel()` and
`client.watchTasks([taskA, taskB], {signal})` observe the same independent Task.
Each Client multiplexes its watchers over one filtered SSE stream.
`task.result()` returns the completed snapshot and accurate evidence, even for
business failure; invocation/cleanup failures, timeout and cancellation reject.
Reading, disconnecting, cancelling a subscription or `client.close()` does not
cancel remote Tasks. Only `task.cancel()` withdraws that Task's demand.

Default freshness is `started-after-request`; `completed-after-request` explicitly
accepts a compatible run already in progress. Compatibility includes logical
digest, canonical subject/context, authenticated scope and execution policy.
Task IDs never merge. Strong requests queued before start may share a run;
late strong requests cannot join it. Weak requests can use retained completion
records even when version resolution finishes later.

`timeoutMs` covers acceptance through delivery (default 30s, maximum 120s).
Execution wall-clock is independently bounded (default 30s); cleanup/initialization
each have a 5s bound. One Task ending does not stop other waiters. Last-demand
cancellation seals the run, cooperatively aborts, and force-retires only its
exclusive worker if necessary, with confirmed subprocess cleanup.

States: `accepted/preparing/waiting/running/completed/failed/cancelled`.
Errors use `{error:{code,stage,message}}`, with sanitized diagnostics.
Admission/filters use 400, token failure 401, source/scope denial 403, unavailable
records 404, idempotency conflict 409, capacity 429, and unavailable Host/cache 503.
Source preparation failures use 502. Task timeout is `failed/task_timeout`;
execution wall-clock is `failed/execution_timeout`.

`Idempotency-Key` is evaluated before floating resolution; same key/request
returns the original Task/version/acceptance, changed content conflicts.
SDK creates/reuses that key for its one bounded admission retry.
Task and Execution records are capped at 256 each and retained 60s after terminal;
there is no cross-restart exactly-once or transparent replay promise.
Other defaults: 64 artifacts, 4 source preparations (30s each), 64 streams,
64 filtered Tasks per stream. SDK subscriber queues hold at most 64 frames.

### Compatibility and consumer migration

v1 remains a **short-term explicit dual stack**, documented below: existing
npm/Git builtin worker adapters use directory/revision and `/checks`.
HTTPS Check references inside fixed Objective artifacts now obtain metadata,
raw References and executions from Host v2; Pilot/regulator retain inline digests,
owning-artifact evidence and exact recovery. Local-directory Objective author
flows remain explicit v1 compatibility. Historical schemas/evidence are unchanged.
Full builtin migration, v1 removal and formal releases belong to the subsequent
release work, not this implementation. Restart an owned old Host when upgrading;
a v1-only daemon is not silently treated as a v2 service.

## Executable state paths and manual

The private [`test-tree` workspace](../test-tree/README.md) runs representative
real HTTP/worker paths from one [YAML state tree](../test-tree/test/check-host/host.states.yaml):
ready, running, delayed cancellation cleanup, cancelled, expected failure and
recovery. Each check creates its own isolated Host and replays its own path.
This supplements, rather than replaces, discovery/CLI-race and kernel coverage.
The same YAML generates a [Markdown manual](../../docs/check-host-manual.md) and
[offline HTML](../../docs/check-host-manual.html); documentation rendering never
imports test bindings or starts a Host. The manuals contain executable
PowerShell steps and owned-resource cleanup instructions, not proof of test success.

The [ordinary cancellable sample artifact](examples/README.md) can be copied
directly; preparation does not require writing a worker or launcher script.
The current manual uses `connectHost` with an explicit isolated Host subdirectory
and the original discovery daemon. Windows process termination is documented as
forced, after task cleanup and idle observation, not as graceful daemon shutdown.

Discovery requires a dedicated private directory. Windows uses protected NTFS
ACLs, not POSIX `mode` values; existing insecure directories or metadata are refused
without changing their permissions. Choose a fresh private location rather than
reusing a descriptor that may have exposed its bearer token.

One user-local Node Host, one bounded scheduler, one `SubscriptionRef<CheckState>`
per execution. `CheckKernel.executeCheck({directory, revision, subject, checkId})`
is the IO boundary. Reading/subscribing does not execute code. The kernel does not
import HTTP or understand Objectives. `Completed.result` is the worker's business
result; a not-passed result is not an invocation failure.

## Legacy v1 local API

`connectHost()` locates/starts the package's `pguide-check-host` assembly in the
user-private `~/.potential-guide/check-host` directory. Multiple CLI processes
share it. `PGUIDE_CHECK_HOST_DIRECTORY` provides an explicit isolated instance.
Only authenticated loopback HTTP is supported:

| Operation | Route |
| --- | --- |
| Start | `POST /checks` with `{checkId,directory,revision,subject,context?}` |
| Cancel | `POST /checks/{checkId}/cancel` |
| Observe one | `GET /checks/{checkId}` |
| Observe active collection | `GET /checks` |

On Windows, directory/file creation supplies the security descriptor atomically:
the owner is the current SID; only that SID, SYSTEM (`S-1-5-18`) and Administrators
(`S-1-5-32-544`) receive access. Native handle-based ACL/owner, reparse-point,
hard-link and local-volume checks run before secret IO. Startup records, the store
mutex, descriptors and leftover JSON publications must also be private. No token
is first written with inherited broad permissions and repaired afterward.
POSIX uses actual owner UID, no-follow regular files and private `0700`/`0600`
permissions, not an assumption about umask.

Windows discovery requires Windows PowerShell and its .NET/native security APIs.
The assembly uses the trusted absolute system executable/module paths, no profile
or module autoloading, and fixed code with JSON data over anonymous pipes (`shell:
false`). It does not interpolate paths or tokens into commands. A private compiler
directory is established and verified before in-memory native-helper compilation,
then removed; system temporary directories are not used for those files. One
reusable permission helper belongs to each caller process. Normal shutdown, client
pipe closure and process-exit cleanup stop only that owned helper. Backend/permission
failures are explicit; there is no insecure fallback. This extra Windows process
is not included in the kernel-only RSS measurements below.

Publication uses private temporary files and atomic replacement. Windows mutation
uses a private OS-exclusively-held store mutex and expected-content transitions;
startup reservations cannot overwrite a changed reservation, and shutdown removes
only its own descriptor version. An already live descriptor is not replaced by a
second startup. Failed replacement leaves the prior descriptor intact.
POSIX creation, compare/replace and compare/remove share a process-death-safe
OS mutex using Node's built-in SQLite `BEGIN EXCLUSIVE` on the private, empty
`private-store.lock`. No tables, database writes, task persistence or additional
dependency/helper process are introduced. The lock inode is never reclaimed or
deleted during operation; process death releases the OS lock. Validation uses
`lstat` for that reserved inode: opening and closing another descriptor in the
same process would release POSIX record locks. SQLite is experimental in the
supported Node versions and may emit Node's standard experimental warning.
Lock acquisition is bounded and failures have no unlocked fallback.
Privacy scans retry metadata that disappears during atomic publication; surviving
insecure owner/mode/link metadata still fails closed. Windows scan handles exclude
deletion during validation; POSIX also retries an already unlinked old inode.

After spawn, discovery conditionally transfers the startup reservation to the
actual child PID. A child that dies before running its assembly no longer leaves
a live launcher incorrectly owning its stale startup record. The assembly accepts
the same reservation already transferred to itself. Unknown/partial startup
ownership still times out rather than authorizing deletion of an unknown record.
After acquiring a reservation, discovery rechecks the live descriptor before
spawning, closing the publication/removal race between concurrent callers.
The Host starts in its private directory, never in a caller's transient cwd.

All requests need the descriptor's bearer token. `context` is opaque per-execution
JSON supplied by the adapter, not a Host dependency protocol. GET returns JSON,
or current snapshot plus changes with `Accept: application/x-ndjson`.
Collection summaries exclude subjects, progress and results. Disconnecting a
reader never cancels a task. Cancel requests wait for cleanup before terminal
state; forced termination is `Failed`, not proof of successful cancellation.
Streams are bounded, expire after 60 seconds and disconnect slow observers.
Single-check streams finish after their terminal snapshot. A frame larger than the
socket high-water mark may drain; subsequent snapshots cannot accumulate behind
it. Closing or finishing a stream releases its observer slot.

The caller generates its ID before start. Duplicate ID/content returns the same
execution; changed content conflicts. Lost start responses are recovered by
observing that ID, never by blindly rerunning. IDs/terminal results are retained
for 60 seconds, capped at 256 records; protection is in-memory during retention,
not durable exactly-once delivery. Expired observations return 404.

## Workers and artifacts

For author-triggered bundling/packing and digest-pinned local/HTTPS delivery of
standalone Checks, use [`check-artifacts`](../check-artifacts/README.md). Its
legacy preparation layer passes only the verified execution directory and Host revision
to v1. In v2 the service assembly owns manifests/References/downloads; the Kernel
still consumes only verified execution content.

Each canonical directory contains self-contained `worker.cjs` and optional
resources (no node_modules, links, special/hardlinked files; 256 files/64 MiB).
`readArtifact()` computes SHA-256 over ordered relative names, lengths and all
bytes, including an execution flag for executable resources. The Host independently verifies and copies those bytes into a private
execution snapshot. Do not use an entry-only hash or a new scratch path per task.
Changing a busy directory's revision conflicts; switching waits for old workers
to exit. The module exports `initialize?`, `execute(subject, context)` and
`dispose?`. `context.signal`, `deadline`, `data`, `progress`, and `defer(cleanup)`
are request-owned. Never retain subjects/results or leave timers/handles behind.
There is no Host installation step or parent node_modules dependency resolution.
Workers are trusted local code, **not a sandbox**.
The runner compiles the already-verified CommonJS bytes, avoiding a second cold
filesystem module load. Snapshot files stay read-only; executable resources keep
owner-only execute permission. Relative JSON data can be required inside the
snapshot, but code dependencies must be bundled; VM dynamic imports cannot fall
back to a parent node_modules.
Caller loader/debug flags and `NODE_OPTIONS` are not forwarded to worker threads.
Request-owned `spawn`, `exec`, `execFile` (including its promisified form), and
`fork` children are tracked; unfinished children prevent a successful terminal state.
Synchronous process APIs are refused because they cannot confirm request cancellation.
Node entries may read Wasm resources or invoke other-language programs through the
owned asynchronous subprocess APIs; missing interpreters/binaries are explicit failures.
Forced cleanup signals both the owned POSIX process group and its root (including
non-detached children), then waits for OS exit acknowledgement within the cleanup
budget before reporting a terminal failure. Signal delivery alone is not cleanup.

Defaults: four total threads (including startup/retirement/prewarm), 64 queued
tasks, 64 artifact directories, 30-second execution deadline, five-second cleanup
grace, 100 tasks per thread. At task 99 a same-version replacement may prewarm
only with spare global capacity. These conservative limits bound CPU/memory and
leave room for the CLI; they are configurable in the reusable kernel.
One task occupies a worker; cleanup failure isolates and retires it. Business
tools remain permitted only within their original consent/permission boundary;
their processes are tracked and cleanup failures are explicit.

Run `pnpm --filter @potential-guide/check-host test` after building. Builtin
artifacts are generated by `pnpm workers:build`, verified by `pnpm workers:check`.
Artifact identity uses full-width integer inode/timestamp values. Windows Node
22 path stats report an unavailable volume ID as zero; a missing value is not
mistaken for a changed volume. Nonzero volume IDs, inode identity, size, hard-link
count, content hash and before/after mutation checks remain enforced.

## Validation and measurement

Tests create unique project-cache directories and close their own kernel/server.
The real dual-CLI test records only Host PIDs it launches in its private discovery
directory, authenticates readiness, and stops those exact PIDs. It never uses the
default user Host. A partially written startup lock is retried, not deleted as
proof of a dead owner.

`test/workload.test.ts` compares the same module and JSON input in fresh Node
processes and reusable workers. It reports cold and hot elapsed times, actual
initialization counts, per-process RSS, and a 96-execution success/failure/cancel
load with a two-worker/eight-task retirement configuration. A second workload uses
the real generated package-standard checker against one owned, fixed repository
fixture and reports twelve-process versus twelve-Host totals. No target package
build/check script executes. These are kernel timings, not end-to-end CLI timings;
first snapshot publication can make the real checker's cold run slower.
An additional 512-execution mixed workload crosses 32 retention windows, checks
record eviction and post-close release, and samples RSS/heap without imposing an
unjustified leak threshold. Native ACL tests independently inspect real Windows
security descriptors, reject ordinary-group grants, race independent publishers,
and verify failed replacement and permission-backend teardown.
Host RSS includes the test runtime and worker threads, whereas baseline RSS is one
isolated child process. Short samples and noisy concurrent CI results are not proof
of reduced absolute memory or indefinite leak freedom.

`node scripts/measure-check-host.mjs` runs an opt-in Windows measurement with the
unmodified real package-standard Objective (structure and deliveries), a fixed
owned repository/Subject, and real `probe` CLI/Git/discovery/HTTP. It separately
reports seven fresh-process structure-check samples, one shared cold CLI, three
fresh-service CLIs, and six shared hot CLIs. The checker-only process numbers
are not an end-to-end old-CLI baseline. Full-service RSS/private bytes include
the owned Node Host, all its worker threads and its real permission helper, not
the short-lived CLI or measurement collector. RSS is a sum of working sets, not
PSS; shared pages may be counted twice. Collection happens outside timed CLI
calls, after task completion, and does not measure a transient RSS peak.
The 2x observed-cold RSS guard is a short-run growth check, not a product memory
SLA or proof of indefinite leak freedom. Only journaled owned PIDs and newly
created directories are stopped/deleted.

Real-process discovery tests kill a child before its assembly, after reservation
claim but before listen/publication, and after authenticated readiness with an
in-flight task. Four concurrent callers must launch one replacement; old task
IDs remain unknown after restart, with no transparent replay. Native SQLite
mutex tests use independent real processes and forced owner death. Running these
on Windows proves Windows locking only; POSIX owner/mode and POSIX mutex recovery
still require an actual POSIX run, not platform mocks.
