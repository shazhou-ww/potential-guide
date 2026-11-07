# Task Run diagnostic logs

Logs are explicitly authored diagnostics, separate from Result, progress,
checkpoint, matching/reuse, and lifecycle facts. They never become a completion
or reclamation proof. Console/stderr are drained and discarded, not captured;
general host environment variables are not passed to Workers. Authors choose
non-sensitive `fields`; arbitrary messages are untrusted text, not HTML.

## Author API and compatibility

Use `@potential-guide/task-sdk` and a declaration with
`https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json`.
The sole canonical [v1 schema](../schemas/artifacts/task/v1.json) and
[Worker protocol](task-bundle-worker.md) include diagnostic messages. This project
has not formally released; its v1 contract evolves in place. The removed task
v2 and future schema URLs are rejected, not aliased to v1. V1 supports logs;
disabled logging and custom hosts without diagnostic support remain explicitly
unavailable. Hosts verify the declaration/root-CID handshake before dispatch.

```ts
import type { RunContext } from "@potential-guide/task-sdk";

export default async function callback(input: { name: string }, context: RunContext) {
  const receipt = await context.log({
    level: "info", // debug | info | warn | error
    message: "Checking package identity.",
    fields: { name: input.name },
  });
  // Infrastructure failure is a receipt, not an automatic business exception.
  // Authors may deliberately choose a business policy based on the receipt.
  return { ok: true };
}
```

### Log level convention

Authors explicitly choose one of `debug < info < warn < error`:

| level | Meaning | Examples |
| --- | --- | --- |
| `debug` | Fine-grained implementation diagnostics, not routine operator milestones. | Selected branches, per-item execution details, non-sensitive counters. |
| `info` | Important facts and summaries of normal execution. | Operation start/end, check summaries, expected business conclusions. |
| `warn` | An actionable risk, abnormal condition or degradation that can continue or has recovered. | Bounded retries, fallback paths, check findings requiring attention. |
| `error` | An unrecovered execution fault prevented the current operation from completing. | Required resource unavailable, failed execution step. |

An expected negative check result is not itself an execution fault: use `info`
for normal conclusions/summaries, or `warn` for actionable findings, not `error`
merely because Result is `{ok:false}`. Recoverable problems use `warn`; log a
final unrecovered operation fault as `error`, without repeating it for every retry.
Routine loop/poll details belong at `debug`, not `info`.

Levels do not throw, change Run state, imply final success/failure or establish
log completeness. An author must still return the declared result or throw to
express a business failure. All levels share the bounded retention policy;
`error` is not guaranteed preferential retention. Use non-sensitive context,
impact and actionable detail in warn/error messages; levels do not replace
business problem IDs or error codes. The normative contract is
[Run log levels](axis/task-engine-contracts/run-logs.md#日志级别约定).

`log(RunLogInput): Promise<RunLogReceipt>` returns:

| state | Meaning |
| --- | --- |
| `stored`, `sequence` | The host confirmed a durable diagnostic write. Retention may later remove it. |
| `dropped`, `reason` | `capacity` or `entry_too_large`; a bounded aggregate dropped count is visible. |
| `unavailable`, `reason` | `disabled`, `storage`, `channel`, `timeout`, or `unsupported`. |

Invalid levels, unknown input keys, non-object fields, undefined/non-finite/
cyclic/non-JSON data, and input above the absolute 1 MiB validation ceiling reject
with `TaskError("invalid_log", ...)`. Valid entries exceeding the much smaller
configured entry budget return `dropped/entry_too_large`.
For SDK Workers these checks run on the Engine after IPC, and errors return through
the diagnostic ACK. Uncloneable values (for example functions) instead reject at
send time with `invalid_payload`, without consuming a diagnostic sequence number.
Validation applies to the received structured-clone representation; getters and
custom prototypes are not preserved as original descriptors across IPC.
Acknowledgment timeout means **unknown write outcome**, not proof of loss.
There is no automatic retry. At most `min(16, maxInFlight)` diagnostic requests
are pending per SDK Worker, separate from the required-output queue and IDs;
each wait ends within 1000 ms. Cancellation settles diagnostic waiters immediately.
Final output and release never wait for an unawaited diagnostic drain.
Capacity rejections accumulate in one saturating counter, not one IPC message
per awaited rejection. Ordinary drop reporting permits **one unacknowledged
cumulative snapshot**, with one 1000-ms acknowledgment timer. Timeout freezes
further ordinary sends while preserving the unknown identity; only its matching
late acknowledgment can reopen reporting. No timeout-driven retries are queued.
At finishing, at most **one additional terminal cumulative snapshot** may be sent
without waiting, even if the ordinary acknowledgment is lost. Thus a stalled
host can retain at most two drop-control frames per Worker, independent from
the 16-entry pending budget and required business output queue. The host applies
only the increase in cumulative count, so terminal/replayed totals do not double
count. A physically lost terminal snapshot leaves the existing unknown-tail
semantics; it cannot block cancellation, Result or reclamation.

V1 includes `log {generation, runId, logId, value}`, independent
`log-ack {generation, runId, logId, value: RunLogReceipt, error?: {code, message}}`, and bounded aggregate
`log-drop {generation, runId, logId, count, final?: true}` and
`log-drop-ack {generation, runId, logId, value: RunLogReceipt, error?: {code, message}}`.
A successful ACK contains a receipt; a rejected ACK additionally contains an
error (with an unavailable/storage receipt).
`count` is the cumulative SDK-capacity rejection count, not a delta.
`logId` increases independently
from business `id`. The host validates Worker generation against persisted
`workerGeneration`, the active Run and its trusted scope, and assigns sequence
and receipt time; author-supplied identity/time/sequence keys are invalid.
Retired generation and foreign Run traffic cannot write into another Run.

## Storage, capacity and completeness

`EngineOptions.logs` / `ServerOptions.logs` accept these finite limits:

| option | default |
| --- | ---: |
| `enabled` | `true` |
| `entryBytes` | 16,384 (maximum wire budget) |
| `runBytes` | 1,048,576 |
| `runEntries` | 2,000 |
| `totalBytes` | 67,108,864 |
| `maxRuns` | 10,000 |
| `retentionMs` | 86,400,000 |
| `pageSize` | 100 (maximum 1,000) |
| `maxSubscriptions` | 128 |

Byte admission charges UTF-8 JSON input plus a conservative 128-byte envelope
allowance. Per-Run overflow retains the admitted prefix and increments a
saturating dropped count; it does not replace Result or fail the Task.
Pages also have a fixed 1 MiB UTF-8 transport budget (including envelope reserve),
so a large configured `pageSize` cannot exceed client frame limits.
Global pressure and age cleanup expire oldest log bodies. Retention is measured
from last diagnostic update and cleanup runs on log writes/reads, not a separate
unbounded sweep queue. Expired metadata is retained within `maxRuns`; after
metadata eviction the API reports `unavailable/metadata_evicted`, never
success-shaped empty history. An active Run whose metadata was evicted cannot
restart its sequence numbering; subsequent writes are unavailable.

SQLite uses additive, independent `run_logs` storage under the existing single
Engine lease and WAL/FULL durability; lifecycle projection version 5 and its
events remain unchanged. Logical body bytes and metadata counts are bounded.
SQLite files/WAL retain their physical high-water allocation; lowering limits is
not a filesystem shrink or secure deletion promise. Custom Stores without log
methods explicitly report unavailable. `MemoryStore` is test-only/non-durable.

Diagnostic write failure records independent missing-status metadata when that
status service still works. Missing status survives restart; the affected Run's
diagnostic channel stays unavailable rather than pretending recovery restored
lost data. If status reads also fail, the API fails with
`log_storage_unavailable`, not an empty successful page.
Diagnostics have no outstanding operations in the business cleanup budget.
Diagnostic SQLite operations fail immediately on lock contention (`busy_timeout=0`)
and restore the independently configured lifecycle timeout afterward. Synchronous
disk I/O is still not a hard real-time disk-latency guarantee.

Availability is `available`, `unsupported`, `disabled`, `truncated`, `expired`,
or `unavailable`. Completeness is independently `open`, `complete`, or `unknown`.
Normal acknowledged callback output plus observed non-forced exit can close the
tail; failure may still have a complete diagnostic tail. Cancellation, forced
exit, recovery, unknown cleanup, missing storage, and expired/unsupported/disabled
data have unknown completeness. Business success does not establish log
completeness. Existing forced-stop policy may retain Engine ownership when
independent resource cleanup is unconfirmed; Logs neither relax nor worsen it.

## Query and real-time client

```ts
const page = await client.getRunLogs(runId, { afterSequence: 0, limit: 50 });
const controller = new AbortController();
for await (const next of client.subscribeRunLogs(
  runId, { afterSequence: page.nextSequence, limit: 50 },
  { signal: controller.signal },
)) {
  // Process next.entries, next.gap and next.state; retain next.nextSequence.
}
controller.abort();
```

Engine methods are synchronous page reads / pull subscriptions; `TaskClient`
provides async HTTP reads and an async-generator SSE subscription.
`GET /runs/:id/logs` and `GET /runs/:id/logs/events` accept `afterSequence`
(non-negative safe integer) and `limit` (1 through configured `pageSize`).
SSE emits `run.logs` pages with numeric `id`, and `error` on failure.
`Last-Event-ID` overrides `afterSequence` for resume. Both require the same
authenticated **Run read permission and scope**, not Task/result/history access.
Unknown Runs are 404, unauthenticated callers 401, denied scopes 403, invalid
cursors 400, capacity 429. Hosts without the new service methods return explicit
503 `unsupported_version`.

Each page contains `runId, entries, limits, state, nextSequence, hasMore, gap`.
Entries contain `runId, sequence, receivedAt, level, message, fields?`.
Start history at 0, then subscribe from the confirmed page cursor; the first
subscription page replays from that cursor, so history/live handoff loses no
retained entries. Deduplicate by Run+sequence. Cursors before retained history or
ahead of host history explicitly report a gap.

SSE is pull-driven (`highWaterMark: 0`), not a push queue: slow clients retain
only a bounded page and resume against persistent history. Expiry/eviction is
reported when they next pull. HTTP polling defaults to 100 ms. Subscription
capacity is independent from lifecycle subscriptions. Closing/aborting the
client releases only observation capacity, never cancels a Task.
Client and UI reject incomplete or over-2-MiB frames. There is no promise of
permanent replay, unlimited buffering, or exactly-once delivery across network
disconnects.

## Web UI

Run detail has an independent **Logs · 诊断日志** panel: identity, levels,
host time, sequence, full message and expandable JSON fields. Separate controls
pause follow, reconnect by confirmed sequence, reread history from the beginning,
and replace the viewport with the next history page.
Live retention is capped at 300 entries / 1 MiB with an explicit local-window
warning. Pausing creates no browser queue. Switching Runs aborts old streams
and rejects late history/stream responses. Unavailable, unsupported, disabled,
expired, truncated, disconnected/error, gap, and unknown-tail states are visible.
The trusted UI proxy preserves bearer isolation and endpoint binding checks.

## Independent local pack/install/run (no npm publish)

This section is repository implementation verification, not the ordinary
consumer setup. For Node.js + working npm on Linux/macOS or Windows with a
pre-delivered Bundle CID/Gateway (no local Kubo), use
[the shared consumer walkthrough and Node verification script](task-consumer.md).

All commands below run from this checkout; create owned directories under
`.cache`, never a system temporary directory. Node 22.13+ / pnpm 11.22+ are
required. Only third-party production dependencies may be downloaded.

```powershell
pnpm exec turbo run build --filter=@potential-guide/task-engine-server --filter=@potential-guide/task-sdk --filter=@potential-guide/task-engine-webui --filter=@potential-guide/pguide-task-engine
$env:PGUIDE_KEEP_PACK_CONSUMERS = "1"
node scripts\check-packages.mjs --task-service
Remove-Item Env:\PGUIDE_KEEP_PACK_CONSUMERS
```

The script packs local tarballs and verifies an independent installed
service/CLI consumer against a business-free Engine/HTTP/SQLite process.
It prints the exact retained `.cache\potential-guide-packs-*` directory for
inspection. Nothing is published. The SDK-only variant
`node scripts\check-packages.mjs --task-sdk` checks Worker logging and acknowledgments
with author dependencies unavailable. The old Check-specific diagnostic consumer
and its `--task-bundles` option are retired; those historical results are not
proof that a current Check adapter exists.

For an operator-controlled long-lived candidate, reuse the retained
production service installation, **not** a script-owned fixture server.
For the token-free loopback service, install the locally packed
`@potential-guide/pguide-task-engine` and UI dependency graph instead and follow
[the declarative service guide](task-server.md#declarative-local-service).
The old `task-engine-server --config operator.mjs` executable is retired;
YAML/JSON cannot carry custom logging limits or authentication callbacks.
Applications requiring those hooks retain the programmatic API. For example,
prepare an ordinary application entry there (not a CLI configuration module):

```js
import { TaskError } from "@potential-guide/task-protocol";
import { createIpfsGatewayClient } from "@potential-guide/task-engine";
import { startTaskServer } from "@potential-guide/task-engine-server";
const service = await startTaskServer({
  host: "127.0.0.1", port: 3000,
  database: "operator-v5.sqlite",
  ipfsClient: createIpfsGatewayClient("http://127.0.0.1:8080"),
  logs: { enabled: true, entryBytes: 16384, runBytes: 1048576,
    runEntries: 2000, totalBytes: 67108864, maxRuns: 10000,
    retentionMs: 86400000, pageSize: 100, maxSubscriptions: 128 },
  authorize: (caller, _operation, scope) => caller.scope === scope,
  resolveCaller(request) {
    if (!process.env.TASK_SERVER_TOKEN ||
        request.headers.get("authorization") !== `Bearer ${process.env.TASK_SERVER_TOKEN}`)
      throw new TaskError("unauthenticated", "Authentication required.");
    return { scope: "operator", subject: "operator" };
  },
});
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  void service.close().then(() => {
    process.removeListener("SIGINT", close);
    process.removeListener("SIGTERM", close);
  }, () => process.exit(1));
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
console.log(service.url);
```

Provide a private token in that process environment and start
`node .\operator.mjs` **from `bundle-runtime`**.
Use a new database domain for a new candidate, not an old-format database.
Do not commit the private module, token, SQLite files or favorites.

The installed Bundle tarball contains `examples\low-level\check-diagnostics`: copy its
`task.yaml`, `callback.ts`, and `build.mjs` into an author directory with the
local SDK/Protocol tarball graph (restore the retained author's `author_modules`
to `node_modules` only for authoring). Run
`node .\build.mjs .\artifacts\diagnostic-check`. It prints the exact
offline `{directory,car,cid}` result. Import/upload and pin that CAR with an
external tool of your choice. Submit the printed root CID
(optionally `{cid,hint}` for host-authorized gateway fallback) with fresh ULID and
`checks: [{name:"identity", expected:"v1", actual:"v1"},
{name:"readiness", expected:"ready", actual:"not-ready"}]`.
The result is `{ok:false, problemCount:1}`; detailed assertions remain Logs.

For the standalone UI, copy the complete built application `dist` (including
`dist\public`) and a `package.json` containing `{"type":"module","private":true}`
into a fresh owned UI directory. No UI `node_modules` is needed. Prepare:

```json
{
  "host": "127.0.0.1",
  "port": 4310,
  "favoritesFile": "favorites.json",
  "endpoints": [{
    "id": "candidate", "label": "Run logs candidate",
    "url": "http://127.0.0.1:3000", "binding": "operator-logs-v1",
    "bearerEnv": "TASK_UI_BACKEND_TOKEN"
  }]
}
```

Set `TASK_UI_BACKEND_TOKEN` privately and run
`node .\dist\src\main.js .\ui.json` from that standalone directory.
Open the printed loopback URL, submit the exact diagnostic Bundle reference,
and inspect its Run's Logs. Change `binding` when reassigning an endpoint.
The independent automated proof copies the built UI and starts it with filesystem
permission limited to the copied directory (no access to workspace dependencies):

```powershell
Set-Location apps\task-engine-webui
pnpm exec tsx --test --test-concurrency=1 test\run-logs-standalone.test.ts
```

This is implementation evidence, not an assertion that a production deployment,
remote auth policy or manual deployment acceptance has been approved.
