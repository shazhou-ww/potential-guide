# YAML state tests and operation manuals

Private workspace tooling; not an npm release. One YAML supplies the state tree,
checks and manual prose. A single relative `.ts` binding supplies implementation.
Titles may change; ASCII letter/alphanumeric IDs are the stable binding contract.

From the repository root:

```powershell
pnpm build
pnpm --filter @potential-guide/test-tree test
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml tree
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml markdown
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml html
```

An optional final filename writes a **new** file (existing files are refused).
Binding paths resolve relative to YAML, not the current directory. Output paths
resolve relative to the CLI working directory. Errors exit nonzero, without a
fallback. To regenerate the committed examples, explicitly delete only
`docs\check-host-manual.md` and `docs\check-host-manual.html`, then:

```powershell
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml markdown ..\..\docs\check-host-manual.md
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml html ..\..\docs\check-host-manual.html
```

## Data contract

```yaml
namespace: example
binding: ./example.binding.ts
state:
  id: ready
  title: Fixture ready
  before: Explain executable setup commands, readiness and partial failure handling.
  after: Explain cleanup of only this transition's resources.
  checks:
    - id: idle
      title: Idle
      doc: Explain the read-only probe, observation location and expected result.
  # Optional: platforms: [win32, linux]
  # Optional: states: [nested states with the same fields]
```

No `use`, expressions, embedded executable declarations or implicit name
conversion. All unknown fields, duplicate YAML keys, duplicate state IDs,
duplicate per-state check IDs, missing text and YAML aliases are rejected.
Unsupported YAML tags/warnings are errors rather than silently coerced values.
`before`, `after` and each check's `doc` accept either text or a complete
`{ posix: "...", powershell: "..." }` object. Both platform texts must be nonempty;
unknown keys and incomplete platform objects fail validation. This changes only
human instructions, not automatic test applicability (`platforms`) or bindings.
`checks` and `states` may be omitted; at least one check must exist in the tree.
`platforms` lists Node platform names and restricts all descendant paths.
Docs retain these nodes and explain the skip; the Node adapter skips them.

```ts
// example.binding.ts — module imports must not start fixtures or services.
export function transition_ready(context: { value?: string }) {
  context.value = "ready";
  return () => { delete context.value; };
}
export function check_ready_idle(context: { value?: string }) {
  if (context.value !== "ready") throw new Error("not ready");
}
```

A test entry loads YAML and calls the Node adapter from `src/runner.ts`
(or its compiled `dist/runner.js`):

```ts
import { pathToFileURL } from "node:url";
await registerTests(loaded, () => new Context(), (file) => import(pathToFileURL(file).href));
```

The explicit module loader belongs to the test entry, keeping computed test
imports outside the repository's statically checked production boundary. It is
passed only the single absolute binding filename resolved from YAML, not a
second mapping or registry. There is no default loader or missing-export fallback.
Run TS bindings through `tsx --test`. The adapter loads that binding and validates **all**
expected exports before registering any path or creating a context. It then
registers one native Node test per check. Each test receives a new context and
replays root → target transitions, not ancestor probes. No dependency scheduler
or second hand-written BDD tree is maintained.

Every transition must return its own `After` function; no cleanup means an
explicit `() => {}`. The runner registers the returned function immediately,
then executes the probe, then all afters in reverse order. A transition that
throws before returning owns cleanup of its partially acquired resources.
Acquire helpers must honor the same rule. Cleanup does not roll business state
back. Single errors retain their identity; multiple errors become an
`AggregateError` with the original error first, followed by reverse-order cleanup
errors. Other independent Node tests still run.

## Manuals and safety

`src/cli.ts` imports only YAML loading and rendering, never `runner.ts`, bindings,
fixtures or test code. It validates documentation structure only, **not** export
existence or passing tests. All outputs say **Not run**. Human outputs show the state tree, not the
test execution tree. Each state explains how to reach it, what to observe,
possible next states, and how to end the operation safely. Parent operations
are linked rather than repeated per probe. Markdown command fences remain intact.

Offline HTML has a native collapsible tree, stable `state-<id>` and
`<stateId>.<checkId>` observation anchors and selectable command text. It has no JavaScript,
network assets or active Markdown links; all source text is HTML-escaped and a
restrictive CSP is included. Rendering cannot execute commands. In HTML, fenced code is formatted; all content is escaped, not interpreted as
trusted HTML. Internal hook and binding names are not used as human-facing headings.

Platform instructions appear in separate native collapsibles labelled
**Linux / macOS shell** and **Windows PowerShell**, inside each state's enter,
observation and resource-release areas. They are static HTML, not JavaScript tabs.
The seven human state articles and stable IDs are unchanged.

See the [Check Host YAML](test/check-host/host.states.yaml),
[Markdown manual](../../docs/check-host-manual.md) and
[offline HTML](../../docs/check-host-manual.html). Each manual branch starts from a new owned scenario directory. The instructions
use native Bash/curl/jq or PowerShell/Invoke-RestMethod from the repository root.
They do not invoke Test Tree, a test binding, `tsx`, a REPL, or a task-command helper.
Preparation uses native tools only: `mktemp` on Linux/macOS, and
`New-Item` plus `icacls` on Windows. It never evaluates JavaScript or starts Node.
Four explained steps create a private directory, protect it before storing any
credentials, copy the inspectable ordinary
[business artifact](../check-host/examples/README.md). No worker source, host.mjs,
dispatcher or bootstrap script is generated.
Instructions prioritize a purpose, one readable operation, and its expected result,
not the fewest possible lines. Run the separate blocks in the same shell session.
In the ready state, an explained `connectHost(<scene>/host)` SDK call starts the
**original discovery daemon**, including its real startup reservation; the launcher
closes its own private backend. A separate `readArtifact` call calculates the
sample revision. Requests use the actual private `host/host.json` descriptor.
There is no invented start/run/cancel CLI or custom `CheckKernel`/`serve` substitute.
The unavoidable SDK calls are displayed as named, multi-line operations, not
minified JavaScript one-liners. They remain a limitation of the current service
entrypoints, not a requirement for preparing a directory.

Linux/macOS instructions require Bash 3.2+, curl 7.55+, jq 1.6+, Node 22.13+
and pnpm 11.22+, on a filesystem that actually preserves POSIX ownership and
0700/0600 permissions. WSL's default Windows-drive mounts may be rejected with
`EPRIVATE`; do not weaken privacy checks or claim a native flow passed there.
No GNU-only filesystem options are assumed. Windows requires
PowerShell 5.1+ and the same Node/pnpm versions, but not curl or jq. Native
platform command tests run where prerequisites exist and otherwise explicitly skip;
Git Bash is not native Linux/macOS verification. Tokens are neither printed nor
passed as curl arguments; curl reads a header file inside the private directory.
The actual daemon defaults apply: 30 seconds for execution, 5 seconds for cleanup
and 60 seconds of history retention. Read and prepare the observation/release
commands before cancellation; a deadline failure is not successful cancellation.
Before stopping, all tasks must be terminal and the active list empty.
POSIX SIGTERM follows the daemon's graceful handler and removes host.json.
Windows `Stop-Process` is **forced termination**, not evidence of graceful disposal:
the manual waits on handles captured for the exact owned PID and its recorded
helpers, checks their exit, and only then deletes its own scene. It does not kill
helper processes by name or pretend a stale descriptor proves a live service.
