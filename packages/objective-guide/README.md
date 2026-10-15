# `@potential-guide/objective-guide`

Defines language-neutral, URI-keyed Objective Guides and binds them to immutable
JSON subjects and one explicit content language. The package owns manifest and
domain validation, prerequisite projection, ordered levels, executable checks,
localized observations, and reference pages. It does not own command reports,
Git workflow policy, regulation, or portfolio supervision.

## Transport layout

Each Guide is a self-contained transport unit:

```text
my-objective-guide/
├── objective-guide.yaml
├── checks/
│   └── repository-ready/
│       └── run.js
└── references/
    ├── system/{overview,404}/{en-US,zh-CN}.md
    ├── levels/<level-id>/{en-US,zh-CN}.md
    ├── checks/<check-id>/{en-US,zh-CN}.md
    ├── problems/<problem-id>/{en-US,zh-CN}.md
    └── pages/<page-id>/{en-US,zh-CN}.md
```

Manifest levels contain check nodes with stable IDs and the stable Problem IDs
that each check is allowed to return:

```yaml
levels:
  - id: configuration-invalid
    advancement:
      checks:
        - id: repository-ready
          problems: [repository-unready]
```

Level, check, and problem IDs form an explicit three-layer forest. Each check
and problem ID belongs to exactly one parent. Every declared level, check, and
problem has exactly one Reference page per manifest language; undeclared pages
in those namespaces are rejected. The existing `system` and `pages` namespace
rules are unchanged.

The file runner discovers exactly one
`run` or `run.*` entry in the matching check directory and exchanges one JSON
request and response over standard I/O. Every complete probe receives a unique
temporary directory shared by its prerequisite chain and checks. Concurrent checks
must use distinct files or otherwise coordinate access to that directory; it is
removed only after all started checks have settled.

Reference identity is `<namespace>/<id>`; language is always the leaf file.
Checks return only their declared stable Problem IDs plus JSON parameters.
Returning a Problem owned by another check is an explicit operation error,
while the selected locale supplies the human-facing problem content.

## Public API

- `createObjectiveLoader` loads and caches Guides by canonical Manifest URI.
- `fileObjectiveCheckRunner` validates and executes convention-based checks.
- `canonicalManifestUri` normalizes Manifest and resource identities.
- `fileObjectiveResources` reads UTF-8 file resources and Markdown References.
- `ObjectiveConfigurationError` reports invalid manifests and resources.
- `ObjectiveOperationError` reports runtime protocol and query failures.
- `SUBJECT_PROJECTION_LIMITS` documents deterministic JSONata profile bounds.

Loader and I/O failures reject. Expected subject, language, and prerequisite
projection failures are typed instance-creation results. A prerequisite may
declare `minimumLevelId`; omitting it retains the terminal-only unlock behavior.

The package is domain logic only. The `pguide` composition package owns CLI
adapters such as `probe`, `scaffold`, and `validate`.

## Levels and check scheduling

A level represents an attained stage. Its `advancement.checks` are independently
eligible at that stage, not an ordered dependency chain. All checks in the stage
must pass before probing the next level; `terminal` means every stage passed.
Business failures (`pass: false`) do not skip peer checks. Problems from all
failed checks in the current stage are returned in manifest order, preserving
each check's problem order regardless of completion timing.

Inject `checkSchedulingPolicy` through `createObjectiveLoader` to control the
maximum number of checks running concurrently within a level:

```ts
const loader = createObjectiveLoader({
  checkSchedulingPolicy: ({ levelId, checkIds }) => {
    const budget = levelId === "resource-intensive" ? 1 : 4;
    return Math.min(budget, Math.max(1, checkIds.length));
  },
});
```

The policy receives a frozen `ObjectiveCheckSchedulingContext` containing the
instance, level ID, and read-only check IDs. It returns a positive safe integer,
synchronously or asynchronously. Host budgets can be captured in its closure;
the policy is runtime configuration, not part of the manifest.

The policy is called once per nonempty, reached level in each probe, including
prerequisite Guides loaded by the same loader. It is not called for blocked or
empty levels. Empty stages advance immediately. The default concurrency is one:
execution is serial, but same-level failures no longer short-circuit peer checks.
Limits apply to one level in one probe, not globally across instances or probes.
Existing `instance.probe()` and regulator calls require no changes.

The core owns execution, result validation, aggregation, and advancement; the
policy cannot skip checks, supply results, or bypass stage barriers. Invalid
policy values and policy exceptions reject with `ObjectiveOperationError`.
Runner or protocol errors stop starting queued checks, wait for active checks
to settle, then reject without producing a partial successful observation.
