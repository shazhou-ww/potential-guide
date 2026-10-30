# Check TaskType

`createCheckTaskType` registers `type: "check"` in the generic Engine.
The default type version is **2**; use `currentVersions: {check:"2"}`.
`checkInputSchema` is the single public input contract; `validateCheckInput` is
its generated wrapper. Old records without contract identity are unsupported,
not silently migrated.

Version 2 source URLs use conservative standard-Schema safety patterns before
raw request persistence: no userinfo, fragments, whitespace or backslashes;
HTTPS authorities cannot contain percent escapes. Query names are ASCII letters,
digits, underscore or hyphen, start with a letter, require `=`, and cannot contain
case-insensitive token/secret/password/credential/sig/api-key-like substrings.
Encoded names, plus signs and semicolon separators are rejected. Values may be
percent-encoded. Local Checker `file:///` references remain supported without
query/fragment/authority. Canonicalization and source authorization still run in
prepare; discovery never resolves URLs or fetches artifact subject schemas.
`createArtifactSource` is explicit authorized preparation IO. Neither nests the
legacy Host/scheduler nor starts listeners. See [server guide](../../docs/task-server.md).

Inputs beside the generic Request envelope are `checker` (typed HTTPS or local file reference,
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

## Local archives

`createArtifactSource({allowedOrigins, allowedFileRoots: [absoluteImportsDirectory], authorize})`
allows regular archive files strictly below those endpoint-host directories.
Absent/empty roots deny file access. Use `pathToFileURL(absoluteArchivePath).href`;
the URL must be canonical, hostless `file:///`, without credentials, query or fragment.
The HTTPS-only `download` hook is never called for file URLs.

Authorization runs before IO and on cache reuse/restored allocation. Unpinned
new Tasks read current bytes; exact digest mismatch fails. Already Prepared
content (or an exact authorized cache entry) does not reread its original file.
Removing the original file does not prevent execution while the trusted root
configuration and scope policy still grant the reference.

Only direct Check references gain file transport: Objective embedded Checker
references and dependency Objective references remain HTTPS-only. A browser file
picker must upload to a trusted endpoint-local importer first; browser `blob:` URLs
and browser filesystem paths do not identify files on a remote Server.
See [file-source boundaries](../../docs/task-server.md#local-file-source-boundaries).
