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
loopback-only HTTP gateway on `127.0.0.1:51231`; it does not publish or pin
content. Run `objectives:build` and `objectives:run` separately to inspect and
reuse the generated CARs under each package's ignored `dist/` directory.

The monorepo Check intentionally verifies only the Node/pnpm declarations and
workspace patterns. It reads no more than 1 MiB from either root configuration
file and never invokes the repository's scripts. The device example is a local
Engine/Gateway readiness check, not a production host installation or
persistent-store deployment check.
