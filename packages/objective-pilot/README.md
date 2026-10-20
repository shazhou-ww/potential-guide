# Objective Pilot

`@potential-guide/objective-pilot` observes an Objective. It never calls an Agent.
It replaces the retired Objective Guide API, not a compatibility wrapper.

## Specifications and observations

`PilotSpec` is JSON data: a stable `objectiveId`, an immutable source `version`,
a strictly validated manifest, localized Wiki pages, and an optional prerequisite
specification. Subjects and executable bindings are separate:

```ts
import { startEffect } from "@potential-guide/effects";
import { loadPilotSpec, observe } from "@potential-guide/objective-pilot";

// resolver.version is the exact Git commit; its reads use that same snapshot.
const spec = await loadPilotSpec(
  "git+https://example.org/team/objectives.git#quality/pilot.yaml",
  resolver,
);
const running = startEffect(observe(
  { spec, subject: { repository: "/work/project" }, language: "en-US" },
  { resolveCheck: (ref) => probes.get(JSON.stringify(ref)) },
));
const envelope = await running.await();
// running.cancel() requests cancellation; await() rejects on cancellation.
```

Production observations require a `git+` Objective URI and an exact 40- or
64-character commit hash. `fileResources` and `loadPilotSpec` also support static,
uncommitted files for validation; those specifications cannot be observed. A Git
adapter belongs at composition, not in this package. `ResourceResolver` supplies
`version`, `readText(uri)`, and `readPages(uri)`; page resources are `{ uri, source }`.
Resource reads must be immutable for the resolver's lifetime.
Resolvers spanning repositories implement `versionFor(objectiveId)` to return
each Objective's own immutable source commit. Cross-repository prerequisites
without that capability fail explicitly rather than inheriting the root commit.

Levels are ordered by the manifest array, never by their ID spelling. The final
local ID is `terminal`. Checks at a level are all evaluated and aggregated;
levels and prerequisites are evaluated serially. Prerequisite subjects use the
bounded deterministic JSONata projection profile. The whole prerequisite chain
is validated before any check starts.
Checks default to serial execution; `PilotRuntime.checkConcurrency` opts into a
positive concurrency bound without changing result order or aggregation.

An observation contains `current: { objectiveId, levelId }`, fully scoped
`problems: [{ ref: { objectiveId, levelId, checkId, problemId }, parameters }]`,
`gapSummary`, `observedAt`, and a map of Objective commit versions. It has no
top-level business `ok`. An invocation fault has no trusted current level.

Wiki pages retain strict YAML frontmatter, multilingual coverage, metadata and
`[[page-id]]` link validation, search and 404 fallback. Scoped pages use
`levels/<level>/checks/<check>[/problems/<problem>]/<language>.md`; flat
`checks/<check>` and `problems/<problem>` pages are accepted only where the ID is
unambiguous. Check IDs are unique within a level, Problem IDs within a check.

## Unified probes

`createMemoryCheckProbe`, `createHttpCheckProbe`, and `createProcessCheckProbe`
use the same envelope:

```json
{"status":200,"payload":{"ok":false,"problems":[{"id":"missing","parameters":{}}]},"message":""}
```

Business success is `{"status":200,"payload":{"ok":true,"problems":[]},"message":""}`.
Invocation failure is `{"status":502,"payload":null,"message":"transport: offline"}`.
A malformed envelope, undeclared problem, unsuccessful process exit, or
non-200 HTTP response is an invocation fault, not a business defect.

Process stdin contains **only the subject JSON**. Stdout contains exactly one
envelope; stderr is a log side channel. Business failure exits **0**.
`createProcessCheckProbe({ command, args, cwd, timeoutMs, gracePeriodMs, log })`
owns a project `.cache/pguide-probes` directory exposed through `PGUIDE_PROBE_TEMP_DIR`, its timeout,
and process cleanup. POSIX requires `ps` to snapshot the owned descendant tree (bounded
to 1000 ms), including descendants in detached process groups, before sending
SIGTERM and grace-period SIGKILL. It then verifies that every captured owned PID
has exited, allowing at most 2000 ms for hard-kill exit/reaping acknowledgement;
unobservable or still-live PIDs and invalid snapshots fail cleanup explicitly.
These bounded cleanup phases are separate from the unchanged process deadline.
Windows attempts PID-scoped `taskkill /T`, then `/T /F`; unlike POSIX,
arbitrary Windows console programs have no portable cooperative SIGTERM contract.
The probe waits for process-tree termination and removes its own directory.
Only essential platform environment variables are inherited.
The process timeout defaults to 30000 ms. Each child receives the actual configured
timeout as the canonical decimal `PGUIDE_PROBE_TIMEOUT_MS`; this runtime-owned value
and `PGUIDE_PROBE_TEMP_DIR` override any caller environment values. Checks can use
the metadata to reject an inner workload that leaves insufficient startup/cleanup
headroom. This is a per-process budget, not a whole observation or regulation quota;
the timer starts after spawn, and cancellation may end it earlier.

HTTP uses POST with subject JSON, requires status 200 for successful invocation,
and uses AbortSignal for local cancellation and timeout. Aborting HTTP does
**not** promise that remote business work stops.

## Local evidence

All three probe adapters retain local evidence by default. Pass a shared
`RunEvidence({ directory })` as `evidence` to group invocations and retries, or
`evidence: false` to disable persistence. Set `identity` to a stable check
reference so `attempt` increments across retries; every call still receives a
new `checkRunId`. Without a shared run, each adapter call owns a separate run.
Do not store subject data in `identity`.

```ts
import { RunEvidence, createProcessCheckProbe } from "@potential-guide/objective-pilot";

const evidence = new RunEvidence({ directory: "/safe/local/reports" });
const probe = createProcessCheckProbe({
  command: process.execPath,
  args: ["/committed/check/run.mjs"],
  evidence,
  identity: { objectiveId, levelId, checkId },
});
const envelope = await probe(subject, signal);
// After all invocations and cleanup, the run owner records its termination.
evidence.stream.emit("run.finished", { outcome: "completed" });
```

Process probes pass runtime-owned `PGUIDE_EVIDENCE_CONTEXT` with the absolute
check directory, run/check IDs and attempt. This does not change stdin or
stdout. The parent alone writes the root stream and bounded/redacted
`result.json`; a cooperating child alone writes check business `events.jsonl`.
Disabled parents pass `PGUIDE_EVIDENCE_DISABLED=1`, preventing a standalone child
from creating another run. These are runtime metadata, not subject fields.
Use `PilotRuntime.onObservation` to retain final observations at composition.

Check authors can use `withCheckEvidence("check-id", async evidence => { ... })`.
It uses inherited context or creates a standalone run, records execution
boundaries, and leaves the callback's result unchanged. Call
`evidence?.fact("assertion.result", { actual, expected, passed })` for safe
observations and `evidence?.artifact("proof/summary.txt", safeText)` for opt-in
proof files. Artifacts are exclusive-create, limited to 1 MiB, relative to the
check directory, and reject traversal and symlink parents. Never pass a full
subject, environment, credentials or Agent transcript as a fact or artifact.
`evidence.stream.protect(subject)` registers sensitive-key values for text
redaction without persisting the subject itself.

See [CLI evidence semantics](../pguide/README.md#local-check-and-probe-evidence)
for layout, limits, failures and the distinction between completion and a
business pass. No terminal record means unknown/incomplete, not success.

## Effects and behavior

`observe(input, runtime)` constructs a native Effect; construction does not run
checks. `pilotBehavior(subscriptionRef, runtime)` is a scoped, thin `activate`
adapter. Its sample is initially `initial`; invocation faults remain envelopes
and native computation failures remain `failed` samples. Replacements send Abort
before starting the next effect, do not wait for old cleanup, and isolate late
results. Submit a complete input snapshot when fields require atomic updates;
independently updated refs do not form a transaction.
