# @potential-guide/pilot-protocol

Objective Manifests use `objective.yaml`, `subjectSchema`, flat `levels[].checks`
and the canonical `$schema` URI. Declarations use `objective`; omitted
`inputSchema` is Unit. Context is exactly `{repo, path}` and the bounded
projection profile includes only the additional `$pathJoin(root, path)` function.
See [document contracts and explicit migration](../../docs/objective-contracts.md).
The active offline JSON schemas are exported at `./schemas/objective/v3.json` and
`./schemas/objectives/v1.json`, with strict validators at `./schemas`.
Historical v1/v2 schema bytes remain immutable. V3 check execution uses
self-contained worker artifacts; the legacy document migration command does not
bundle entrypoints or provide an old process-protocol fallback.
The package also supplies the non-overwriting `objective-contract-migrate` command.

## Migration CLI

`--format manifest|declarations|portfolio` selects the legacy document kind.
It does **not** select the display or artifact encoding. Input is JSON or YAML;
the new output artifact is JSON when its filename ends in `.json`, otherwise YAML.
The input is never modified, existing outputs are refused, and pinned source
evidence is never rewritten or invented.

```sh
objective-contract-migrate --format manifest --input legacy.json --output objective.yaml --attainment-levels ready
objective-contract-migrate --format declarations --input legacy.yaml --output objectives.json --output-format json
objective-contract-migrate --help --output-format json
```

The default (or `--output-format markdown`) prints a human success receipt with
document kind, input, saved path and artifact encoding. `--output-format json`
instead prints one result object on stdout: success includes `schemaVersion: 1`,
`status: "migrated"`, `format`, absolute `input`/`output`, `artifactFormat`,
`inputUnchanged: true` and `overwritten: false`. Failure includes
`schemaVersion: 1`, `status: "error"` and `error.message`, exits 1, and leaves
stderr empty. Default failures retain their existing stderr and exit-1 contract.
These receipts are separate from the migrated document's schema.

Help includes additive option, default, constraint and example metadata.
`--help --format json` remains a **legacy help-only** alias for JSON help;
`--format json` is not valid for migration. Prefer `--help --output-format json`.
Projection migrations may require `--context-kind git|non-git` or explicitly
reviewed subject expressions via `--subjects-file <name-to-expression.json>`;
no binding is guessed.

Manifest v3 preserves v2's cumulative attainment checks. `initial` is intrinsic and
`terminal` is a reserved target alias for the real highest business level.
Neither can be declared. Old manifests are rejected; migration requires reviewed
`--attainment-levels`. Old Portfolio targets require explicit review and a new
v4 input; pinned observations/recovery evidence must be reobserved, never rebound.

Canonical Pilot definitions, schema compilation, strict YAML/manifest/reference
parsing and validation, bounded subject projection and resource capability types.
This protocol-only package does not depend on observation, regulation, CLI or
Agent implementations. `effects` remains the separate lifecycle-primitives protocol.

```js
import { parseManifest, compileDomain, validateSubject } from "@potential-guide/pilot-protocol";
const spec = parseManifest(source);
const issues = validateSubject(subject, compileDomain(spec.subjectSchema));
```

`loadPilotSpec(uri, resolver)` assembles and validates a definition from injected
text/page resources without executing checks or fetching Git sources. Exports also
include `parseCheckEnvelope`, `parseDependencyProblem`, URI canonicalization,
`validateReferences`, and contract types. Public subpaths: `types`, `validation`,
`resources`, `projection`. Existing business-package reexports remain compatible.
See [layers and consumption](../../docs/package-layering.md).

`ObjectiveInputError` is an additive public subclass of
`ObjectiveConfigurationError`. It preserves the original message and exposes
typed `details`: subject failures include `objectiveId` and `issues`; language
failures include `objectiveId`, `requested` and `supported`. CLI consumers can
provide human field guidance without parsing messages or changing machine error
payloads.

Objective declaration definitions also live here: `parseObjectives` validates
`objectives.yaml`, `projectObjective` checks input and evaluates the bounded
subject projection, and `bindObjective` additionally validates the projected
subject against the Pilot domain. These APIs do not discover files, build Git
context or acquire sources; those environment operations remain tool-side.
