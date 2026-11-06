# Environment check bundles

Three reusable checks share a library and build into **three independent Task
Bundles**: `tools`, `directories`, and `network`. No Objective levels, repair
agents, package installation or long-running sampling are built into them.

```powershell
node scripts/build.mjs --filter=@potential-guide/check-environment...
```

The package contains `dist/bundles/<kind>/task.yaml`, the self-contained
`worker.cjs`, and the distributable `dist/bundles/<kind>.car`.
`dist/bundles/references.json` records each relative `directory`, `car` and
standard UnixFS root `cid`. The CAR and directory describe the same file tree
and root CID; there is no parallel Bundle digest. Build output is ignored by Git.

## Standard author pipeline

The three `*.check.build.yaml` files are the only author declarations.
Their problemCodes generate the literal business types, runtime allowed-code
list, result Schema and Reference coverage matrix through
[`check-sdk/authoring`](../check-sdk/README.md).
The first stage snapshots source, generated code definitions and validated
Reference bytes into `dist/staging/<kind>/`, including a generated
`task.build.yaml` with explicit `runTask` entry and exact resource includes.
The second stage uses the ordinary Task Bundle `buildTask` API.
It reads only those fixed business inputs, not the live source or Reference
directories. No Check-specific compiler is added.

Before acceptance the orchestration compares CAR and directory CIDs and exact
resource bytes under the shared UTF-8/LF rules (explicit binary files remain raw).
It writes only the reader's verified snapshots, never reopens source paths to copy.
All three candidates must succeed before `dist/bundles/` and
its final references.json are replaced together; failures retain accepted
artifacts and references. Staging and candidate outputs are not release inputs.

Root `pnpm build` runs an uncached `verify` acceptance task after cached builds;
`pnpm pack` also runs read-only `prepack` verification of accepted outputs.
Turbo caches `dist/candidate` and compilation/staging outputs, **not** `dist/bundles`.
The package's `build` task only produces candidates; the root launcher also runs acceptance.
The acceptance task checks candidate CARs/directories against current normalized
author resources and the exact binary selection, then writes only verified snapshots
to a separate accepting directory and atomically replaces `dist/bundles`.
A bad cache restore cannot overwrite previously accepted files.
Old manifests or CRLF default text are rejected, not silently rebuilt or accepted. Rule sources and author YAML
participate in build inputs; normal cold builds/cache hits remain enabled.
When binary patterns are present, the root build launcher also fingerprints the
raw resource inputs of those checks into a task-specific Turbo environment key.
This prevents Git's text normalization from masking changed binary bytes. The
fingerprint is a cache input only, never a second artifact identity.
For a narrow build with the same acceptance boundary:
`node scripts/build.mjs --filter=@potential-guide/check-environment...`.
The npm publishing workflow uses this same filtered launcher. It inspects Turbo's
selected task graph and runs acceptance only when environment is in that graph;
unrelated package releases do not build environment. The Docker packaging harness
also prepares generated Check types and builds accepted environment Bundles before packing.
The real Git/Turbo regression is `node --test scripts/environment-cache.test.mjs`;
it uses an isolated repository-local fixture, never the shared worktree cache.

Each Bundle contains `schemas/`, `resources/check.json`, and only its own
`resources/references/en/check.md` plus `problems/<code>.md`. Read them through
`ipfs://<CID>/resources/references/en/check.md` or the resource index. Reference
frontmatter accepts only title and description (nonempty, description <=200
Unicode code points). Filename/language/problem coverage and normalized bytes are
gated; Markdown bodies, sections and links are deliberately not validated.
Language completeness is declared per Check, with no automatic fallback.

## Migration and entry points

The three Task Bundles are the execution entry points. The retired Check Host
is not restored, and no old Host command, registration or compatibility forwarding
is provided. Import/pin the emitted CAR and submit its root CID to the Engine;
do not submit an npm package name or an old Checker digest as a Bundle.

The library exports (`checkTools`, `checkDirectories`, `checkNetwork`, version
helpers and the directory write probe) remain shared implementations, not legacy
task entry points. Existing Objective Workers still consume them without child
Task scheduling. Removing them would break those consumers rather than migrate
an old runner. This scope does not migrate `pnpm check`, repository/package
standardization, devbox-health or setup/self-check Objectives.

## Inputs

Tool versions (numeric dot-separated versions, not npm semver ranges):

```json
{
  "tools": [
    {"command": "node", "args": ["--version"], "minimumVersion": "22.13.0"}
  ],
  "checkTimeoutMs": 5000
}
```

Version output uses the same numeric version parser as devbox-health. Commands
run without a shell. On Windows, use a native executable or `node` with the
absolute JavaScript CLI entry in `args`, not `.cmd`/`.bat` shims. Tools remain
external prerequisites; the bundle does not install them. Tool launch, timeout,
output-limit and cleanup faults fail the Run rather than manufacture a gap.

Directories (absolute paths on the **execution machine**):

```json
{
  "directories": [
    {"path": "D:\\Code\\demo", "requirements": ["exists", "read"]},
    {"path": "D:\\TaskScratch", "requirements": ["exists", "write"]}
  ]
}
```

All entries must be existing directories, not final-component symbolic links.
`read` checks read/traversal access; `write` creates an exclusive temporary file,
reads it back and removes it, including on cancellation. No business directory
is created and no permissions are changed. Ownership and canonical-path
requirements remain Objective policy, not generic requirements.

DNS and HTTP:

```json
{
  "dns": ["localhost"],
  "http": [
    {"url": "http://127.0.0.1:8080/health", "expectedStatus": [200], "followRedirects": false}
  ],
  "checkTimeoutMs": 4000
}
```

At least one DNS or HTTP check is required. Each endpoint has an independent
timeout. HTTP(S) URLs cannot embed credentials. Redirects are rejected unless
explicitly enabled. Responses are not downloaded; their bodies are cancelled.
DNS resolves in a bounded subprocess so cancellation cannot leave a native
lookup running inside the Worker. Timeout/cancellation is an execution fault,
not evidence that an endpoint is unavailable.

`checkTimeoutMs` is the per-command/endpoint business budget (default 5000ms).
The Task Request's separate `timeoutMs` controls task eligibility/lifetime and
is reserved by the Engine; it is not passed to the business callback.

Each list is bounded to 100 items. The message contract is TypeBox `Never`
(equivalent to JSON Schema `false`); the checks do not
accept business messages. Request/Run cancellation still works through the SDK.

## Results and submission

A passing check returns exactly:

```json
{"pass": true}
```

A completed check with unmet requirements returns only actual problems:

```json
{
  "pass": false,
  "problems": [
    {"target": "node", "code": "tool-version", "actual": "20.0.0"}
  ]
}
```

Passing items are omitted. Each problem includes `target`, `code`, and nullable
`actual`. Failure results require a nonempty `problems` array; passing results
have no `problems` field. Neither variant includes `checks` or `ok`. Invocation
faults still fail the Run, not return a check result.

Per-item verbose diagnostics do not belong in Result. The Task SDK supports
separate bounded Run diagnostics through `context.log`; see
[Run logs](../../docs/task-run-logs.md). These checks currently emit no diagnostic
logs and do not repurpose progress or checkpoint as verbose output.
Console stderr is not a task-history logging channel. Log availability never
replaces the declared result, failure or physical release evidence.

Changing the business result contract changes the Bundle CID. Rebuild and
use the new reference from `references.json`; existing CID-addressed content
retain their original contracts.

After building, import and pin the emitted CAR using an external tool of your
choice and submit its root CID. For example, with a caller-managed local Kubo:

```powershell
ipfs dag import --pin-roots=true packages\check-environment\dist\bundles\tools.car
```

The Engine must be started, authorized and able to fetch the pinned CID through
its configured IPFS client. Normal task observation is unchanged:

```js
import {readFile} from "node:fs/promises";
import {join, resolve} from "node:path";

const directory = resolve("packages", "check-environment", "dist", "bundles");
const refs = JSON.parse(await readFile(join(directory, "references.json"), "utf8"));
await engine.submit({
  requestId,
  bundle: refs.tools.cid,
  tools: [{command: process.execPath, args: ["--version"], minimumVersion: "22.13.0"}],
  timeoutMs: 5000
}, caller);
```

Production delivery imports/pins the CAR on the caller-managed node and
publishes root CID references, optionally with gateway hints. Do not use
`latest` as executable identity. npm delivers the author/library package;
the generic Engine does not install it. This change adds local delivery
verification only, not publication workflows or release authorization.

## Regression verification

```powershell
pnpm --filter @potential-guide/check-environment... build
pnpm --filter @potential-guide/check-environment test
```

The Engine regression imports the emitted CARs, verifies equality with their
directory trees and root CIDs, runs passing and unmet-requirement inputs for all
three bundles, and waits for physical release. Tool timeout/output overflow,
invalid directory paths and HTTP timeout must fail the Run without a fabricated
check result. Cancellation of an active HTTP request must stop and release the
Run without a result. Library tests additionally verify process cancellation,
write-probe cleanup, DNS, HTTP redirects and numeric version handling.

## Objective integration

The same write/readback probe is reused by devbox-health and pguide setup
(including self-check). Devbox-health also reuses version parsing/comparison.
Its ownership/canonical-path rules, stage deadlines, command evidence, problem
IDs and actual compiler/runtime smoke tests remain in the Objective.

These existing Objective Workers call shared library code, bundled into their
own artifacts; they do **not** submit child Tasks to an Engine. The independent
bundles use the same implementations and are separately exercised through the
real Engine in tests. Network checks currently have an independent consumer
surface; devbox-health keeps its original network execution/evidence path.

Workers are not security sandboxes. Admit tool commands, filesystem paths and
network targets only from authorized callers in a trusted execution environment.
