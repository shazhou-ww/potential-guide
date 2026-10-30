# Check TaskType

`createCheckTaskType` registers `type: "check"` in the generic Engine.
`createArtifactSource` is explicit authorized preparation IO. Neither nests the
legacy Host/scheduler nor starts listeners. See [server guide](../../docs/task-server.md).

Inputs beside the generic Request envelope are `checker` (typed HTTPS reference,
optional exact digest), `subject` (finite JSON object), optional `context` (finite
JSON data exposed as the Checker's `context.data`), and optional `language`.
The negotiated language overrides a same-named context field. Context contributes
to immutable input equality; Probe uses it for exact dependency resolutions.
Prepared persists exact verified bytes and actual runtime binding, not a mutable
cache path. Configure Engine payload/storage budgets for your maximum artifact.
The default 64 KiB Engine budget is suitable only for small Checkers.

The worker receives only explicitly injected environment variables. Do not put
secrets in this configuration: the canonical environment identity is durable.
Worker threads are resource isolation, **not an untrusted-code security sandbox**.
Authorize only trusted artifacts. `close()` closes the owned pool, not the
injected source; the composition owns its source and directory.
