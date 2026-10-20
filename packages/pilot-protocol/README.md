# @potential-guide/pilot-protocol

Objective Manifests use `objective.yaml`, `subjectSchema`, flat `levels[].checks`
and the canonical `$schema` URI. Declarations use `objective`; omitted
`inputSchema` is Unit. Context is exactly `{repo, path}` and the bounded
projection profile includes only the additional `$pathJoin(root, path)` function.
See [document contracts and explicit migration](../../docs/objective-contracts.md).
Offline JSON schemas are exported at `./schemas/objective/v1.json` and
`./schemas/objectives/v1.json`, with strict validators at `./schemas`.
The package also supplies the non-overwriting `objective-contract-migrate` command.

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

Objective declaration definitions also live here: `parseObjectives` validates
`objectives.yaml`, `projectObjective` checks input and evaluates the bounded
subject projection, and `bindObjective` additionally validates the projected
subject against the Pilot domain. These APIs do not discover files, build Git
context or acquire sources; those environment operations remain tool-side.
