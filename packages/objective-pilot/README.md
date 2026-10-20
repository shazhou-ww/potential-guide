# Objective Pilot

`@potential-guide/objective-pilot` observes an Objective. It never calls an Agent.
It replaces the retired Objective Guide API, not a compatibility wrapper.

## Specifications and observations

`PilotSpec` is JSON data: a stable `objectiveId`, an immutable source `version`,
a strictly validated manifest and localized Wiki pages. Subjects and executable
bindings are separate. `Manifest.prerequisite` and `PilotSpec.prerequisite` are
removed and rejected; manifest `schemaVersion` remains `1`:

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
each Objective's own immutable source commit.

Levels are ordered by the manifest array, never by their ID spelling. The final
local ID is `terminal`. Checks at a level are all evaluated and aggregated;
levels are evaluated serially. A dependency is discovered by a check at the
actual level where it is needed, not by a static chain.
Checks default to serial execution; `PilotRuntime.checkConcurrency` opts into a
positive concurrency bound without changing result order or aggregation.

An observation contains `current: { objectiveId, levelId }`, fully scoped
`problems` with either `{ kind: "internal", ref: { objectiveId, levelId, checkId,
problemId }, parameters }` or `{ kind: "dependency", objectiveId, subject,
expectedLevelId, currentLevelId }`,
`gapSummary`, `observedAt`, and a map of Objective commit versions. It has no
top-level business `ok`. An invocation fault has no trusted current level.
`current` always belongs to the observed Objective, including when it is blocked
by dependencies. Dependency problems have no ID, ref, parameters or nested report.

Wiki pages retain strict YAML frontmatter, multilingual coverage, metadata and
`[[page-id]]` link validation, search and 404 fallback. Scoped pages use
`levels/<level>/checks/<check>[/problems/<problem>]/<language>.md`; flat
`checks/<check>` and `problems/<problem>` pages are accepted only where the ID is
unambiguous. Check IDs are unique within a level, Problem IDs within a check.

## Unified probes

`createMemoryCheckProbe`, `createHttpCheckProbe`, and `createProcessCheckProbe`
use the same envelope:

```json
{"status":200,"payload":{"ok":false,"problems":[{"kind":"internal","id":"missing","parameters":{}}]},"message":""}
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

## Objective level checks and dependency probes

`checkObjectiveLevel({ spec, subject, expectedLevelId, language? }, runtime)`
constructs an Effect returning `Envelope<{ passed, observation }>`. It observes
once and compares levels in manifest array order, including explicit `terminal`.
Equal or higher is true. Invalid input, invocation errors and cancellation never
become false. The returned observation is the very same observation, not a second
sample.

`createObjectiveDependencyProbe({ spec, expectedLevelId, language? }, runtime,
{ recordObservation })` returns a `CheckProbe`. It maps true to a passing check
and false to one dependency problem. The callback is mandatory and runs for both
results. In an owning Pilot observation, use the exported
`recordDependencyObservation`; it validates identity and merges exact versions.
Conflicting commits fail explicitly. Memory/HTTP/process payload shape alone is
not proof: dependency output must match source-bound evidence from that invocation.

For committed Node check scripts executed by the existing process adapter:

```js
import { createSourceObjectiveDependencyProbe } from "@potential-guide/objective-pilot";

const dependency = createSourceObjectiveDependencyProbe({
  objectiveId: "git+https://example.org/team/objectives.git#environment/pilot.yaml",
  expectedLevelId: "ready",
});
let input = "";
for await (const chunk of process.stdin) input += chunk;
const subject = JSON.parse(input);
const envelope = await dependency({ environment: subject.environment }, new AbortController().signal);
process.stdout.write(JSON.stringify(envelope));
```

This helper uses the owning process probe's IPC channel, not a CLI subprocess,
boolean stdout or a report file. The parent binds and observes the external
Objective through `PilotRuntime.resolveObjective(objectiveId, version?, signal)`,
then invokes the same library APIs. The core has no Git/CLI dependency; pguide
implements the binding with its existing immutable Git sources and executables.
Standalone use without the owning IPC channel fails explicitly. Non-Node
transports must supply an equivalent trusted in-process observation contribution;
bare dependency declarations are rejected.

Direct process adapters enable IPC for `node`/`node.exe` commands, or explicitly
with `dependencyBinding: true` for a custom Node interpreter. Pguide enables it
for committed `#!/usr/bin/env node` scripts. Other executables retain their
ordinary three-pipe process protocol and do not inherit Node IPC metadata.
The owning adapter supplies a runtime-owned Node preload that resolves only the
bare `@potential-guide/objective-pilot` import to its installed runtime. Committed
snapshot scripts therefore do not need a checkout-local `node_modules` to import
this API. Other imports use normal Node resolution; this does not install target
dependencies or execute package scripts. Caller `NODE_OPTIONS` is not inherited.

One observation scope freezes source identities, records successful and blocked
dependencies in `versions`, and shares deadline, recursion stack and total budget.
The stack key is Objective ID plus canonical subject. Defaults are 30 seconds,
32 nested observations and 128 total observations; override with
`PilotRuntime.observationBudget: { timeoutMs, maxDepth, maxObservations }`.
IPC requests remain in that same scope. Cancellation propagates to source
preparation and external probes; completion waits for owned process cleanup.
Evidence report persistence remains independent and can be disabled without
disabling dependency correctness.

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
