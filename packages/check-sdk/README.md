# Check SDK

Shared Check author library for Node >=22.13. No environment algorithms,
Engine lifecycle, publishing or second Bundle compiler.

| Import | Purpose |
| --- | --- |
| `@potential-guide/check-sdk` | `createCheckResult`, `createCheckTask`, result types; no runtime author/Schema imports |
| `@potential-guide/check-sdk/contracts` | `createCheckContract`, result/problem TypeBox Schema factories |
| `@potential-guide/check-sdk/authoring` | Check YAML Schema, `prepareCheck`, `validateReference`, `verifyCheckResources` |

Reference: [results](references/en/check-result.md),
[callbacks](references/en/check-callback.md). These files ship with npm; they
are not automatically included in business Bundles.

## Author flow

Use the [small independent text check](examples/text/README.md).
Check Build YAML declares name/kind, source root/entry/contract, canonical
BCP 47 languages, stable problemCodes and referenceRoot. Pages are inferred:
`<referenceRoot>/<language>/check.md` and `problems/<code>.md`.
The former author `references` field is now rejected: remove it when migrating
author YAML. Generated `resources/check.json.references`, immutable Bundles and
Check results are unchanged. Unknown properties fail; a zero-code list is valid.
Optional `resources: [{from: "assets/file.json", to: "resources/file.json"}]`
selects additional exact files, with no glob expansion.
Optional `binary: ["resources/assets/**"]` uses the ordinary Task final-path
portable glob rules; it is forwarded into generated `task.build.yaml`.
It cannot select the generated `resources/check.json` index.

`prepareCheck(file)` validates every declared language's `check.md` and
`problems/<code>.md`, rejects undeclared files/languages/codes, symlinks,
case/path collisions and escaping paths, and snapshots inputs under
`dist/staging/<kind>/`. Every Reference needs YAML frontmatter containing
**only** nonempty `title` and `description` (at most 200 Unicode code points).
Bodies, sections, translations, links and anchors are not parsed or validated.
All generated inputs are under `dist/`; definitions at
`dist/definitions/<kind>.{js,d.ts}` export frozen `problemCodes` and `languages`
derived from YAML and imported by both
business code and its contract. Run preparation before TypeScript.

Call the ordinary `buildTask(prepared.buildFile)` from
`@potential-guide/pguide-task-bundle` next. It consumes only the fixed staged
business inputs. Read its CAR with `readTaskArtifact` and call
`verifyCheckResources(prepared, artifact.files)` before accepting any output.
The exact resource set and binary list must match; default UTF-8 text bytes are
compared after CRLF/lone-CR to LF normalization, binary bytes exactly. BOM and all
other bytes remain significant. The complete supplied Bundle is validated first.
Accept candidates only after all checks succeed; never replace the
last accepted output/index on failure. The SDK does not invoke the compiler
or publish artifacts.

Bundle references are available at
`ipfs://<CID>/resources/references/<language>/check.md` and
`ipfs://<CID>/resources/references/<language>/problems/<code>.md`.
`resources/check.json` maps languages and codes to these Bundle-relative paths.
This is a Check convention, not automatic Engine document presentation.

## Result documentation

Use `createCheckContract(input, problemCodes, languages)` and
`createCheckTask(problemCodes, languages, inspect)` with those generated tuples.
`inspect` returns `CheckObservation[]` (only target/code/actual). The shared
adapter adds `documentation: { "<language>": "ipfs://<CID>/..." }` to **every**
result, including passes, and to each problem. No Markdown bodies are returned.
Consumers choose a declared language and resolve the complete URI from that node;
they need neither the parent result nor a code/index lookup. There is no implicit
language fallback. Missing content, transport failures and unsupported languages
must be reported by the reader, without changing the saved check result.

The Task SDK supplies the verified executing identity in `context.bundle.cid`.
It comes from the Engine's admitted Bundle, not author input. Assembly never
reads documentation during execution, so document availability cannot change
the finding. The final CID cannot be embedded in the hashed Bundle itself:
generated definitions contain only language/code metadata, and the callback adds
the trusted root at runtime. The generic Engine never interprets problem codes.

For non-Task use, `createCheckResult(problemCodes, observations, {cid, languages})`
requires an explicit, validated Bundle root and the generated languages. The
caller must supply the identity of the verified artifact actually being used;
the helper cannot attest an arbitrary caller's identity. Missing/invalid identity
is an error, never a relative or moving reference.

This is a breaking result/API change: rebuild contracts and workers together,
then distribute the new CAR/CID. Existing immutable Bundles and historical
Check/Objective payloads retain their original contracts; no migration is implied.
