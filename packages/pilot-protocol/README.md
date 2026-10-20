# @potential-guide/pilot-protocol

Canonical Pilot definitions, schema compilation, strict YAML/manifest/reference
parsing and validation, bounded subject projection and resource capability types.
This protocol-only package does not depend on observation, regulation, CLI or
Agent implementations. `effects` remains the separate lifecycle-primitives protocol.

```js
import { parseManifest, compileDomain, validateSubject } from "@potential-guide/pilot-protocol";
const spec = parseManifest(source);
const issues = validateSubject(subject, compileDomain(spec.domainSchema));
```

`loadPilotSpec(uri, resolver)` assembles and validates a definition from injected
text/page resources without executing checks or fetching Git sources. Exports also
include `parseCheckEnvelope`, `parseDependencyProblem`, URI canonicalization,
`validateReferences`, and contract types. Public subpaths: `types`, `validation`,
`resources`, `projection`. Existing business-package reexports remain compatible.
See [layers and consumption](../../docs/package-layering.md).
