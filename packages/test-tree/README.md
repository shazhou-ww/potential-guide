# YAML state tests and operation manuals

Private workspace tooling; not an npm release. One YAML supplies the state tree,
checks and manual prose. A single relative `.ts` binding supplies implementation.
Titles may change; ASCII letter/alphanumeric IDs are the stable binding contract.
The retired Host scenarios and their generated manuals have been removed; the
generic runner and renderer remain available.

From the repository root:

```powershell
pnpm build
pnpm --filter @potential-guide/test-tree test
pnpm --filter @potential-guide/test-tree manual <your-state-tree.yaml> tree
pnpm --filter @potential-guide/test-tree manual <your-state-tree.yaml> markdown
pnpm --filter @potential-guide/test-tree manual <your-state-tree.yaml> html
```

An optional final filename writes a **new** file (existing files are refused).
Binding paths resolve relative to YAML, not the current directory. Output paths
resolve relative to the CLI working directory. Errors exit nonzero, without a fallback.

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
Run TS bindings through `tsx --test`. The adapter loads that binding and validates
all expected exports before registering any path or creating a context. It then
registers one native Node test per check. Each test receives a new context and
replays root to target transitions, not ancestor probes.

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
fixtures or test code. It validates documentation structure only, not export
existence or passing tests. All outputs say **Not run**. Human outputs show the
state tree, not the test execution tree. Each state explains how to reach it,
what to observe, possible next states, and how to end the operation safely.
Parent operations are linked rather than repeated per probe.
Markdown command fences remain intact.

Offline HTML has a native collapsible tree, stable `state-<id>` and
`<stateId>.<checkId>` observation anchors and selectable command text. It has no
JavaScript, network assets or active Markdown links; all source text is HTML-escaped
and a restrictive CSP is included. Rendering cannot execute commands.
Internal hook and binding names are not used as human-facing headings.

Platform instructions appear in separate native collapsibles labelled
**Linux / macOS shell** and **Windows PowerShell**, inside each state's enter,
observation and resource-release areas. They are static HTML, not JavaScript tabs.
