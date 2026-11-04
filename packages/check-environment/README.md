# Environment check bundles

Three reusable checks share a library and build into **three independent Task
Bundles**: `tools`, `directories`, and `network`. No Objective levels, repair
agents, package installation or long-running sampling are built into them.

```powershell
pnpm --filter @potential-guide/check-environment... build
```

The package contains `dist/bundles/<kind>/task.yaml`, the self-contained
`worker.cjs`. `dist/bundles/references.json` records each relative directory and its
standard UnixFS root CID. No archive or parallel Bundle digest is produced.
Build output is ignored by Git.

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

Each list is bounded to 100 items. `messageSchema` is `false`; the checks do not
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

Per-item verbose diagnostics do not belong in Result. The current Task SDK has
structured `progress` messages, but no dedicated Run-scoped stderr/log stream.
These bundles do not repurpose progress or checkpoint as verbose output.
Console stderr is not a task-history logging channel. A dedicated channel needs
its own bounded delivery, retention and consumer contract.

Changing the business result contract changes the Bundle CID. Rebuild and
use the new reference from `references.json`; existing CID-addressed content
retain their original contracts.

After building, import the emitted CAR using an external tool of your choice and submit its root CID. The Engine
is assumed to be started and authorized; normal task observation is unchanged:

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

Production delivery imports/pins the directory on the caller-managed node and
publishes root CID references, optionally with gateway hints. Do not use
`latest` as executable identity. npm delivers the author/library package;
the generic Engine does not install it. This change adds local delivery
verification only, not publication workflows or release authorization.

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
