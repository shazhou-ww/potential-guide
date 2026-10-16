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
and process cleanup. POSIX uses a detached process group, SIGTERM and grace-period
SIGKILL. Windows attempts PID-scoped `taskkill /T`, then `/T /F`; unlike POSIX,
arbitrary Windows console programs have no portable cooperative SIGTERM contract.
The probe waits for process-tree termination and removes its own directory.
Only essential platform environment variables are inherited.

HTTP uses POST with subject JSON, requires status 200 for successful invocation,
and uses AbortSignal for local cancellation and timeout. Aborting HTTP does
**not** promise that remote business work stops.

## Effects and behavior

`observe(input, runtime)` constructs a native Effect; construction does not run
checks. `pilotBehavior(subscriptionRef, runtime)` is a scoped, thin `activate`
adapter. Its sample is initially `initial`; invocation faults remain envelopes
and native computation failures remain `failed` samples. Replacements send Abort
before starting the next effect, do not wait for old cleanup, and isolate late
results. Submit a complete input snapshot when fields require atomic updates;
independently updated refs do not form a transaction.
