# @potential-guide/check-host

Discovery requires a dedicated private directory. Windows uses protected NTFS
ACLs, not POSIX `mode` values; existing insecure directories or metadata are refused
without changing their permissions. Choose a fresh private location rather than
reusing a descriptor that may have exposed its bearer token.

One user-local Node Host, one bounded scheduler, one `SubscriptionRef<CheckState>`
per execution. `CheckKernel.executeCheck({directory, revision, subject, checkId})`
is the IO boundary. Reading/subscribing does not execute code. The kernel does not
import HTTP or understand Objectives. `Completed.result` is the worker's business
result; a not-passed result is not an invocation failure.

## Local API

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

Each canonical directory contains self-contained `worker.cjs` and optional
resources (no node_modules, links, special/hardlinked files; 256 files/64 MiB).
`readArtifact()` computes SHA-256 over ordered relative names, lengths and all
bytes. The Host independently verifies and copies those bytes into a private
execution snapshot. Do not use an entry-only hash or a new scratch path per task.
Changing a busy directory's revision conflicts; switching waits for old workers
to exit. The module exports `initialize?`, `execute(subject, context)` and
`dispose?`. `context.signal`, `deadline`, `data`, `progress`, and `defer(cleanup)`
are request-owned. Never retain subjects/results or leave timers/handles behind.
There is no Host installation step or parent node_modules dependency resolution.
Workers are trusted local code, **not a sandbox**.
The runner loads the verified CommonJS entry with a boundary-checked require.
Caller loader/debug flags and `NODE_OPTIONS` are not forwarded to worker threads.
Request-owned `spawn`, `exec`, `execFile` (including its promisified form), and
`fork` children are tracked; unfinished children prevent a successful terminal state.

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
