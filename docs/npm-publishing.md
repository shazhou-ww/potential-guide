# npm publishing

Potential Guide defines independent CLI, library, and Objective releases:

| Package | Release tag |
| --- | --- |
| `@potential-guide/check-sdk` | `check-sdk-vX.Y.Z` |
| `@potential-guide/check-environment` | `check-environment-vX.Y.Z` |
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
| `@potential-guide/pguide-regulate` | `pguide-regulate-vX.Y.Z` |
| `@potential-guide/pguide-objectives` | `pguide-objectives-vX.Y.Z` |
| `@potential-guide/objective-monorepo-standard` | `objective-monorepo-standard-vX.Y.Z` |
| `@potential-guide/objective-package-standard` | `objective-package-standard-vX.Y.Z` |
| `@potential-guide/objective-devbox-health` | `objective-devbox-health-vX.Y.Z` |
| `@potential-guide/objective-pguide-setup` | `objective-pguide-setup-vX.Y.Z` |
| `@potential-guide/objective-pguide-self-check` | `objective-pguide-self-check-vX.Y.Z` |
| `@potential-guide/objective-setup-marker` | `objective-setup-marker-vX.Y.Z` |

Command wrapper packages use the `pguide-` prefix, including grouped
`pguide-regulate`. The old grouped `pguide-pilot` package is retired, with no
replacement probe/check package pre-created. Configuration is now
`@potential-guide/pguide-config` with `pguide-config-v*` tags; its executable remains
`pguide-config`. Shared libraries are not command wrappers
and keep their responsibility names.

Release packages in manifest dependency order. `effects` and `pilot-protocol`
are protocol; `objective-pilot` consumes both protocols, then
`objective-regulator` builds regulation capabilities. Checker/Objective Host
packages and their release tags are retired.
Task Engine infrastructure, protocol, SDK and builder releases belong to
[silvermoon-work/task-engine](https://github.com/silvermoon-work/task-engine).
Install its `@silvermoon-work/task-engine-cli` and
`@silvermoon-work/task-builder-cli`; this repository retains Check and Objective
task definitions and does not publish engine products.
`check-runtime-files` and `task-authoring` remain private workspace support.
`check-artifacts`, `check-task` and `probe-task` are retired from the repository, verification packs and author
examples. This does not deprecate or unpublish any historical npm version.
Publish `check-sdk` before `check-environment`, which consumes it. Both Check
packages use independent stable or RC tags and the same trusted publishing
workflow and exact-main CI gate. Their npm packages deliver author/library
code; publishing the three environment CARs to Pinboard remains a separate
operation.
The independent `regulation-coordinator` library follows `objective-regulator`
and owns its scheduling helpers and runner types. `cli-core` precedes
`pguide-config`. `objective-declarations` consumes CLI Core and Pilot protocol only;
`cli-runtime` consumes Pilot and artifact/file primitives;
the retained command packages consume it and CLI Core. Publish `pguide-config`,
`pguide-agents` and `pguide-objectives` before `pguide`, which
installs all three as production dependencies.
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
Retained packages keep their stable/RC rules, including the existing RC-only
restriction for CLI Core. The external engine's release policy is independent.
Check and Objective task definitions remain here.
`probe-sdk` uses private `ipfs-content` for Check composition and publication.
Previously published schemas and npm versions remain immutable. Removing local
engine products is not npm deprecation, unpublication or permission to publish.

## Before configuring npm

Merge `.github/workflows/publish-npm.yaml` to `main`. npm matches the workflow
by its exact filename, and release tags are rejected unless their commit is
reachable from `origin/main`.

In the GitHub repository, open **Settings → Environments**, create an
environment named `npm`, and leave it without npm secrets. Optional required
reviewers are compatible with the workflow, but any deployment branch or tag
rules must allow these release tags:

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
`pguide@<manifest-version>` and each explicitly selected retained command/config package from npm,
without overrides. The verifier accepts the same `0.x` stable/RC versions as release
tags, resolves every internal dependency from its actual parent (including nested
copies), and checks all installed versions against their selected source manifests.
It also imports the public libraries and verifies bins and runtime scenarios on
the declared operating systems:

```sh
gh workflow run ci.yaml --ref main -f published=true
```

The default local `pnpm deployment:verify` path installs those explicitly selected
CLI tarballs. It packs the release inventory plus the local runtime support
package (`check-runtime-files`), checks their contents, and uses npm
`overrides` pointing to the internal tarballs. This isolated consumer makes
unpublished RC dependencies available without requiring the main package to
depend on optional commands. `pnpm pack:check` checks packed artifact structure;
`pnpm consumers:check` additionally checks main-only
consumption: exactly five default commands, working bundled entrypoints without
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
CLI execution checks verify removed probe/check/validate/scaffold entrypoints
as unknown commands without installation advice, rather than running legacy
Probe workflows. Configuration/resource CLI and Objective package consumers
remain verified. Old regulation wrappers still reject execution; setup/self-check
CLI execution and continuation are not supported until explicitly migrated.

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
