# pguide

The Potential Guide CLI composes Objective Pilot observation, functional
regulation, Git snapshots, and ACP Agent execution.

```sh
pguide scaffold pilot ./objective --check ready --problem not-ready
pguide validate pilot ./objective/pilot.yaml
# Commit the Pilot and its reference pages/checks in a clean Git repository
# with a credential-free HTTPS origin (file origins are supported for tests).
pguide probe --pilot ./objective/pilot.yaml --subject-file ./subject.json
pguide regulate --pilot ./objective/pilot.yaml --subject-file ./subject.json \
  --target terminal --agent fixture --agent-timeout-ms 30000
pguide continue <regulation-id>
```

Production `--pilot` accepts a committed local manifest path or a Git Objective
URI such as `git+https://github.com/owner/repo.git#objective/pilot.yaml`.
Use `--revision <ref|full-commit>` with an explicit Git URI. Local paths also
accept `--revision <full-commit>`, including an older commit than checkout HEAD;
refs require an explicit Git URI. Local paths require a clean repository and
an origin. Their Objective identity remains the origin URI, while content is
read from the exact local commit snapshot, never unchecked working-tree bytes.
Objective identity excludes the commit while each observation's `versions`
records the exact commit. Static `validate pilot` and scaffolding do not require
a Git commit.

Cross-repository prerequisites are supported. Each repository has its own
snapshot, commit, checkout, and check routing, with all resources owned by the
same Scope. External repositories without an explicit pin resolve HEAD when
the current `withPilot` binding is created and remain immutable throughout
that binding. This is not a cross-source transaction. All source failures are
reported as `pilot-error` with exit code 2.

## Checks and localized guidance

Scaffolding generates `pilot.yaml`, localized `references/**/<language>.md`,
and Node checks at `checks/<check-id>/run.js`. Checks receive the **subject
itself** as JSON on stdin, not a wrapper. Stdout is one JSON envelope:

```json
{"status":200,"payload":{"ok":false,"problems":[{"id":"not-ready","parameters":{}}]},"message":""}
```

Business failure exits zero and has `ok:false`; success is
`{"status":200,"payload":{"ok":true,"problems":[]},"message":""}`.
An invocation failure uses `{"status":503,"payload":null,"message":"Probe unavailable"}`
and never establishes a trustworthy level. Diagnostic logs belong on stderr.
Pilot observations preserve every same-level problem with its full
Objective/Level/Check/Problem reference, the localized gap summary, and versions.

Reference pages require `title` and a nonempty `description` of at most 200
Unicode code points. Optional `references` defaults to `[]`. Guidance belongs
in the Markdown body. `--language` selects localized Wiki guidance;
prerequisite subject projections remain manifest-defined.

## Configuration and recovery migration

Configuration now requires:

```yaml
schemaVersion: 2
defaultAgent: fixture
agentExecutionLimits:
  timeoutMs: 30000
regulationStrategy:
  mode: { type: adhoc }
  probe: { timeoutMs: 30000, retry: { maxRetries: 0, delayMs: 0 } }
agents:
  fixture:
    connection: { type: acp, protocolVersion: "1" }
    transport: { type: stdio, command: your-acp-agent }
```

Version 1 configuration and recovery records are **incompatible** and rejected
explicitly. Replace `--guide` with `--pilot`, `scaffold guide`/`validate guide`
with `scaffold pilot`/`validate pilot`, and migrate checks to the envelope
protocol. Remove `limits.maxIterations`, `limits.maxStalledIterations`,
`--max-iterations`, `--max-stalled-iterations`, and whole-loop `--timeout`.
`agentExecutionLimits.timeoutMs` / `--agent-timeout-ms` applies separately to each
Agent execution, including ACP startup. There is no cross-round budget.
Optional `regulationStrategy` also accepts
`mode: { type: periodic, intervalMs: 1000 }`, per-observation probe timeouts and
finite retry counts/delays, and `effectTtlMs` for the effect lifetime.
Defaults are ad hoc mode, a 30000 ms probe timeout, zero retries and no TTL.
Retries apply to retryable probe invocation failures, not business problems;
these are not repair-round budgets. The strategy is persisted and `continue`
restores it rather than silently adopting changed current configuration.
Periodic execution continues re-observing until cancellation or its configured
TTL; TTL interruption is reported as `effect-ttl-reached` with exit code 5,
not as an internal failure.

The Agent receives the subject, target, **complete observation**, and execution
limits. It owns task organization. Completed execution triggers re-observation;
invocation failure does not trigger repair. SIGINT/SIGTERM interrupts regulation.
New recovery records use schema 2, pin the Pilot URI/commit and subject digest,
and persist complete observation envelopes, Agent outcomes, and actual ACP
session IDs before prompting. `continue` starts a fresh feedback loop against
that pinned recipe and resumes the recorded ACP session when repair is needed.
Session IDs in older schema 2 attempts are also recognized. A failed resume
never silently starts a new session. If no real session ID was saved,
`requirements.sessionResume: true` reports an explicit failure; otherwise a
new session is recorded with `resumeMode: new-without-session-id`. Already
satisfied objectives need no Agent session. It does not replay a selected
problem or assume an old observation is current.
Local inputs additionally persist `sourcePath` as environment metadata, never
as Objective identity. Recovery prefers that existing local source while
verifying the exact stored identity and commit. If the checkout cannot supply
the pinned commit, recovery fails explicitly rather than selecting a newer
version. When that path no longer exists, only the exact stored origin commit
is attempted; unpublished commits may therefore be unavailable.
Profiles inherit credentials by environment-variable name only.

Portfolio JSON also uses schema 2: each `objectives` entry contains
`id`, `pilot`, optional `revision`, `subject`, `defensiveThreshold`, and
`defensiveTarget`. `supervise --portfolio-file <json> [--execute]` preserves
defensive-first policy validation and forwards complete observations.

The package provides independent `pguide-probe`, `pguide-regulate`,
`pguide-continue`, `pguide-supervise`, `pguide-scaffold`, and `pguide-validate`
executables. The optional `@potential-guide/config` extension provides
`pguide-config`; `diagnose` and `complete` are built in. Executable discovery
uses `pguide-command-v1` metadata and preserves argument boundaries without
shell interpretation.
