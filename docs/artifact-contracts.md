# Artifact contracts and Host services

New immutable schema namespaces:

- `https://shazhou-ww.github.io/potential-guide/schemas/artifacts/checker/v1.json`
- `https://shazhou-ww.github.io/potential-guide/schemas/artifacts/objective/v1.json`

These are repository contracts; publication availability is a separate release
step. Historical schemas and `sha256-pguide-*` digests retain their original
meaning. Re-author and validate the new file set to migrate; changing a prefix,
file extension, or schema URI is not migration.

## Authoring

Checker roots contain `checker.yaml`, one self-contained CommonJS entry, and
Markdown under `references/<language>/`. Objective roots contain
`objective.yaml` and Markdown only. `writeContractArtifact`,
`buildCheckerArtifact`, `packContractArtifact` are explicit author APIs from
`@potential-guide/check-artifacts/build`. Consumers never build, install or run
package hooks. Old author APIs continue to produce the old format.

Checker fields are `$schema`, `runtime: {type: node, minVersion: "22.13.0"}`,
`entry`, `subjectSchema`, `problems`, `languages`. Objective fields are
`$schema`, `subjectSchema`, `languages`, ordered cumulative `levels`, and
`checkers`. Every internal Checker has an HTTPS URL, required exact digest and
explicit `subjectMapping`; fixed source immutability is the publisher's
contract, not a heuristic about digits in URLs.

No artifact has an ID, format/version, defaultLanguage, protocol, arbitrary
resultSchema, or hand-maintained references/resources index. YAML rejects
duplicates, aliases, explicit tags, directives, non-string keys, non-finite
values and excessive depth/size. Paths reject links, special/empty directories,
non-NFC spelling, case collisions and ambiguous platform names.

`digest` is exactly `sha256:` plus the Git SHA-256 root tree OID: original file
bytes, `blob <length>\0`, `tree <length>\0`, raw 32-byte child OIDs, `100644`
files, `40000` directories and Git directory-name ordering. Compression is not
part of this identity. `transportDigest` hashes exact archive bytes separately.
Existing worker revisions remain separate evidence for the derived execution
capsule; they are not renamed content digests.

Typed references round-trip as `checker:https://…#sha256:…` or
`objective:https://…#sha256:…`; the outer digest fragment is optional only for
external admission. Source fragments and credentials are rejected. Query order
is preserved. Known credential-bearing query names are rejected until a
credential resolver is provided, rather than exported in recoverable evidence.
Sources require explicit allowed-origin authorization, including redirects.
Cache grants bind source and authorization scope, not merely content.

## Mapping and entry lifecycle

The portable bounded JSONata selection profile supports `$`, required object
paths (`root`, `$.nested.value`), JSON literals, object constructors and array
constructors. Object keys are quoted and unique; missing paths are errors.
No functions, implicit array traversal, evaluation, extensions or IO are
available. Bounds are 4096 expression characters, 256 tokens, 16 expression
levels and 1 MiB result. The result is a finite JSON object validated against
the Checker subject schema. This intentionally small profile permits portable
implementations without JavaScript AST semantics.

Canonical request JSON uses finite IEEE-754 numbers (`-0` serializes as `0`),
ECMAScript JSON number/string encoding and UTF-16 code-unit ordering of object
keys; array order is significant. Input accessors, custom prototypes, toJSON,
cycles, sparse arrays and non-finite numbers are rejected before serialization.
These normalization rules affect sharing/idempotency, never artifact bytes.

CommonJS exports optional `initialize()`, required `execute(subject, context)`,
and optional `dispose()`. Context contains `signal`, `data` (including selected
language and dependency resolutions), `deadline`, `progress`, and `defer`.
It uses the existing checked worker lifecycle and cleanup ownership.
`execute` returns `{status:200,message:string,payload:{ok,problems,requirements?}}`.
HTTP Task `result` is **only the validated payload**. An invocation failure,
unknown problem, invalid envelope or failed cleanup is a failed Task, not a
business problem. Requirements use `{objective:{kind:"objective",url,digest?},
subject,expectedLevelId}`; dependency problems additionally have
`kind:"dependency",currentLevelId`. `ok:true` cannot contain either problems
or requirements.

Node is the only v1 runtime. Stable numeric versions are compared numerically;
unsupported types or lower versions fail before invocation. Evidence records
actual Node version, platform, architecture, adapter and derived worker
revision. Exact-source recovery rejects changed execution environments.
Objectives have no runtime and impose no same-runtime constraint.

## Pages

Required overviews are `checker.md` / `objective.md` at each locale root.
Checker problem and Objective level pages are required. Frontmatter contains
only `title`, `description`, optional `references`. Supporting pages use
`pages/`. Frontmatter and wiki links are checked for dangling targets/cycles.
Objective `checkers/<local-ref>/checker.md` and `problems/<id>.md` replace
whole inherited pages. Original pages remain at
`pages/base-<ref>` / `pages/base-<ref>-<problem-id>` (and analogous
supporting-page IDs), preserving the original owning digest/path.

Missing new-format pages return `reference_not_found` (404), never fallback.
No `system/` namespace or raw resource endpoint is offered. Language selection
uses explicit supported requests or ordered Host preferences. Objective
overrides can complete a language missing in Checker documentation; child
execution uses that language if supported, otherwise an explicitly selected
Checker-supported language. Both choices appear in snapshots.

## Compatibility and protocol versions

The package is now `@potential-guide/checker-host`; its repository directory is
still `packages/check-host` to preserve historical links. No old npm package
is published or silently aliased. The old `pguide-check-host` command and
`PGUIDE_CHECK_HOST_DIRECTORY` / `PGUIDE_CHECK_SOURCE_ORIGINS` environment names
remain compatibility aliases. New `CHECKER` spellings take precedence; the
existing private discovery directory is retained to avoid spawning a second
legacy Host. Check actions and CheckTask names are unchanged.

Existing v2 `{check:…}` SDK/protocol and legacy artifacts remain unchanged.
New `@potential-guide/checker-host/v3` uses `{checker:…}`, new schemas and
semantic pages. Objective v1 uses `{objective:…}`. Neither module fixes its
mount prefix or opens a listener. `serveUnifiedHost` is optional assembly.

New HTTP routes are `POST /check-tasks` or `/probe-tasks`, `GET /…/{id}`,
`POST /…/{id}/cancel`, `GET /events`, `POST /artifacts/resolve`,
`GET /artifacts/{digest}`, and `GET /artifacts/{digest}/references/{encoded-id}`.
Creation returns 201 and Location. Errors before admission are structured
HTTP errors (400 invalid input, 401 authentication, 403 source/scope denied,
404 missing route/task/page, 409 idempotency conflict, 413 input size,
422 exact content mismatch, 429 capacity, 503 closing); after admission they
become failed Task snapshots with `{code,stage,message}`. Source failures are
sanitized. Artifact and reference calls may also return these structured errors.

The Pilot bridge keeps legacy business shapes only inside existing APIs:
`objectiveId` now carries a typed external source URL, not a manifest ID;
`version` carries the new digest and source kind is `artifact-service-v1`.
New execution evidence is explicit. Coordinator request schema 3 and CLI
Regulation recovery schema 7 distinguish these sources; older schema 1/2
and 4/5/6 replay paths remain unchanged. The public `withPilot` entry accepts
typed Objective HTTPS references and preserves exact dependency bindings.
