# Objective Pilot

## Host v2 artifact probes

`createArtifactCheckProbe({check:{url,digest}, client?, timeoutMs?, evidence?})`
uses the Host's independent observation Tasks with default
`started-after-request` freshness. The Host, not the Pilot caller, prepares the
Check and validates its manifest. Evidence records `check.host-observation` with
taskId, executionId, actual digest/revision and observation times. Business
envelopes retain the existing result contract; invocation/timeout/cancellation
reject rather than pretending the business failed. Signal cancellation withdraws
that Task only. `createWorkerCheckProbe` remains the explicit v1 compatibility
adapter for existing directory/revision sources. HTTPS Objective artifacts use
v2; fixed Objective digests never become implicit latest.

Pilot definitions, schema compilation, strict parsing, reference validation and
subject projection now have an independently installable canonical home:
[`@potential-guide/pilot-protocol`](../pilot-protocol/README.md). This execution
package reexports its former definition APIs for compatibility; observation,
probes and execution evidence remain here. Consumers needing definitions only
should install the protocol package, not this business package or CLI.
See [three-layer boundaries](../../docs/package-layering.md).

`@potential-guide/objective-pilot` observes an Objective. It never calls an Agent.
It replaces the retired Objective Guide API, not a compatibility wrapper.

## Specifications and observations

`PilotSpec` is JSON data: a stable `objectiveId`, an immutable source `version`,
a strictly validated manifest and localized Wiki pages. Subjects and executable
bindings are separate. `Manifest.prerequisite` and `PilotSpec.prerequisite` are
removed and rejected; manifests require the canonical Objective v2 `$schema`:

```ts
import { startEffect } from "@potential-guide/effects";
import { loadPilotSpec, observe } from "@potential-guide/objective-pilot";

// versionFor returns the directory tree; sourceFor separately records its retrieval commit.
const spec = await loadPilotSpec(
  "git+https://example.org/team/objectives.git#quality/",
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
64-character content tree OID. `fileResources` and `loadPilotSpec` also support static,
uncommitted files for validation; those specifications cannot be observed. A Git
adapter belongs at composition, not in this package. `ResourceResolver` supplies
`version`, `readText(uri)`, and `readPages(uri)`; page resources are `{ uri, source }`.
Resource reads must be immutable for the resolver's lifetime.
Resolvers spanning repositories implement `versionFor(objectiveId)` to return
each Objective directory's immutable tree OID. `sourceFor` supplies `{kind:"git-tree",
repository,directory,commit,tree,repositoryTree}`: commit retrieves the snapshot,
tree versions the Pilot, and repositoryTree independently covers materialized
repository support files outside its folder. None hashes the execution environment.
GitSnapshot.treeOid verifies a directory on the exact commit; a tree must never
be passed as a commit. Static/custom memory resolvers do not claim Git evidence.
没有 `spec.source` / Git `sources[id]` 的自定义解析器只提供不透明内容版本，不证明 Git
tree；不得将其作为生产 Git 依赖、跨进程恢复或 continue 的版本证据。fileResources 的
working-tree 版本仅用于静态验证。Git-bound 观察中的每个依赖都必须携带完整 tagged 来源证据。

Levels are ordered by the manifest array, never by their ID spelling. Protocol
`initial` has no business requirements; manifests declare at least one business
level, excluding reserved `initial` and `terminal`. Checks are conditions to
attain their level. First failure reports `initial`; later failure reports the
previous attained level, while problem references identify the unattained level.
All pass reports the real last business ID. `terminal` is only its target alias.
Checks at a level are all evaluated and aggregated; levels are evaluated serially.
A dependency is discovered by a check at the
actual level where it is needed, not by a static chain.
Checks default to serial execution; `PilotRuntime.checkConcurrency` opts into a
positive concurrency bound without changing result order or aggregation.

### Observation-local reuse and input views

Source versions identify rules, **not mutable targets**. Reuse is disabled unless
the host supplies `PilotRuntime.observationRevision(input, signal)`, a revision of
**every observable input** for explicitly read-only checks. Undefined disables
reuse. The revision is checked before each request and after execution; only
complete, non-fault observations enter the enclosing observation's cache.
Subject, effective language, full specification/source, observation mode and
runtime identity are separate keys. Expected levels compare the same complete
observation; `initial` is never a substitute. Low attained levels can be reused,
but exceptions, timeout and cancellation cannot. Each hit still validates caller
evidence and consumes recursion/depth/logical-observation limits.
No cache survives a root observation, repair/reprobe, or Regulation round.
In-flight calls are deliberately not merged.

The CLI recognizes a committed, strict `observation-inputs.json` beside the
manifest, for example:

```json
{"contract":"bounded-readonly-filesystem-v1","subjectRoot":["root"]}
```

This is an explicit **source-author contract**, not automatic detection of check
purity: every check in that Objective must read only the bounded filesystem view,
and must not use live filesystem contents, network, clock or other external inputs
to decide its result. Arbitrary checks remain isolated processes and get no reuse.
The host captures directory/type facts and readable file contents, verifies a
second byte traversal, and provides one immutable view per real root for the
entire observation. It captures no secret values, follows no links, limits files
to 1 MiB, entries to 40000 and total readable bytes to 128 MiB; `.git`,
`node_modules`, `.cache`, `.turbo`, `.next`, `.wrangler`, and `coverage` are outside
the contract. Build outputs are included. Unstable/unreadable/oversized captures
fall back to ordinary live checks without reuse. Excluded-path rejection applies
to the view contract only; live consumers keep their previous explicit-read
behavior, while inventories continue excluding these directories.
This is not an atomic OS snapshot;
the two traversals detect capture-time changes, while the accepted view fixes all
subsequent check inputs. Changes after capture become visible on the next root
observation, not halfway through the current view.

`captureFilesystemObservation` and `filesystemObservationRevision` implement the
bounded collector; the latter can support live-input custom hosts but is not a
purity guarantee. `observationResource` owns host-only resources and release
callbacks for one complete observation. Process `inputView: {path, sha256}` is
runtime-owned metadata (`PGUIDE_INPUT_VIEW`, `PGUIDE_INPUT_VIEW_SHA256`), never
subject data or check-supplied facts. Consumers must verify the digest and root,
and enforce the same path/link/secret/size boundaries. The host revalidates view
integrity before reuse and removes owned files after success, fault or cancel.
`PGUIDE_TIMINGS=1` logs source preparation, input capture and whole-observation
duration plus executed/reused/logical counts on stderr; these diagnostics do not
change stdout envelopes.

Captured `text` retains the bounded reader's existing UTF-8 behavior. UTF-16
BOM files additionally carry original base64 `encodedBytes`, allowing a bound
consumer such as TypeScript to preserve its BOM decoding without live reads.

Both filesystem helpers accept an optional third `onUnavailable` callback with
`{reason, code?}`. Expected reasons are `input-changed`, `inventory-limit`,
`byte-limit`, and `unreadable`; only recognized filesystem failures and explicit
capture guards can return undefined. Cancellation and unexpected/programming
errors propagate instead. Without a callback, `PGUIDE_TIMINGS=1` reports the
reason. The CLI supplies a callback which emits `input-view.unavailable` evidence
and, when enabled, a timing event with Objective identity, `status: "unavailable"`,
reason and filesystem code. Successful capture timing uses `status: "captured"`.
Explicitly disabling both evidence and timings suppresses these diagnostic
channels; fallback does not become a successful cached observation.

An observation contains `current: { objectiveId, levelId }`, fully scoped
`problems` with either `{ kind: "internal", ref: { objectiveId, levelId, checkId,
problemId }, parameters }` or `{ kind: "dependency", objectiveId, subject,
expectedLevelId, currentLevelId }`,
`gapSummary`, `observedAt`, a map of Objective tree versions, and `sources` with
separate retrieval/support evidence for Git-bound observations. It has no
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

Committed v3 checks are self-contained `worker.cjs` modules with explicit resources
inside the same artifact directory. `createWorkerCheckProbe({ directory, revision,
timeoutMs })` submits the subject to the authenticated shared Check Host and observes
that execution's current state. `revision` covers every artifact file, not just the
entrypoint. The worker exports `execute(subject, context)` and returns the envelope;
it does not read stdin or write a result to stdout. Worker cwd is not the source
checkout: resolve packaged resources relative to `__dirname`, never from cwd or an
assumed number of parent directories.

Host observation disconnect does not cancel execution. AbortSignal cancellation
sends an explicit cancellation request and waits for the execution's terminal
state and cleanup acknowledgement. A failed cleanup is an invocation failure.
The default adapter timeout is 30000 ms; this is distinct from the whole observation
budget. See [Check Host](../check-host/README.md) for capacities and retention.
Legacy process entrypoints and bare-subject HTTP are not Git-loader fallbacks;
the old bare-subject HTTP factory rejects use explicitly. Standalone business
CLI helpers remain separate from the committed worker execution protocol.
Preparing another immutable source binding does not publish over the active
binding's artifact. Publication occurs immediately before invocation; conflicting
concurrent directory revisions are still explicit failures, not blind retries.

## Objective level checks and dependency probes

Directory declarations are shared domain data rather than CLI-private bindings:
`parseObjectives(yaml)` validates the strict version-1 declaration document;
`projectObjective(entry, context, input)` validates explicit input and evaluates the
direct JSONata subject; `bindObjective(entry, context, input, spec)` additionally
validates the subject against the selected Pilot domain. Only Unit input may be
omitted. Declarations contain description, directory pilot, inputSchema and
subject, never a target or revision. Hosts provide repository/checkout/directory
context and source resolution; these pure APIs do not depend on CLI configuration
or inspect Git. The CLI reuses them, as does the monorepo dependency consumer.

`checkObjectiveLevel({ spec, subject, expectedLevelId, language? }, runtime)`
constructs an Effect returning `Envelope<{ passed, observation }>`. It observes
once and compares cumulative ranks, resolving `terminal` to the owning Objective's
highest business level. An `initial` target validates inputs without business probes.
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

An unresolved business dependency is returned in the check result:

```js
exports.execute = async (subject) => ({
  status: 200,
  payload: {
    ok: false,
    problems: [],
    requirements: [{
      objectiveId: "git+https://example.org/team/objectives.git#environment/",
      subject: { environment: subject.environment },
      expectedLevelId: "ready",
    }],
  },
  message: "",
});
```

The worker returns immediately, releasing its thread before the parent binds and
observes the dependency through `PilotRuntime.resolveObjective`. The business layer
validates actual source-bound observations and rechecks the original check with
the corresponding resolutions. Bundled checks using
`createSourceObjectiveDependencyProbe` consume these through
`withDependencyResolutions(context.data.resolutions, use)`.
The Host transports opaque context and results: no dependency callbacks, IPC
requests or recursive Objective scheduler are part of its protocol. Requirements
are not evidence of attainment; fabricated dependency payloads remain invalid.

One observation scope freezes source identities, records successful and blocked
dependencies in `versions`, and shares deadline, recursion stack and total budget.
The stack key is Objective ID plus canonical subject. Defaults are 30 seconds,
32 nested observations and 128 total observations; override with
`PilotRuntime.observationBudget: { timeoutMs, maxDepth, maxObservations }`.
Dependency observations remain in that same scope. Cancellation propagates to source
preparation and external probes; completion waits for owned process cleanup.
Evidence report persistence remains independent and can be disabled without
disabling dependency correctness.

## Local evidence

Worker and memory probes retain caller-owned local evidence by default. Pass a shared
`RunEvidence({ directory })` as `evidence` to group invocations and retries, or
`evidence: false` to disable persistence. Set `identity` to a stable check
reference so `attempt` increments across retries; every call still receives a
new `checkRunId`. Without a shared run, each adapter call owns a separate run.
Do not store subject data in `identity`.

```ts
import { readArtifact } from "@potential-guide/check-host";
import { RunEvidence, createWorkerCheckProbe } from "@potential-guide/objective-pilot";

const evidence = new RunEvidence({ directory: "/safe/local/reports" });
const artifact = await readArtifact("/committed/check");
const probe = createWorkerCheckProbe({
  directory: artifact.directory,
  revision: artifact.revision,
  evidence,
  identity: { objectiveId, levelId, checkId },
});
const envelope = await probe(subject, signal);
// After all invocations and cleanup, the run owner records its termination.
evidence.stream.emit("run.finished", { outcome: "completed" });
```

Worker results are recorded by the calling probe in the owning run's
`check.finished` event and bounded/redacted `result.json`. A worker is not promised
a per-check business event file or inherited process evidence context.
Separately, standalone process helpers use runtime-owned `PGUIDE_EVIDENCE_CONTEXT` with the absolute
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
