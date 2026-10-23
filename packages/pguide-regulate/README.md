# @potential-guide/pguide-regulate

Optional `pguide-regulate` and `pguide-continue` commands. These cooperate through
persisted regulation state and Agent sessions, so ship together. Standalone
binaries do not require `pguide`; install alongside it to discover `regulate`
and `continue`. Agent execution and process-worker helpers are public tool APIs
used by supervision without a reverse dependency.

Stopping a regulation process first requests cooperative abort, allowing it to
explicitly cancel shared Host checks and acknowledge cleanup. The process runner
waits up to ten seconds for this acknowledgement before terminating its owned
process tree. Missing acknowledgement is a cleanup failure, not proof that shared
work stopped; merely disconnecting an observation does not cancel it.

Use `--help` for options, [command reference](../pguide/README.md) for execution,
permissions and persistence, and [migration](../../docs/package-layering.md) for
installation. Existing output envelopes and exit codes are preserved.

Default output and `--format markdown` report the run ID, Objective, target and
latest observed level, stop reason (including exhaustion cause), iterations,
stalled-run history, per-attempt quota, persisted state path and continue command.
`--report` also identifies the written JSON report. Continue with the same
user/project `config.jsonc` and `--cwd` context; each explicit continuation grants another bounded
attempt rather than resetting retained stall history. Reaching a nonterminal
target is not the same as completing the Objective.

Human summaries omit full subjects and Agent transcripts. JSON envelopes, state
files, report contents and exit codes are unchanged. Observation invocation
failures keep the existing `regulation-error` JSON category and exit code;
human errors additionally identify the Objective, target, underlying check
failure and recovery location.
Typed input guidance survives nested error wrapping. Unsupported locales list
the supported languages; start a new regulation with a supported language,
because continuation retains its originally selected language. These human
details do not change the outer JSON error message, category or exit code.
