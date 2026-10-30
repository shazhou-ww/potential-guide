# @potential-guide/probe-task

`createProbeTaskType` registers `type=probe` with the generic task engine. It
observes an Objective by creating independent `type=check` tasks. It never runs
an Agent or authorizes regulation. No legacy Host is installed.

```ts
const probe = createProbeTaskType({
  source,
  checkEnvironment: check.environment,
  parents: 2,
  children(scope) {
    return {
      service: engine,
      caller: { scope, subject: "trusted-probe" },
      waitForTaskRelease: (id, caller) => engine.waitForTaskRelease(id, caller),
    };
  },
});
// Register [check, probe], currentVersions: {check: "1", probe: "1"}.
// The Server's bindService callback supplies engine before startup.
```

Submit the common request fields plus `objective: {kind:"objective",url,digest?}`,
`subject`, optional `context`, `language`, exact Objective `bindings`, and
`targetLevel:"initial"` (otherwise cumulative observation). `context.resolutions`
is reserved. Child callers are injected trusted authority, never request fields.
Use the same explicit authorization policy for child history and parent history.

Preparation persists the entire exact root/static Checker file sets, language,
and actual Node/adapter/policy/Check environment. Execution starts durably before
effects. Dynamic selections persist exact file sets; results contain the
observation, composed References, and a causal effect transcript linking parent
execution, child tasks/executions, artifacts, and environment. Validation replays
the shared artifact observation iterator against those exact bytes with no IO.
Public selection progress and result evidence include dynamic artifact bytes;
scope authorization applies, including interrupted observation history.
Set the engine's payload budget explicitly (the example uses 16 MiB).

Each Probe has a physical Worker and its own bounded pool. Its trusted
`allocationLimit` reserves a separate generic admission lane, including when
`maxConcurrent=1`; waiting parents cannot fill Check admission. Limits default to
4 parents, depth 8, 64 observations, 128 Checks, 60s execution wall time, and 5s
cleanup confirmation. Engine execution wall time can impose a shorter bound.
Root exit and owned child cleanup precede reuse. Unconfirmed cleanup quarantines
capacity rather than claiming success. No in-process Promise is force-killed.

Cancellation withdraws only tasks created by this parent execution. A shared
Check's other owner survives. `waitForTaskRelease` is an engine-owned physical
ownership barrier: cancellation of a shared owner need not wait for other owners.
Task deadline expiry is **not** execution cancellation: late observations remain
execution history without retroactively completing the timed-out task. Unknown
started observations recover as interrupted, never automatically rerun.

See `examples/task-server/probe-config.mjs` for CLI/in-process composition and
`probe-integration.mjs` for a reproducible packed-consumer HTTP/SSE/recovery proof.
The source implementation currently supports authorized HTTPS archives; the
integration fixture injects a controlled test downloader, not a local-file API.
`pnpm pack:check` installs production tarballs and runs this consumer.
