# Ordinary Check Host business artifacts

`cancellable/worker.cjs` is an inspectable, self-contained sample artifact, not a
test fixture, helper, command dispatcher or service launcher. Copy its directory
to your own artifact location and calculate the revision with `readArtifact`.

The worker's ordinary JSON subject supports:

- `marker`: echoed in the result and execution progress.
- `hold: true` and an absolute `controls` directory: wait for cancellation; cleanup
  writes `cleaning`, waits for a `release` file, then writes `cleaned`.
- `fail: true`: throw an invocation error, not a business "not passed" result.

The returned `calls` counter belongs to one initialized worker module. The sample
has no CLI, performs no HTTP requests and does not import any testing framework.
It only accesses the explicitly supplied control directory. Use an owned private
scene, release cleanup promptly and never use this sample against a default Host.

The daemon's default execution deadline is 30 seconds and cleanup deadline is
5 seconds; prepare the observation/release commands before entering these states.
See the repository's [state manual](../../../docs/check-host-manual.md) for native
shell and PowerShell requests using the real isolated discovery daemon.
