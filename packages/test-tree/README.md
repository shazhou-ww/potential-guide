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
existence or passing tests. All outputs say **Not run**. Terminal output shows
the tree; Markdown/HTML expand each selected check's complete path, its probe,
and reverse cleanup. Markdown command fences remain intact.

Offline HTML has a native collapsible tree, stable `state-<id>` and
`<stateId>.<checkId>` anchors and selectable command text. It has no JavaScript,
network assets or active Markdown links; all source text is HTML-escaped and a
restrictive CSP is included. Rendering cannot execute commands. In HTML,
Markdown is deliberately shown literally rather than interpreted as trusted HTML.

See the [Check Host YAML](test/check-host/host.states.yaml),
[Markdown manual](../../docs/check-host-manual.md) and
[offline HTML](../../docs/check-host-manual.html). Each manual path starts from a
new owned scenario directory. Instructions include real PowerShell commands,
authenticated readiness, explicit execution/cleanup barriers and a fault/recovery
branch. The helper is an explicit manual operator, not another state-tree
definition or a docs dependency. Tokens never appear in output. The real Host
has a two-minute execution deadline and a 30-second cleanup deadline; perform
interactive steps promptly or recreate the scenario after a timeout.
