# @potential-guide/check-artifacts

For ordinary network consumption prefer [Check Host v2](../check-host/README.md):
the same Host owns source confirmation, exact cache, References and Task
execution. This package remains the reusable explicit build/validation/preparation
foundation. Private filesystem primitives live in `check-runtime-files`, so
artifacts do not depend on the Host scheduler. Existing pinned HTTPS preparation
continues to reject redirects; the Host's separate controlled-origin acquisition
adds bounded, reauthorized HTTPS redirects without weakening that legacy API.

Standalone Check delivery, independent of npm Objective packages. This workspace
library provides author-triggered build/pack and consumer-triggered preparation.
Neither preparation nor Check Host installs Check dependencies, builds source,
resolves npm versions, or executes lifecycle scripts.

## Authoring

Commit source, original References/resources, manifest, build configuration and
dependency locks. Do **not** commit generated workers or archives. The
[file-content example](examples/file-content/build.mjs) bundles a real Ajv-based
file Check and delivers its resource and complete Check/problem References:

```powershell
pnpm exec tsc -b packages\check-artifacts
node packages\check-artifacts\examples\file-content\build.mjs
```

Outputs are ignored `.cache/file-content` and `.cache/file-content.tgz`; the script
prints both exact digests. Build/pack refuse existing output paths. For a rebuild,
remove only your own previous output or select a fresh output directory/archive.
Authoring needs the declared build dependencies; consuming the resulting Check
does not. No registry or npm Check package is involved.

`buildCheckArtifact({entry, manifest, files, outDirectory})` from
`@potential-guide/check-artifacts/build` bundles JavaScript/TypeScript with esbuild
for Node 22 CommonJS. It rejects static unbundled non-builtin imports. Dynamic
dependencies must also be bundled by the author; Host refuses dependency fallback.
`files` maps exactly the manifest's resource and Reference paths to author source
files. `packCheckArtifact(directory, archive)` verifies the already-built directory,
creates a portable gzip tar using node-tar, verifies that delivered bytes still
match, and returns `{digest, transportDigest, archive}`. It never builds.
`import.meta.url` is relocated to the worker file URL so explicitly delivered data
can be read relative to it.

## Consumer API

```js
import { prepareCheckArtifact } from "@potential-guide/check-artifacts";
import { CheckKernel } from "@potential-guide/check-host";

const prepared = await prepareCheckArtifact({
  kind: "directory",
  directory: "D:\\artifacts\\file-content",
  digest: "sha256-pguide-check-v1:<64 lowercase hex characters>",
}, {
  cacheDirectory: "D:\\consumer\\private-check-cache",
  signal: controller.signal,
  timeoutMs: 30_000,
});
// HTTPS alternative:
// { kind: "https", url: "https://trusted.example/check.tgz",
//   digest: "<logical digest>", transportDigest: "sha256:<64 lowercase hex>" }

const kernel = await CheckKernel.create("D:\\consumer\\snapshots");
try {
  await kernel.executeCheck({
    checkId: "caller-generated-unique-id",
    directory: prepared.directory,
    revision: prepared.revision,
    subject: { file: "D:\\consumer\\target.txt" },
  });
  // Observe/subscribe until terminal before closing; see Check Host's API.
} finally {
  await kernel.close();
}
```

`inspectCheckArtifact(directory)` returns verified `{manifest, digest, files}` for
an explicitly built local directory. `prepareCheckArtifact` requires an **exact**
logical digest, never a version range. Its result has `{digest, manifest,
artifactDirectory, directory, revision}`. Only `directory` and `revision` go to
Host. The complete logical tree (including References) is in `artifactDirectory`;
the execution tree contains only worker and resources. Consumers can validate
subjects/results against the manifest schemas and resolve problem IDs through
`manifest.references.problems`; this layer does not change Host's opaque JSON API.
There is no Objective lookup, inheritance, override or built-in migration here.
The exported `readArtifactFiles` portable bounded reader and `safePath` validator
are also used by the tool-side declarative Objective assembler; existing Check
digests, archive format and preparation semantics are unchanged.

## Manifest v1

Root `check.json` is UTF-8 JSON, at most 16 KiB, with exactly these fields:

- `format: "pguide-check-v1"`, stable lowercase `id`, optional display `version`;
- `worker: "worker.cjs"`, `protocol: "pguide-check-host-v1"` (the existing
  `initialize?`, `execute(subject, context)`, `dispose?` module contract);
- `subjectSchema` and `resultSchema`: self-contained draft-07 JSON Schemas.
  Ajv compiles them to reject invalid/unresolved contracts; it never loads remote
  schemas. No custom formats/keywords are promised;
- `resources`: explicit `{path: "resources/...", executable: boolean}` entries;
- `references`: required `check` page and `problems` mapping stable problem IDs to
  `references/...` pages, plus optional `supporting` paths for auxiliary pages or
  assets. Required Check/problem pages must not be empty.

All declared files must exist; every file must be declared. The root contains only
`check.json`, `worker.cjs`, `resources/` and `references/`. Empty directories are
rejected. References are generic Check/problem knowledge, not runtime resources
or current observation. Do not name this payload `docs`.

## Three different content boundaries

1. **Logical artifact digest**: `sha256-pguide-check-v1:<hex>`.
   SHA-256 starts with UTF-8 `pguide-check\0v1\0`, then, in unsigned UTF-8
   lexicographic path order, appends UTF-8 `JSON.stringify([path, byteLength])`,
   one NUL byte, and exact file bytes. Paths use `/`. All manifest, worker,
   resource and Reference bytes participate. Manifest formatting is content.
   Portable executable declarations are covered through the manifest; filesystem
   modes, tar headers, timestamps, location, UID and compression are not.
2. **Transport digest**: `sha256:<hex>` over the exact gzip tar bytes,
   independently verified before parsing. Repacking may change this without
   changing logical content. HTTP must use identity content encoding.
3. **Host revision**: the existing `readArtifact(executionDirectory).revision`,
   independently recomputed by Host over only worker/resources and physical
   executable flags. This can be platform-specific (Windows has no POSIX execute
   bits). A Reference-only change changes logical digest but not Host revision.
   Neither a logical digest nor a transport digest can substitute for it.

Fixed logical test vector: `check.json` is the following exact single line (no
final newline), `worker.cjs` is `exports.execute=()=>({ok:true});` followed by LF,
and `references/check.md` is `Check reference.` followed by LF:

```json
{"format":"pguide-check-v1","id":"vector","worker":"worker.cjs","protocol":"pguide-check-host-v1","subjectSchema":true,"resultSchema":true,"resources":[],"references":{"check":"references/check.md","problems":{}}}
```

Its digest is
`sha256-pguide-check-v1:f51234a7f4948528687ca4b32e9e57c6050d2ca1855f584fadfe7912793da247`.

## Safety and operational boundaries

- Uses standard fetch/TLS, Node gzip and maintained node-tar parsing, not a custom
  archive decoder. Parses into bounded memory before writing any delivered path.
  Rejects traversal, absolute/Windows-ambiguous/non-NFC paths, case conflicts,
  duplicates, symlinks/hardlinks, special entries, file/parent collisions, nested
  compression, truncation and undeclared/missing content.
- Limits: 64 MiB/256 delivered files, 512 paths, 1024 UTF-8 bytes per path,
  255 per component, 72 MiB transfer and 66 MiB expanded tar including metadata.
  A preparation AbortSignal and bounded timeout govern fetch/parsing/publication;
  bounded local filesystem operations finish before the next cancellation check.
- HTTPS requires normal certificate verification. Embedded credentials and URL
  fragments are rejected; automatic redirects, ambient registry authentication,
  cookies and custom executable fetch hooks are not supported. Supply a trusted,
  direct HTTPS asset URL (resolve and authorize a Release/CDN redirect separately).
  Signed URL queries are not included in diagnostics. This is not an SSRF policy:
  the trusted caller must authorize source origins and exact digests.
- Reuses Host's private owner/ACL directory and protected manifest publication,
  no-follow/single-hardlink content reading, read-only snapshot modes and complete
  byte validation. Existing insecure cache roots are refused, not repaired.
  Capsules are keyed by logical digest, atomically published under a bounded
  per-digest lock and reverified on **every** cache hit. Corrupt/incomplete capsules
  fail closed; they are never silently replaced or fetched again. Valid hits work
  offline even if the original URL/path disappears.
- No automatic eviction/repair or stale-lock takeover. An interrupted publisher
  can leave its staging directory/lock; an operator must identify and remove only
  that stopped operation's paths. Host's private-store helper limits a cache root
  to 64 immediate entries, including in-flight entries; use bounded cache roots.
  On shutdown a process that no longer needs Host's permission helper can call
  `closePrivateFileBackend()` from Check Host.
- Digest equality is **not publisher authentication**, signatures or authorization.
  Read-only files are not a security boundary against their owner. Workers are
  trusted local code, **not a sandbox**. Host budgets, cancellation, cleanup and
  permission rules remain unchanged.

Tests use Node's test runner through tsx. The real local HTTPS test generates a
one-day localhost certificate/key in its owned project-local scratch directory,
trusts it only in a child process with `NODE_EXTRA_CA_CERTS`, and removes it.
It requires `openssl` (Git for Windows' bundled executable on Windows).
