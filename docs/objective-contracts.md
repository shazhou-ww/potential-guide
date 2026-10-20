# Objective documents and migration

An **Objective Manifest** is the single `objective.yaml` at an Objective directory.
`objectives.yaml` is a different document: named declarations selecting a directory
and projecting an input/context pair to that Objective's subject. Pilot remains
the observation/execution role; package names and `scaffold pilot`, `validate pilot`
and the direct-source `--pilot` CLI option are not renamed.

## Canonical and offline schemas

| Document | Required root `$schema` |
| --- | --- |
| `objective.yaml` | `https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json` |
| `objectives.yaml` | `https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json` |

The repository sources are `schemas/<format>/v1.json`. `pnpm schemas:build`
copies them to `@potential-guide/pilot-protocol/schemas/<format>/v1.json` and
generates embedded definitions; `pnpm schemas:check` checks byte equality and
the embedded representation. Package exports include both JSON files and
`@potential-guide/pilot-protocol/schemas` validators. Runtime validation never
downloads an instance-supplied URI. Unknown URIs and unknown document fields fail.

`.github/workflows/schemas.yml` stages a Pages artifact containing `schemas/`,
preserving the canonical URL path under the project site. Before publication,
the build compares every existing published definition byte-for-byte and refuses
modification or deletion. Any definition change after publication needs a **new
URI**, including compatible changes. A failed/unavailable immutable check blocks
publication. Pages activation, running the workflow, and externally checking
published bytes are deployment work, not evidence supplied by a source build.

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json
subjectSchema:
  type: object
  properties:
    root: {type: string}
  required: [root]
  additionalProperties: false
levels:
  - id: initial
    checks:
      - id: ready
        problems: [not-ready]
defaultLanguage: en-US
languages: [en-US]
```

`subjectSchema` uses the standard `json-schema-typed` Draft 2020-12 TypeScript
type with an explicit `type: object` root. Nested scalars, arrays, combinations,
and document-local `$defs` references retain standard JSON Schema semantics.
Ajv compiles schemas strictly, then validates actual subjects. Only local
`#/$defs/...` references are supported; unsupported keywords, formats, dialects,
and remote references fail rather than being ignored or fetched. The document
schemas validate structure; parsers additionally enforce identifiers, duplicate
level/check IDs, canonical languages, and the default-language membership rule.

## Declaration input and context

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json
objectives:
  check:
    description: Check the selected Git directory.
    objective: git+https://example.test/rules.git#directory/
    subject: '{"root": $pathJoin(context.repo.rootPath, context.path)}'
```

Omitting `inputSchema` means `{const: {}}`, **not** `{}`. Omitted actual input
becomes `{}` only for Unit (a schema restricting the input to the empty object).
Explicit `{}`/`true` schemas accept any finite JSON but require actual input.
Explicit `null` input is preserved: Unit rejects it; a schema permitting null
accepts it. Projection must still produce an object satisfying `subjectSchema`.

The evaluation root is exactly `{context, input}`. Context has exactly:

```ts
{
  repo: { rootPath: string; origin: string | null } | null;
  path: string;
}
```

Within Git, `rootPath` is the absolute real checkout root, `path` is the
repository-relative POSIX path (`"."` at root), and absent origin is `null`.
Non-Git context is `{repo: null, path: <absolute selected directory>}`.
There are no opaque repository/checkout IDs, fallback origin, environment
variables, or injected paths. Git operational failures remain errors, not
successful non-Git fallbacks. Non-Git expressions can use `context.path`;
reading `context.repo.rootPath` when repo is null fails.

`$pathJoin(root, path)` takes **exactly two strings** and performs the host
Node.js `path.join`. This is pure lexical path computation: no existence,
containment, symlink, realpath or filesystem-access guarantee. Windows uses
Windows rules and POSIX uses POSIX rules; `..` is not rejected as a security
policy. The bounded AST evaluator recognizes only this added function, not
general JSONata functions, dynamic evaluation, callbacks or host access.
Existing expression, AST, time and output limits remain in force.

## Explicit migration

Build/install `@potential-guide/pilot-protocol`, then invoke its
`objective-contract-migrate` executable (separate from pguide's extension-discovery
namespace). In this checkout after `pnpm build`:

```powershell
node packages\pilot-protocol\dist\migrate-cli.js --format manifest --input rules\pilot.yaml --output rules\objective.yaml
node packages\pilot-protocol\dist\migrate-cli.js --format declarations --input legacy-objectives.yaml --output migrated-objectives.yaml --context-kind git
node packages\pilot-protocol\dist\migrate-cli.js --format portfolio --input legacy-portfolio.json --output migrated-portfolio.json
```

The command requires a separate, nonexistent output file, never overwrites,
and leaves the input untouched. It rejects unknown fields, unsupported versions,
ambiguous YAML and already-migrated documents. Review the new file and commit
the migrated Objective source before deliberately switching bindings. Old
`pilot.yaml`, numeric-version manifests/declarations, `advancement`, `domainSchema`
and reference fields are never runtime aliases.

Manifest migration preserves check order and schemas while flattening
`levels[].advancement.checks` to `levels[].checks`. Declaration migration
renames `pilot` to `objective`; legacy context paths are converted through the
JSONata AST, not string replacement. `--context-kind git|non-git` makes the
directory interpretation explicit. String literals remain untouched.

Opaque identities, whole-context projections and expressions with no
semantics-preserving conversion fail. For these, supply
`--subjects-file reviewed-subjects.json`, explicitly mapping declaration names
to reviewed replacement expressions, and update the target subject contract
as needed. The monorepo business Objective explicitly adopts the new repo/path
contract instead of inventing replacements for old repository/checkout IDs.

Unpinned Portfolio v3 goals can be renamed without changing other Portfolio
semantics or its version. Pinned Portfolio revisions, recovery records, reports
and queue snapshots cannot be safely rebound just by replacing a string:
their commit, directory tree and repository-tree evidence identifies old bytes.
The migrator refuses unsupported/pinned records instead of guessing a new
source. Commit the converted Objective, start a new explicit observation or
regulation, and retain the original evidence for audit. New recovery records,
declaration snapshots, reports and queues consistently use `objective`,
`objectiveUri`, `objectiveCommit`, `objectiveTree` and `objectiveSource`.
