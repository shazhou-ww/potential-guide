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
  quota: { timeoutMs: 300000, maxAgentRuns: 10, maxStallRuns: 3 }
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
Agent execution, including ACP startup. Each regulation is one bounded run.
Optional `regulationStrategy.quota` defaults to a 300000 ms whole-run timeout,
10 Agent runs, and 3 stalled runs. Optional `regulationStrategy.probe` controls
per-observation timeouts and finite retries/delays; its defaults are a 30000 ms
timeout and zero retries. Probe retries apply to retryable invocation failures,
not business problems. Remove legacy `mode` and `effectTtlMs`; ongoing scheduling
belongs to portfolio supervision, not regulation.

Normal outcomes are `target-reached` (exit 0), `exhausted` (exit 5),
`authorization-required` (exit 3), and `prerequisite-unmet` (exit 3).
Typed 4xx/5xx invocation errors are failures,
not normal outcomes. The strategy is persisted and `continue` restores it
rather than silently adopting changed current configuration.

The Agent receives the subject, target, **complete observation**, and execution
limits. It owns task organization. Completed execution triggers re-observation;
invocation failure does not trigger repair. SIGINT/SIGTERM interrupts regulation.
New recovery records use schema 2, pin the Pilot URI/commit and subject digest,
and persist complete observation envelopes, Agent outcomes, and actual ACP
session IDs before prompting. `continue` starts a fresh feedback loop against
that pinned recipe and resumes the recorded ACP session when repair is needed.
Each `continue` is an explicit new run, preserving the pinned recipe and
relevant progress history; it does not restart an exhausted run automatically.
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

## Explicit run permissions

Configuration optionally contains `regulationPermissions`. Omission denies all
ACP permission requests. Administrators define a ceiling of named rules and
explicitly activate a subset in `grants`; neither subjects, model plans, tool
titles nor capability labels grant authority:

```yaml
regulationPermissions:
  ceiling:
    - id: edit-result
      operation: edit
      resources: ['D:\work\project\result.json']
    - id: read-input
      operation: read
      resources: ['D:\work\project\input.json']
    - id: verify
      operation: execute
      command: 'node verify.mjs'
  grants: [edit-result, read-input]
```

Use absolute paths appropriate to your OS. Resources identify **exact files or
directories**, never recursive roots or glob patterns. All requested paths must
match granted paths both lexically and after realpath resolution; creating a
file requires an existing parent. Configure canonical paths rather than symlink
aliases, which are rejected to prevent rebinding between Agent invocations.
A directory rule does not authorize its
children. Every apply-patch Add/Update/Delete target, Move destination and ACP
location is checked. Missing paths, unknown tool kinds, unrecognized raw input,
traversal and changed symlink destinations fail closed. Structured file input is
`{path}` for read or `{path, content?}` for edit; edits also accept an apply_patch
string or `{patch}`. Execute input is only `{command}` and must match the complete
configured command exactly: no shell-prefix, wildcard, or cwd-based allowances.
Unsupported Agent argument shapes require explicit adapter support, not looser rules.
Copilot's `{fileName, diff}` permission input is also supported for single-file
unified Git diffs: the absolute filename, all diff headers and every ACP location
must agree. Creation/deletion null-file headers are recognized; renames,
multi-file diffs, symlink modes, quoted/ambiguous paths and malformed hunks are denied.

Only an offered `allow_once` option is selected. Individual denials do not kill
the prompt: the Agent can try alternatives, and the regulator re-observes.
Verified target/progress beats a denial; otherwise an unresolved request normally
returns `authorization-required` with safe request metadata. Hard quotas still
apply. Events exclude raw commands and model rationale. Permission snapshots and
requests are persisted per attempt. `continue` keeps the pinned recipe and limits
but **reloads the current configuration ceiling and grants**, not stale saved
authority. Edit the complete setting using
`pguide config set regulationPermissions '<JSON or YAML object>' --scope user`;
`pguide config get regulationPermissions` reads it. Project and explicit config
follow normal configuration precedence; protect all config sources as trusted
administrative inputs and do not authorize Agents to edit them.
Execution prompts include only the current effective grants, not the full ceiling,
and tell resumed Agents to seek a fresh host decision rather than treating old
session denials as current policy. Prose about being blocked never grants
authority or substitutes for an actual permission request.

Supervision reloads these administrative settings outside the planner queue.
Permission changes replace execution snapshots and revoke stale runs; denied
requests inform planning but planners cannot approve them.

**This is an ACP authorization boundary, not a sandbox or malicious-Agent
containment.** Exact shell commands can still have broad effects. An Agent can
perform actions without asking ACP, especially when its profile includes
`--allow-all-tools`, `--allow-tool=write`, or equivalent preauthorization flags.
Remove those flags when relying on this mediation. Pilot checks, Agent runtime,
administrative config and allowed commands remain trusted.

## Portfolio supervision

`pguide supervise --portfolio-file portfolio.json --planner strategist` observes
the portfolio and asks the configured ACP planning Agent for a priority queue
once, without executing repairs. Add `--execute` to continuously re-observe each
goal at its configured interval and coordinate one-shot regulation runs until
SIGINT/SIGTERM. `--execute --duration-ms 5000` bounds supervision and waits for
active processes to stop before returning.

Portfolio files require **schema 3**; old schemas and defensive-threshold
portfolios are rejected:

```json
{
  "schemaVersion": 3,
  "goals": [{
    "id": "service",
    "pilot": "git+https://github.com/example/service.git#objective/pilot.yaml",
    "subject": {},
    "targetLevel": "terminal",
    "priority": 1,
    "observationIntervalMs": 30000,
    "requirements": ["typescript"]
  }],
  "resources": [{
    "id": "worker-1",
    "agent": "implementer",
    "capacity": 1,
    "capabilities": ["typescript"]
  }]
}
```

Goals accept an optional pinned `revision`; Pilot sources follow the same
committed-snapshot rules as `probe`. Both `strategist` and `implementer` refer
to profiles in configuration `agents`. `--planner` is required and does not
implicitly register the planner as an execution resource. An empty resource
array is permitted; unavailable capacity leaves work queued.

While executing, the CLI reloads the portfolio, Agent profiles, and source refs
between polling cycles (250–1000 ms plus source-loading time). Goal/subject/spec
changes replace immutable demands; resource changes reach the coordinator
without restarting. An explicit commit remains pinned, while an unpinned Git
URI or ref can advance to a new committed snapshot. Old observation scopes are
released after replacement. Invalid live updates stop supervision rather than
silently retaining stale inputs. Regulation quotas and execution timeout settings
are fixed at command startup.

The planner sees goals, observations, derived prerequisite candidates, previous
demands, and resource-free execution feedback—never the Agent inventory.
It must emit a JSON object through ACP `agent_message_chunk` text updates:
`{"directives":[{"goalId":"service","priority":1}]}`. Optional directive fields
are `targetLevel` (a known level) and `requirements` (capability names).
Unknown or duplicate IDs, arbitrary commands, invalid JSON, refusal,
cancellation, excessive output, and timeout fail closed; there is no fallback
policy. Planning uses `agentExecutionLimits.timeoutMs`, separately from each
execution's timeout and regulation quota.

The coordinator alone binds demands to compatible resources, enforces capacity,
handles P0 preemption, and executes pinned regulations in separate OS processes.
Executing Agents can request capabilities using ACP notification method
`pguide/capability-request` with `{ "capability": "tool-name", "reason": "why" }`.
Requests are associated with the live demand and forwarded to subsequent
planning; they never provision resources or execute model-provided commands.
Completed work is not repeated merely because capacity changes; a fresh
observation can create new demand after regression. JSON output includes the
final queue, observations, and the latest 1000 coordinator events.

The package provides independent `pguide-probe`, `pguide-regulate`,
`pguide-continue`, `pguide-supervise`, `pguide-scaffold`, and `pguide-validate`
executables. The optional `@potential-guide/config` extension provides
`pguide-config`; `diagnose` and `complete` are built in. Executable discovery
uses `pguide-command-v1` metadata and preserves argument boundaries without
shell interpretation.
