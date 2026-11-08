# Runnable Probe Objectives

These are authored Objective packages, not test fixtures:

- `monorepo-standard/` checks the local Node toolchain and repository access,
  then runs a bounded, read-only Check over the root `package.json` and
  `pnpm-workspace.yaml`.
- `task-engine-device/` checks Node, a writable Engine data directory, and an
  HTTP content-gateway health endpoint.

Each package has a stable `*.probe.build.yaml`, Probe Worker source, and
References. The monorepo package also owns the independent policy Check source
and its Check build YAML. Their author YAML pins the exact Check Task Bundle
CIDs; update those pins when a Check changes. Probe builds snapshot the complete
Check DAG into a self-contained CAR.

From the repository root, run:

```powershell
pnpm --filter @potential-guide/probe-sdk objectives:local
```

The command builds the accepted Environment Check bundles, builds both Probe
CARs through `prepareProbe` then the ordinary Task Bundle compiler, and submits
each Probe to a local Engine. The Engine uses an in-memory store and a
loopback-only HTTP gateway on an OS-selected port and capacity-one execution lanes; it does not publish or pin
content. Run `objectives:build` and `objectives:run` separately to inspect and
reuse the generated CARs under each package's ignored `dist/` directory.

## Build once, submit to a separately started Engine

The local convenience command is not deployment. First build the CARs with
`pnpm --filter @potential-guide/probe-sdk objectives:build`; it starts no Engine.
New Worker sources contain only business definitions and use Task Context for
Check invocation. Check pins are explicitly updated when the SDK/build changes;
existing immutable CARs are never rewritten.

From the repository root, in separate Windows terminals:

```powershell
node scripts\serve-task-cars.mjs 0 packages\probe-sdk\examples\objectives\monorepo-standard\dist\monorepo-standard.car packages\probe-sdk\examples\objectives\task-engine-device\dist\task-engine-device.car
node apps\pguide-task-engine\dist\main.js --no-global-config --port 0 --database .cache\my-probe-service\tasks.sqlite --ipfs-gateway-url <content-source-URL>
node scripts\submit-probe-objective.mjs <Engine-URL> <Probe-CID> .\business-input.json
```

Create the uniquely named data directory beforehand. The first process exposes
only verified prebuilt CAR blocks and `/health` on loopback; it neither builds nor
publishes/pins. Its ready JSON contains URL, PID and immutable roots. The second
starts a persistent Engine with host-owned same-scope child authorization. The
third submits only the CID and JSON business input; it neither builds a Bundle
nor starts an Engine or content source. Optional HTTP credentials belong in the
caller's `PGUIDE_TASK_AUTHORIZATION`, never the Worker.

Known authorization/validation failures propagate directly. Only identified
retryable transport failures reconcile status using the original request ID;
reconciliation is explicitly logged and never resubmits. Failed reconciliation
retains the original cause and both errors. Observation has a 125-second budget;
deadline cleanup has a separate 5-second budget and reports cancellation or
uncertainty without claiming physical resource release. Importing the script is
inert; its exported runner is covered by `submit-probe-objective.test.mjs`.

Monorepo input contains `toolchain.tools`, `workspace.directories` and
`standardization.repositoryRoot`; device input contains `runtime.tools`,
`storage.directories` and `gateway: {dns: [], http: [{url:
"<content-source-URL>/health", expectedStatus: [200], followRedirects: false}]}`.
Use absolute paths and a real Node executable. Change Engine/content-source ports
and reuse the **same CAR/CID** without rebuilding. Cancellation is not proof of
release: inspect child Task/Run history, `run.reclaimed` and cleanup unknown facts.

The monorepo Check intentionally verifies only the Node/pnpm declarations and
workspace patterns. It reads no more than 1 MiB from either root configuration
file and never invokes the repository's scripts. The device example is a local
Engine/Gateway readiness check, not a production host installation or
persistent-store deployment check.
