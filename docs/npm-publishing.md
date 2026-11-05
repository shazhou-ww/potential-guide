# npm publishing

Potential Guide defines independent CLI, library, and Objective releases:

| Package | Release tag |
| --- | --- |
| `@potential-guide/pguide-task-bundle` | `pguide-task-bundle-vX.Y.Z` |
| `@potential-guide/task-protocol` | `task-protocol-vX.Y.Z` |
| `@potential-guide/task-engine` | `task-engine-vX.Y.Z` |
| `@potential-guide/task-engine-http` | `task-engine-http-vX.Y.Z` |
| `@potential-guide/task-engine-storage` | `task-engine-storage-vX.Y.Z` |
| `@potential-guide/task-sdk` | `task-sdk-vX.Y.Z` |
| `@potential-guide/task-engine-server` | `task-engine-server-vX.Y.Z` |
| `@potential-guide/task-engine-webui` | `task-engine-webui-vX.Y.Z` |
| `@potential-guide/pguide-task-engine` | `pguide-task-engine-vX.Y.Z` |
| `@potential-guide/effects` | `effects-vX.Y.Z` |
| `@potential-guide/git-source` | `git-source-vX.Y.Z` |
| `@potential-guide/objective-pilot` | `objective-pilot-vX.Y.Z` |
| `@potential-guide/objective-regulator` | `objective-regulator-vX.Y.Z` |
| `@potential-guide/regulation-coordinator` | `regulation-coordinator-vX.Y.Z` |
| `@potential-guide/cli-core` | `cli-core-vX.Y.Z` |
| `@potential-guide/pguide-config` | `pguide-config-vX.Y.Z` |
| `@potential-guide/pguide-agents` | `pguide-agents-vX.Y.Z` |
| `pguide` | `pguide-vX.Y.Z` |
| `@potential-guide/pilot-protocol` | `pilot-protocol-vX.Y.Z` |
| `@potential-guide/cli-runtime` | `cli-runtime-vX.Y.Z` |
| `@potential-guide/objective-declarations` | `objective-declarations-vX.Y.Z` |
| `@potential-guide/pguide-pilot` | `pguide-pilot-vX.Y.Z` |
| `@potential-guide/pguide-regulate` | `pguide-regulate-vX.Y.Z` |
| `@potential-guide/pguide-objectives` | `pguide-objectives-vX.Y.Z` |
| `@potential-guide/objective-monorepo-standard` | `objective-monorepo-standard-vX.Y.Z` |
| `@potential-guide/objective-package-standard` | `objective-package-standard-vX.Y.Z` |
| `@potential-guide/objective-devbox-health` | `objective-devbox-health-vX.Y.Z` |
| `@potential-guide/objective-pguide-setup` | `objective-pguide-setup-vX.Y.Z` |
| `@potential-guide/objective-pguide-self-check` | `objective-pguide-self-check-vX.Y.Z` |
| `@potential-guide/objective-setup-marker` | `objective-setup-marker-vX.Y.Z` |

Command wrapper packages use the `pguide-` prefix, including grouped
`pguide-pilot` and `pguide-regulate`. Configuration is now
`@potential-guide/pguide-config` with `pguide-config-v*` tags; its executable remains
`pguide-config`. Shared libraries are not command wrappers
and keep their responsibility names.

Release packages in manifest dependency order. `effects` and `pilot-protocol`
are protocol; `objective-pilot` consumes both protocols, then
`objective-regulator` builds regulation capabilities. Checker/Objective Host
packages and their release tags are retired.
The generic Task Engine release scope is documented below. Its release routes
prepare configuration only: they do not prove external publishing authorization
or a successful npm release. `check-environment`, `check-task`, `probe-task`,
`check-artifacts`, and `check-runtime-files` remain local-verification-only.
Their pack/install checks do not authorize bootstrap or product publication.
The independent `regulation-coordinator` library follows `objective-regulator`
and owns its scheduling helpers and runner types. `cli-core` precedes
`pguide-config`. `objective-declarations` consumes CLI Core and Pilot protocol only;
`cli-runtime` consumes Pilot and artifact/file primitives;
the command packages consume it and CLI Core. Publish `pguide-pilot` and
`pguide-config`, `pguide-agents` and `pguide-objectives` before `pguide`, which
installs all four as production dependencies.
It does not install regulation. Publish changed transitive dependencies before
their consumers. See [three-layer boundaries and migration](./package-layering.md).
Git source remains a compatibility/source utility. Six concrete Objective packages
now have independent release inventory; this migration itself does not publish them.
Build before packing: Objective packages publish the assembled `dist/package`,
with exactly one root `objective.yaml` and self-contained check resources.
Release `objective-package-standard` before `objective-monorepo-standard`, and
`objective-setup-marker` before `objective-pguide-setup`.

All extension packages use the `@potential-guide` npm scope. Their executable
and command names remain independent of the package name; for example,
`@potential-guide/pguide-config` installs `pguide-config` and advertises `config`.
`@potential-guide/pguide-agents` installs `pguide-agents` and advertises `agents`;
use its package-specific tag or select `pguide-agents` for a manual dry-run.
Only the composition package is named `pguide` because it is the package users
invoke through `npx pguide`.

The tag version must exactly match that package's `package.json`, and the tagged
commit must be reachable from `origin/main`. Each tag publishes only one
package, which keeps a failure from partially publishing a multi-package
release.

### Reuse main CI verification

Every push to `main` runs the full Node.js check matrix, cross-platform packed
CLI checks, and isolated package consumer verification (`pnpm consumers:check`).
The consumer job runs once per main push, not once per package release.

Before a tag release or manual dry-run, the publishing workflow requires the
latest main **push** run of `ci.yaml` for the exact checked-out commit SHA to
have completed successfully. A PR run, manual CI run, or success for another
commit cannot authorize publishing. The same run attempt must also contain a
successful `Release verification (v1)` job and its verification step. This job
requires every check-matrix, package-consumer, and deployment-matrix job to
succeed; skipped checks do not qualify. Its versioned name identifies the
required validation configuration, so a green run from the old workflow without
consumer validation is rejected even when its SHA matches.
Missing, pending, failed, or cancelled CI
blocks the release; there is no fallback that silently skips verification.
Wait for main CI to succeed before pushing package tags. If a release was
blocked before publishing, rerun it after the required main CI succeeds without
moving the tag. Older commits without this verification job must not be used for
new releases; release a commit containing this workflow change or a descendant.

Package releases reuse that verification result and record its CI run URL and
commit in the Actions summary. They install dependencies and build only the
selected package and its transitive workspace dependencies using Turborepo,
then pack and publish it. They do not repeat `pnpm check` or the full consumer
suite, and do not download cached build artifacts from the CI run.
Version/tag validation, main ancestry, existing-version rejection, OIDC
publishing, and published metadata/provenance checks remain in place.

During the pre-1.0 phase, versions remain on `0.x`. Breaking changes and
compatible new features advance the minor version; compatible fixes advance
the patch version. An existing candidate series advances `rc.N` while it
remains within the same target release. Choose versions independently for
each changed package from its published API and actual changes, not by forcing
all packages to have the same version. New packages with only a `0.0.0`
placeholder start their first product candidate at `0.1.0-rc.0`.

The functional migration deploys **release candidates only**. It never
publishes a stable version, changes `latest`, or introduces `1.0`.
The general workflow still distinguishes stable and RC tags: stable versions
publish to the npm `latest` dist-tag, while release candidates use
the `X.Y.Z-rc.N` version form and publish to the `rc` dist-tag, so testing an RC
never changes the default version installed by consumers.
The generic Task Engine scope entries, including `cli-core`, are
RC-only in both tag parsing and workflow metadata validation. The other twenty
existing routes retain their stable/RC behavior. A future stable Task Engine
release requires separate approval and an explicit change to that restriction.

## Generic Task Engine release preparation

The approved configuration scope is the exact internal runtime closure of
`pguide-task-bundle` and `pguide-task-engine`, not the entire release inventory.
Publish only after each upstream version is available, in these groups:

| Group | Packages | Candidate guidance |
| --- | --- | --- |
| 1 | `task-protocol`, `cli-core` | Protocol: `0.1.0-rc.0`; CLI Core: current `0.3.0-rc.0` candidate |
| 2 | `task-sdk`, `task-engine-http`, `task-engine-storage`, `task-engine-webui` | `0.1.0-rc.0` |
| 3 | `pguide-task-bundle`, `task-engine` | `0.1.0-rc.0` |
| 4 | `task-engine-server` | `0.1.0-rc.0` |
| 5 | `pguide-task-engine` | `0.1.0-rc.0` |

After removing the unused Artifact Files dependency, version preparation preserves eight existing `0.1.0-rc.0` candidates and
CLI Core's `0.3.0-rc.0`; only the UI moves from `0.1.0` to `0.1.0-rc.0`.
The resulting ten-package scope contains nine `0.1.0-rc.0` candidates and
one `0.3.0-rc.0` candidate. Neither Check support package needs a version change.
Unified verification must confirm each source manifest version, its matching
release tag, and every packed internal dependency range against the dependency's
actual manifest version before publishing.

These are recommendations, not permission to publish or overwrite a version.
If a candidate already exists, review its changes and advance its RC instead
of reusing the immutable version. The UI manifest must be an RC before release;
a stable `0.1.0` manifest is rejected rather than published to `latest`.

**Blocking prerequisite:** Bundle budgets, paths, declaration parsing and
file-set inspection must use the independent `task-protocol` implementation,
not Check utilities or `artifact-files` equivalents. Author directory reads
now use native Node APIs, and author/Engine runtime comparison uses `semver`;
neither root requires `artifact-files`. That repository package and its
release/verification inventory, bootstrap selection and workflow route are
retired; its old tags are rejected. This is not npm deprecation or unpublish.
The production manifest must no longer depend on either Check package.
Release-inventory tests walk actual dependencies,
optional dependencies and peers from both roots and require exactly these
ten public packages. A remaining Check dependency fails the test and blocks
release; it must not be hidden with local overrides or an extra release route.
Validate the actual packed consumers after the source migration; a passing
manifest-closure test alone does not prove runtime correctness.

`task-sdk` is the Worker runtime, not the old build/publish API; author tooling
belongs to `pguide-task-bundle`. The CLI under `apps/pguide-task-engine` installs
the public UI server and browser assets under `apps/task-engine-webui` as a
normal production dependency, even if the user does not enable `--ui`.
Workflow and bootstrap paths use each inventory entry's `workspace` field,
defaulting to `packages`. Local tarball overrides prove neither registry
resolution nor provenance. Do not bypass `pnpm check` or `pnpm consumers:check`.
Check/Probe adapter product publication requires a separately reviewed scope.

### Public evidence and external authorization

Read-only research on 2026-11-05 used [npmx](https://npmx.dev/):

- [task-engine](https://npmx.dev/package/@potential-guide/task-engine),
  [pguide-task-bundle](https://npmx.dev/package/@potential-guide/pguide-task-bundle)
  and [pguide-task-engine](https://npmx.dev/package/@potential-guide/pguide-task-engine)
  showed only `0.0.0` placeholders.
- [cli-core](https://npmx.dev/package/@potential-guide/cli-core) showed
  `latest=0.0.0` and `rc=0.2.0-rc.0`, not the source's `0.3.0-rc.0`.
- Pages for the other seven scope entries returned 404. This means npmx did
  not find them, not an authoritative registry check that permits bootstrap.

The GitHub `npm` environment existed with no protection rules or deployment
branch policy at inspection time. This does **not** establish any package's
current Trusted Publisher configuration. An earlier owner report about the
Bundle publisher and CLI Core's historical OIDC success are not current
authorization evidence. Before any external action, obtain owner confirmation
for every selected package's exact repository, workflow, environment and
publish/dist-tag permissions. Missing packages need explicit bootstrap approval;
adding these routes grants neither that approval nor Trusted Publisher access.

### Cleanup boundaries

The unused `artifact-files` package is retired from the repository. No other
package removal, npm deprecation or unpublish is part of this preparation.

- `ipfs-content` is private and outside the product runtime closure, but Engine
  regression tests still use it. Migrate those tests with equivalent coverage
  before considering repository removal.
- `test-tree` is private with no workspace manifest reverse dependencies at
  inspection time. Confirm its manual-generation workflow is no longer needed
  before removing it and its root TypeScript/layer/lockfile references.
- `check-environment` remains a build dependency of concrete Objective packages
  and generated workers. `check-artifacts` and `check-runtime-files` still have
  Check/Probe and CLI Runtime consumers. Removing them from the generic closure
  does not authorize deleting their packages or compatible entrypoints.
- Historical `config` and Supervisor names are already retired in this source
  tree. Preserve published versions. Consider a separate npm deprecation only
  after replacement products and caller migration are verified; configuration
  binaries conflict, and Supervisor has no automatic one-to-one replacement.
  Unpublish is not a cleanup mechanism for this migration.

The self-check Docker harness also resolves release entries by workspace.
Its tarballs are installed into `/opt/consumer`, which is copied into the runtime
image; it must retain the UI's server and browser assets. Source/path assertions
or local consumer checks are not a successful Docker build or image run.
The source workspace still uses a production-only frozen install. The isolated
image toolchain also supplies the UI's existing catalog-selected build and
TypeScript fixture dependencies, then invokes its normal build script to
generate complete esbuild/Tailwind assets before the required-file checks and
packing. See the [Docker harness](../scripts/self-check-docker/README.md).
This prepared build path still needs unified build/consumer validation and an
actual Docker build when a daemon is available; it is not image-success evidence.

## Before configuring npm

Merge `.github/workflows/publish-npm.yaml` to `main`. npm matches the workflow
by its exact filename, and release tags are rejected unless their commit is
reachable from `origin/main`.

In the GitHub repository, open **Settings → Environments**, create an
environment named `npm`, and leave it without npm secrets. Optional required
reviewers are compatible with the workflow, but any deployment branch or tag
rules must allow these release tags:

- `pguide-task-bundle-v*`
- `task-protocol-v*`
- `task-engine-v*`
- `task-engine-http-v*`
- `task-engine-storage-v*`
- `task-sdk-v*`
- `task-engine-server-v*`
- `task-engine-webui-v*`
- `pguide-task-engine-v*`
- `objective-monorepo-standard-v*`
- `objective-package-standard-v*`
- `objective-devbox-health-v*`
- `objective-pguide-setup-v*`
- `objective-pguide-self-check-v*`
- `objective-setup-marker-v*`
- `effects-v*`
- `git-source-v*`
- `objective-pilot-v*`
- `objective-regulator-v*`
- `cli-core-v*`
- `pguide-config-v*`
- `pguide-agents-v*`
- `pguide-v*`
- `pilot-protocol-v*`
- `cli-runtime-v*`
- `objective-declarations-v*`
- `pguide-pilot-v*`
- `pguide-regulate-v*`
- `pguide-objectives-v*`

## Publish the bootstrap placeholders

npm only allows Trusted Publishers to be added to existing packages. New
Trusted Publisher connections must then complete a real OIDC publish within two
days. A dry-run does not satisfy that requirement.

To keep the first product release under OIDC with provenance, manually publish
minimal `0.0.0` placeholders only for packages that do not yet exist, and
reserve product RC versions for the workflow. A placeholder is not a
functional product release.

On a machine and network approved to access the npm registry, use a clean,
up-to-date `main` checkout:

```sh
git fetch origin main
git switch main
git pull --ff-only origin main

corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm consumers:check
pnpm bootstrap:pack

npm login --registry=https://registry.npmjs.org/ --auth-type=web
npm whoami --registry=https://registry.npmjs.org/

npm publish .cache/npm-bootstrap/potential-guide-cli-core-0.0.0.tgz \
  --access public --registry=https://registry.npmjs.org/
npm publish .cache/npm-bootstrap/potential-guide-effects-0.0.0.tgz \
  --access public --registry=https://registry.npmjs.org/
npm publish .cache/npm-bootstrap/potential-guide-git-source-0.0.0.tgz \
  --access public --registry=https://registry.npmjs.org/
npm publish .cache/npm-bootstrap/potential-guide-objective-pilot-0.0.0.tgz \
  --access public --registry=https://registry.npmjs.org/
npm publish .cache/npm-bootstrap/potential-guide-objective-regulator-0.0.0.tgz \
  --access public --registry=https://registry.npmjs.org/
npm publish .cache/npm-bootstrap/potential-guide-pguide-config-0.0.0.tgz \
  --access public --registry=https://registry.npmjs.org/
npm publish .cache/npm-bootstrap/pguide-0.0.0.tgz \
  --access public --registry=https://registry.npmjs.org/

npm logout --registry=https://registry.npmjs.org/
```

The `bootstrap:pack` command only creates one minimal tarball per release package containing a
`package.json` and README; it never publishes them. Inspect the printed paths
before running `npm publish`. Run only the publish lines for missing packages. Do not manually
publish product candidates.

## Configure Trusted Publishers

In each package's **Settings → Trusted publishing**, add a GitHub Actions
Trusted Publisher with these exact, case-sensitive values:

| Field | Value |
| --- | --- |
| Organization or user | `shazhou-ww` |
| Repository | `potential-guide` |
| Workflow filename | `publish-npm.yaml` |
| Environment | `npm` |
| Allow npm publish | Enabled |
| Allow npm dist-tag | Enabled |

Choose normal publish permission rather than stage-only permission because the
workflow runs `npm publish`. Do not create an `NPM_TOKEN` GitHub secret. The
workflow requests `id-token: write` and exchanges GitHub's OIDC identity for a
short-lived npm credential. Trusted Publishing automatically adds provenance
because this is a public repository on a GitHub-hosted runner.

### Previously published configuration package

`@potential-guide/config` remains a historical published package, not an alias
for the new name. Existing versions are not republished or unpublished by this
migration. Replace explicit dependencies with `@potential-guide/pguide-config`
and remove the old installation to avoid competing `pguide-config` binaries.
The historical `config-v*` tag is no longer accepted. Configure a new Trusted
Publisher for `@potential-guide/pguide-config` and bootstrap it only if absent;
the old package's publisher configuration does not transfer to the new name.

Configure the publishers only when the first product RC can run immediately.
Each connection expires if it does not complete a successful publish within two
days. A dry-run can diagnose the connection but does not satisfy that deadline.

## Publish the first product versions

After publishing missing placeholders and configuring their Trusted
Publishers, publish the selected product candidates in dependency order.
Do not repeat the bootstrap publish for packages that already exist.
For the functional migration, select exact `0.x.y-rc.N` versions from the
reviewed release inventory, update manifests and internal dependencies, then
use the matching package-specific RC tags. The stable `0.1.0` commands in
historical releases are not instructions for this migration.

Wait for each upstream workflow to succeed before creating a downstream tag.
For example, a new effects package starts with:

```sh
git fetch origin main --tags
git switch main
git pull --ff-only origin main

git tag -a effects-v0.1.0-rc.0 -m "release: effects v0.1.0-rc.0"
git push origin refs/tags/effects-v0.1.0-rc.0
```

Use `gh run list --workflow publish-npm.yaml` and
`gh run watch <run-id> --exit-status` after each push. Do not move or reuse a
pushed release tag.

The workflow also supports a manual package-specific dry-run from GitHub's
**Actions → Publish package to npm → Run workflow** UI or the CLI:

```sh
gh workflow run publish-npm.yaml --ref main -f package=objective-pilot
```

Use the dry-run only as a quick diagnostic, then perform the real tag release
within the two-day window.

For a release candidate, update the selected package version and create the
matching package-specific tag, for example:

```sh
git tag -a objective-pilot-v0.1.0-rc.0 \
  -m "release: objective-pilot v0.1.0-rc.0"
git push origin refs/tags/objective-pilot-v0.1.0-rc.0
```

The workflow publishes this version under npm's `rc` dist-tag. Wait for the
workflow to succeed before testing the package downstream.

After every package has one successful OIDC release, set its npm **Publishing
access** to **Require two-factor authentication and disallow tokens**. Trusted
Publishing continues to work with that setting.

## Verify a release

Registry propagation can take a short time. Do not repeat a publish while
waiting. Verify the immutable version, `rc` tag and unchanged `latest` tag:

```sh
npm view "@potential-guide/objective-pilot@0.1.0-rc.0" \
  name version dist-tags exports engines dist \
  --json --registry=https://registry.npmjs.org/
```

Repeat for the other selected packages and confirm provenance links the
release to this repository and workflow. The publish workflow records a
release receipt with the exact commit, integrity, provenance URL and
before/after tags; an RC publish fails verification if `latest` changed.

Registry metadata can lag behind a successful publish, including npm's HTTP 202
processing response. Verification waits for the version, intended dist-tag and
provenance for up to 60 polls five seconds apart (about five minutes); it never
repeats a publish. If an older workflow already published successfully but its
verification failed, preserve the original run and release tag, then use the
non-publishing recovery mode with the recorded previous `latest`:

```sh
gh workflow run publish-npm.yaml --ref main \
  -f package=effects -f mode=verify-published -f expected_latest=0.0.0
```

This mode skips CI authorization, dependency installation, building, packing,
dry-run publishing and actual publishing. It only verifies an existing release;
it cannot authorize a new publish. Its receipt
records the original package tag's source commit separately from the
verification commit. Never rerun a successful publish step to repair a
metadata propagation failure.

After every selected candidate has published successfully, run the CI workflow
manually with `published=true`. Its independent consumers explicitly install
`pguide@<manifest-version>` and all five explicitly selected command/config packages from npm,
without overrides. The verifier accepts the same `0.x` stable/RC versions as release
tags, resolves every internal dependency from its actual parent (including nested
copies), and checks all installed versions against the fifteen source manifests.
It also imports the public libraries and verifies bins and runtime scenarios on
the declared operating systems:

```sh
gh workflow run ci.yaml --ref main -f published=true
```

The default local `pnpm deployment:verify` path installs those explicitly selected
CLI tarballs. It packs the release inventory plus the local runtime support
packages (`check-runtime-files` and `check-artifacts`), checks their contents, and uses npm
`overrides` pointing to the internal tarballs. This isolated consumer makes
unpublished RC dependencies available without requiring the main package to
depend on optional commands. `pnpm pack:check` checks packed artifact structure;
`pnpm consumers:check` additionally checks main-only
consumption: exactly seven default commands, working bundled entrypoints without
transitive PATH bins, and installation hints for missing optional commands.
It also checks protocol-only consumption without business logic and combined
explicit installation without synthetic conflicts. These prove local composition, not real registry
dependency resolution, publication, provenance, or the `latest` dist-tag.
The local support inventory is shared with `pack:check`; it does not add release
tags or authorize publishing those support packages.
Each selected-command consumer verifies only its actual transitive closure;
independent Objective and Coordinator consumers are checked separately rather
than being required as accidental CLI dependencies. Registry modes also check
the manifest versions of any runtime support packages in that closure.
Tarball overrides are never used in either registry mode.
Deployment fixtures use the `worker.cjs` contract, not retired `run.*` checks.
The old Host launchers and their deployment fixtures are removed.
CLI execution checks now verify explicit retirement rather than running legacy
Probe/Regulation workflows. Static CLI and generic Task Bundle consumers remain
verified; old setup/self-check CLI execution and continuation are not supported
until explicitly migrated.

For a separately authorized stable release, update manifests to the reviewed stable
versions and publish in dependency order first. Then verify the default consumer:

```sh
node scripts/verify-deployment.mjs --latest
# Or the same three-OS CI consumer:
gh workflow run ci.yaml --ref main -f latest=true
```

This mode reads `npm view pguide@latest version`, requires it to equal the entry
manifest version, installs `pguide@latest` plus the explicitly selected optional
command/config manifest versions, and applies the same exact
transitive-version checks. It is not interchangeable with `--published`:
successful exact RC installation does not prove default installation. The
`published` and `latest` inputs are mutually exclusive; ordinary push/PR CI
continues to use local packs. Neither mode publishes anything, and absent
versions fail instead of silently falling back to older releases. The existing
stable release hold remains in force: preparing a new RC or adding stable
verification does not authorize publishing stable packages or moving `latest`.

If the registry is blocked by network policy, inspect package metadata through
the approved [npmx browser](https://npmx.dev/) and use the existing
GitHub-hosted workflow for authoritative registry/install verification.
Do not disable TLS checks, change local routing, or use an unapproved proxy
to bypass the policy.
