# Artifact files

Shared file primitives for authoring tools and artifact consumers, independent
of Check execution and Task Workers.

`readArtifactTree` reads a bounded, canonical absolute tree without symbolic or
hard links. `ArtifactTreeError.status` describes capacity, invalid-input and
concurrent-change failures. `readArtifactFiles` additionally requires portable,
case-unambiguous paths and rejects empty directories. Limits can be reduced or
explicitly configured by the caller.

`safePath`, `safeComponent` and `artifactLimits` define the portable artifact
namespace and default budgets. `parseArtifactYaml` accepts only bounded finite
JSON-subset YAML, rejecting aliases, tags and non-string keys. `assertRuntime`
checks a Node runtime declaration against the Node 22.13+ host policy.
