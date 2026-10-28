# Declarative Objective artifacts

An Objective is `objective.json` plus explicitly declared References. It has no
package.json, npm package identity, version range, registry choice, JavaScript
entrypoint, installation or consumer-side build. Checks remain independently
delivered executable artifacts. This increment supports local Objective
directories; direct HTTPS Check archives use the existing Check preparation
boundary. Objective archive distribution, Release automation, built-in migration
and complete offline export are not provided here.
Use the candidate through this workspace or locally packed libraries. Local
package verification includes the Check support library without changing the
formal release plan; published CLI delivery must plan that prerequisite in the
later release work.

## Author and consume

Build the repository, then create the representative two-Check composition:

```powershell
pnpm build
node packages\cli-runtime\examples\objective-artifact\build.mjs .cache\my-composition
pguide validate artifact .cache\my-composition\objective --format json
```

The author script refuses an existing output directory. It prints a digest
and an `artifact+file:` location containing that exact digest. It builds two
independent Check artifacts and writes two data-only Objectives. The main
Objective refers to the same Check twice under different local reference IDs
and observes the other Objective as a fixed business prerequisite.

```js
import {
  inspectObjectiveArtifact, objectiveArtifactLocation, withPilot,
} from "@potential-guide/cli-runtime";
import { observe, readPage } from "@potential-guide/objective-pilot";
import { Effect } from "@potential-guide/effects";

const directory = "D:\\artifacts\\objective";
const { digest } = await inspectObjectiveArtifact(directory);
// Author inspection establishes a digest. A consumer obtains this trusted value
// from its declaration, not by accepting whatever mutable source it finds.
const location = objectiveArtifactLocation(directory, digest);
await withPilot(location, process.cwd(), undefined, async (spec, runtime) => {
  const observation = await Effect.runPromise(observe({
    spec, subject: { first: true, second: false, dependencyReady: true },
  }, runtime));
  console.log(observation);
  console.log(readPage(spec, "checks/second/problems/not-ready", "zh-CN"));
});
```

A Check Host must already be running, as for other Pilot sources. Host knows
neither Objective manifests nor acquisition channels. It receives only each
prepared Check's execution directory and independently verified Host revision.
Trusted Check code is not sandboxed; authorize sources and subject resources
before selecting them. Pilot never invokes an Agent.

```powershell
# Write {"first":true,"second":false,"dependencyReady":true} to subject.json.
pguide probe --pilot .cache\my-composition\objective --revision "sha256-pguide-objective-v1:<64 hex>" --subject-file subject.json
# Or pass the exact artifact+file: location printed by the author script:
pguide probe --pilot "<artifact+file location>" --subject-file subject.json
pguide regulate --pilot "<artifact+file location>" --subject-file subject.json --target terminal --agent reviewed-agent
pguide continue <regulation-id>
```

`validate artifact` prepares/verifies the fixed closure and References without
executing any Check. `probe` reports observed level/problems, not an acceptance
decision. `regulate` retains normal Agent profiles, permission ceilings, bounded
quotas and target semantics. An already attained target needs no Agent execution.
`initial` validates input without executing business Checks; `terminal` denotes
the highest real level. Levels accumulate in order.

Declarations use the existing immutable
`https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json`:

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json
objectives:
  composite:
    description: Exact composition
    objective: "artifact+file:///D:/artifacts/objective?digest=sha256-pguide-objective-v1%3A<64 hex>"
    inputSchema: {type: object}
    subject: input
```

Use `pguide probe --objective composite --scope directory --input-file input.json`.
No npm-package-arg parsing or registry lookup is applied to an artifact address.
Stable identity `objective:composition` is not a discovery channel: it is
resolvable only with explicit frozen `sources` supplied for recovery.

## Manifest v1

The new immutable schema is
`https://shazhou-ww.github.io/potential-guide/schemas/objective-artifact/v1.json`.
The [complete generated example](../packages/cli-runtime/examples/objective-artifact/build.mjs)
shows every field. Required fields:

- `$schema`, stable `id: objective:<lowercase dotted-or-hyphenated id>`;
- `subjectSchema`, ordered `levels[].{id,checks:[{id,problems}]}`,
  `defaultLanguage`, `languages`, with unchanged v3 Pilot business semantics;
- `checks`: map of Objective-local Check reference IDs to `{source,subject}`.
  `subject` is the existing bounded deterministic JSONata projection over the
  Objective subject. Both mapped subject and returned envelope are validated
  against the Check's own schemas, with an independent namespace per schema
  (reusing the same `$id` across Checks/references is valid);
- `dependencies`: stable Objective identity to `{directory,digest}`.
  Every business dependency must belong to this explicit fixed closure;
- `references`: page ID to language to `{path,title,description,references?}`;
- `resources`: explicit supporting `references/...` files (possibly empty).

Check `source` is exactly one of:

```json
{"kind":"directory","directory":"../check","digest":"sha256-pguide-check-v1:<64 hex>"}
{"kind":"https","url":"https://trusted.example/check.tgz","digest":"sha256-pguide-check-v1:<64 hex>","transportDigest":"sha256:<64 hex>"}
```

The HTTPS transport digest covers exact gzip-tar bytes, separately from the Check
logical digest. No redirect, credentials, lifecycle script or unsafe extraction
fallback is introduced. [Check artifact limits and safety](../packages/check-artifacts/README.md)
continue to apply. Directory references are relative to the owning Objective's
original source directory (absolute paths are also accepted). They are trusted
source capabilities, not paths inside the Objective payload.

Check IDs in levels bind local reference IDs, not global Check names. Each
declared reference must be used; an empty Check map preserves v3's vacuous level
attainment semantics. Problem IDs cannot exceed the referenced Check's
declared problems; runtime reports outside the level's declared problems fail.
Problem IDs must fit the existing Pilot flat lowercase/hyphen identifier profile;
other standalone Check problem vocabularies are explicitly rejected, not renamed.
Changing References cannot change a Check result schema or turn a failure into
success. Unsupported legacy Check protocols require explicit author migration.

## References composition

Objective owns `system/overview`, `system/404`, each real `levels/<id>` page,
optional `levels/initial`/`levels/terminal`, and explicit `pages/<id>` additions.
Each required Objective page needs a default-language entry.

Every Check reference inherits `checks/<ref>` and
`checks/<ref>/problems/<problem>`. Every level occurrence also exposes
`levels/<level>/checks/<ref>[/problems/<problem>]`. Overrides may target any of
these exact existing IDs, scoped to this Objective. An override of
`checks/<ref>` or its problem applies to all its level occurrences unless that
occurrence has a more-specific override. Reusing the same Check under another
reference does not inherit the override.

Overrides replace the **whole page**, including title, description, references
and content; there is no implicit field merge or Markdown concatenation.
For each page, selection is requested language, then Objective default language,
then inherited Check content if available. A missing required Objective page or
unsupported requested language fails. Check v1 References are language-neutral
Markdown and are inherited unchanged for all declared Objective languages.

Explicit `pages/base-<ref>` and `pages/base-<ref>-<problem>` retain the original
Check pages; this reserved namespace cannot be overridden. Ambiguous generated
IDs fail. A scenario can link these IDs through `references` metadata or
`[[page-id]]` in its content, and may expose additional `pages/<id>` pages.
These links are validated for dangling targets and cycles in every effective
language. Unknown Check/problem overrides fail. No global mutable References
overlay is used.

Each effective page carries `origin: {artifactDigest,path}` and `resourceBase`.
Relative Markdown links/assets must be resolved against that **owning artifact**
base, not the Objective source or override page. Explicit base pages retain the
Check's owning digest/base after an Objective override. A stable Objective ID is
not itself a resource URL. `readPage`/`searchPages` operate on the composed pages.

## Exact identity, cache and execution evidence

The logical digest is `sha256-pguide-objective-v1:<hex>`. SHA-256 begins with
UTF-8 `pguide-objective\0v1\0`; then in unsigned UTF-8 path order appends
UTF-8 `JSON.stringify([path,byteLength])`, one NUL and exact bytes. It covers the
entire manifest (including inline Check and dependency digests), all declared
Reference pages and assets. Location, timestamps and filesystem modes are not
logical identity. Manifest whitespace is content.

Bounds are 16 KiB for objective.json and the shared portable tree bounds of
64 MiB/256 files/512 paths. Symlinks, hardlinks, special/ambiguous paths, empty
undeclared directories and undeclared/missing files fail. Assembly reuses the
bounded no-follow reader and owner-private filesystem publication primitives.
Objective preparation does not repurpose a dummy worker or execute the manifest.

Prepared data and Checks are verified in private digest-keyed capsules.
Existing corrupted/partial capsules fail closed rather than refetching.
Absent capsules may be prepared only from the same exact declared source/digest.
Neither a cache hit nor a new source address authorizes content replacement.
Source paths need not remain available when a complete valid cache exists.
Cache capacity/eviction and distributed/offline transport are caller concerns.
The existing Windows private-directory child bound also limits very large
long-lived caches; no permission-repair or insecure fallback is attempted.

`spec.source.kind === "objective-artifact"` records `objectiveId`,
`artifactDigest`, original absolute `directory`, per-reference
`checks: {digest,revision}` and flat fixed Objective `bindings`. Host revision is
the actual worker/resources revision, not a logical/transport digest; it can be
platform-specific. Source-preparation and Check execution evidence include these
actual identities. Observation sources retain observed dependency evidence;
the root source's bindings also record the full prepared closure.

To restore, supply the saved `sources` and `versions` to `withPilot` and select
the stable root ID. Preparation compares the rebuilt exact closure, all Check
digests and actual Host revisions against that evidence. Missing/tampered
content, changed Host revisions, conflicting identities and undeclared
dependencies fail. Cross-platform Host revision changes require a new reviewed
run; they are not silently accepted as original execution evidence.

## Compatibility and exit

- Old npm package sources keep package-name/`packageDigest`/registry provenance;
  old Git sources keep repository/directory/commit/tree semantics. Existing
  v1/v2/v3 Objective schema bytes and declaration schema bytes are unchanged.
- New artifact data is normalized to the unchanged v3 Pilot business contract
  **after** validating its own new schema. This does not reinterpret historical
  manifests or historical evidence as artifact digests.
- CLI regulation records use schema version **6**, with `objectiveId` and
  `objectiveArtifactDigest`; legacy versions 4 (Git) and 5 (npm) keep their
  existing restore paths. Older unsupported records remain explicitly rejected.
- Coordinator artifact identity uses `{objectiveId}`; revisions use
  `artifactDigest`, never `commit` or `packageDigest`. Artifact Request projections
  use schema version **2**; historical v1 prefixes replay unchanged. Scheduling,
  recurrence, source validation and durable replay retain their existing rules.
  Durable artifact definitions retain Reference `origin` but omit cache-local
  `resourceBase` capabilities. Preparing the same content in another private cache
  therefore does not invent a revision or conflict with an existing one; obtain
  current resource bases from the prepared PilotSpec when reading resources.
- To leave npm/Git delivery, author/verify a new artifact, explicitly update the
  declaration to its exact address and create a **new** regulation/request.
  Do not edit historical records or reuse old revisions/keys as new digests.
  Existing built-in npm/Git Objectives need not migrate with this increment.
