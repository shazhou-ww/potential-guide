# Probe Task SDK

Objective is the business definition; **Probe Task Bundle** is the executable.
This workspace SDK prepares ordinary Task inputs and composes independent Check
Tasks. It does not add an Objective branch to Engine, compile a second kind of
Worker, publish content, or migrate immutable legacy Objectives.

## Authoring

```yaml
name: Prepare text
kind: text-ready
source:
  root: src
  entry: src/main.ts
  contract: src/contract.ts
languages: [en]
referenceRoot: references
bundles:
  text:
    source:
      kind: ipfs
      cid: <exact-Check-Task-root>
checks:
  text:
    bundle: text
    inputMapping: subject
levels:
  - id: prepare-text
    checks: [text]
```

Provide `references/en/objective.md`, `levels/prepare-text.md` and
`levels/terminal.md`. Optional overrides are only
`checks/text/check.md` and `checks/text/problems/<declared-code>.md`.
Every page uses the Check frontmatter rules. Unknown pages, languages, references
and codes fail. Missing overrides inherit the child's **same language**; complete
overrides can add a language absent from the child. No Markdown links are crawled.

Author YAML has no `references` or `include`. Optional exact `resources` mappings
select extra assets; `binary` selects their final-path byte treatment. Neither can
replace generated resources or select/change child files. Author links are written
relative to the final page path, not rewritten.

```ts
const prepared = await prepareProbe(file, { client, resolvePublication });
const built = await buildTask(prepared.buildFile);
const artifact = await readTaskArtifact(built.car);
await verifyProbeResources(prepared, artifact);
// Only now accept/copy the artifact and prepared.lock into the application's index.
```

`prepareProbe` comes from `/authoring`, `buildTask` from
`@potential-guide/pguide-task-bundle`, and `readTaskArtifact` from its `/artifact`
entry. Preparation never invokes compilation. `dist/definitions/<kind>.{js,d.ts}`
exports `definitions`; snapshot inputs live under
`dist/staging/<kind>/<snapshot>/`. Distinct candidates cannot replace earlier
accepted candidates. Keep accepted outputs and locks separate from staging.

Author contract default-exports `createProbeContract(input, definitions)` from
`/contracts`. Its input is a TypeBox object. The entry calls
`runTask(createProbeTask(definitions))`. Both import the generated
definitions. The generic compiler emits the only `task.yaml`, `worker.cjs`, schemas
and CAR. `resources/objective.json` is the generated business resource.

Input mappings are deterministic own-property selectors: `$` selects all input,
`subject` or `subjects.0` select bounded dotted paths (32 segments, 1024 characters).
No expressions, functions, IO, prototype traversal or missing values. Mapped input
must meet the child's independent Task input schema and cannot contain Task envelope
fields.

## Publication and content boundaries

`source: {kind: publication, url: https://<origin>/publications/<id>}` is an
authoring locator. `/publication` exports `createPinboardResolver({origin,
getPublication})`; supply the authorized Pinboard `publication_get({id})` transport,
not an assumed HTTP page API. Its real public response's `currentRevision`,
`current.revision` and `current.cid` select the snapshot. The resolver does not
interpret an attachment, description, page response or CAR upload CID as a root.
The directory, full DAG, canonical import and Check contract are verified next.
The adapter is read-only and credentials stay outside generated inputs.

Each distinct publication resolves once per preparation. `mode: "locked"` with a
previous `lock` forbids re-resolution and requires matching author inputs,
dependencies and toolchain. Missing blocks fail rather than falling back to latest.
Production clients must enforce their transport's origin/authentication policy and
honor AbortSignal. Preparation has a 120-second default total budget (maximum 600
seconds), 32 physical bindings, 128 checks/stages, 32 languages, 256 resource
includes, 4096 snapshot files and 64 MiB bytes. Child content is admitted only under
the current generic compiler's canonical UnixFS profile; alternative imports fail
explicitly. Full CAR validation compares actual child roots, not merely file bytes.

## Independent execution

The normal Worker uses `createProbeTask(definitions)` and the generic
`context.invokeTask` host capability. Probe retains Level ordering, deterministic
input mapping, Check fact/URI validation and document Overrides. The host owns
content, authorization, deadlines, durable parent-child associations, idempotency
and cleanup, including Worker exit and restart recovery. Neither Engine/Gateway
addresses nor caller credentials are built into the Worker. Check Tasks remain
ordinary independent Tasks.

`createProbeTask(definitions, invoke)` remains available for explicit legacy
adapters and existing immutable Bundles; the HTTP adapter below is not the normal
new-Worker path and cannot provide host-crash lifecycle guarantees.

`/execution` exports `createCheckInvoker({service, client, caller, timeoutMs, cleanupTimeoutMs?,
authorize})`. `service` is the existing TaskService or authenticated HTTP TaskClient;
`client` is an explicitly authorized read-only IPFS source containing the parent DAG.
The callback must explicitly allow the parent/child CID and scope. Credentials and
transport URLs are deployment configuration, never automatically inferred from an
Objective or child resource. Do not embed production credentials into a Worker.

The adapter verifies the **actual** child directory CID through the parent's
verified DAG, submits that root as an independent Task, waits for admission and
result, and propagates errors. Engine validates child input/result contracts and
its normal caller permissions. Parent cancellation/deadline AbortSignal cancels
the child; a separate bounded child timeout is also mandatory. Admission is durable:
after a failed/lost submit or status response, or cancellation, the adapter recovers
the decision by the **original request ID**, without resubmitting, then cancels the
accepted Task. Recovery and cancellation retry within an independent cleanup budget
(default/maximum 30 seconds from failure; `cleanupTimeoutMs` may narrow it), even
when the parent is already canceled. Each cleanup await is bounded, including a
transport promise that never settles.

Successful cleanup rethrows the original invocation error. If recovery/cancellation
also reports errors, `CheckInvocationCleanupError` retains the original as `cause`
and the first aggregate member, plus bounded cleanup diagnostics, request/task IDs,
`cleanupConfirmed` and the total cleanup error count. At most 16 cleanup errors are
retained (first 15 plus latest). Permanent transport unavailability is explicitly
**unconfirmed cleanup**, never a claim that the child was released. The request ID
permits later authorized recovery. HTTP transports must still bound their own
requests: the adapter cannot forcibly stop arbitrary external implementations or
guarantee cleanup after its Worker is killed. No child Worker is required into the
parent.

The invocation adapter returns `unknown`. `createProbeTask` validates that result
against the child's Check schema before using any fields, then verifies exact
facts and URI identity. Metadata reader cleanup failures are reported; when both
reading and cleanup fail, an AggregateError preserves the primary error as cause.

Probe reads business JSON through `context.bundle.read`, never cwd. Its identity
is `context.bundle.cid`. It rechecks original Check facts/URI identity, copies them,
and applies only logical-reference-scoped documentation overrides, with no Markdown
reads during assembly.

Stages are goals **still to do**: empty/passed stages advance; all failing checks
in the first failing stage are returned; passed checks are omitted. `initial` is
only the first-stage alias. After all pass, `terminal` is a real state with its own
page and empty checks. Every returned node has complete per-language IPFS URIs.
Mapping, execution, cancellation and invalid result errors are invocation failures,
not fabricated Problems.

## Runnable Objective packages

The authored Probe packages under [`examples/objectives`](./examples/objectives/README.md)
define monorepo standardization and local Task Engine device readiness as
reusable Probe Task Bundles. They include stable author YAML, Worker source,
References, and a local build/run command; they are not test-only fixtures.

## Compatibility and distribution

Check author YAML simultaneously removes redundant `references`; generated Check
indexes and results are unchanged. Legacy attained-Level Objective schemas/runtime
remain separate. This SDK and its content support package are private workspace
packages, included in local pack verification but not registered for npm release.
No new package publishing or remote artifact publication is authorized by building.
