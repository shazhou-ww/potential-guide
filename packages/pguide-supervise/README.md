# @potential-guide/pguide-supervise

Optional `pguide-supervise` portfolio command and tool-side Agent planner.
Use the standalone binary, or install alongside `pguide` for discovered
`pguide supervise`. It uses regulation's public worker/Agent API, never a
cross-package source path or a reverse dependency.

Use `pguide-supervise --help`; see [command reference](../pguide/README.md) and
[migration](../../docs/package-layering.md). Existing portfolio behavior,
options, output envelopes and exit codes are preserved.

Default output and `--format markdown` distinguish planning-only mode from
execution. Summaries include goal identity, Objective, target and latest observed
level, remaining demands and requirements, resource capabilities/capacity, failed
goals and non-successful regulation stop reasons. Pending demands explain whether
execution was not requested, matching capabilities are unavailable, or work
remained at the termination boundary. A cycle ending, duration expiring or an
empty queue does not by itself prove all goals have reached their targets.

Full subjects and Agent transcripts are not included. JSON schemaVersion 3 and
existing exit codes remain unchanged. In particular, an observation failure
retains the historical `internal-error` JSON category and exit code 70 for
compatibility; human errors clearly identify the external observation/check
failure, affected goal, Objective and target rather than implying successful
supervision. Changing that machine taxonomy requires a separate compatibility
decision.
