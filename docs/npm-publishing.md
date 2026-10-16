# npm publishing

Potential Guide publishes eight CLI and library packages independently from this monorepo:

| Package | Release tag |
| --- | --- |
| `@potential-guide/effects` | `effects-vX.Y.Z` |
| `@potential-guide/git-source` | `git-source-vX.Y.Z` |
| `@potential-guide/objective-pilot` | `objective-pilot-vX.Y.Z` |
| `@potential-guide/objective-regulator` | `objective-regulator-vX.Y.Z` |
| `@potential-guide/objective-portfolio-supervisor` | `objective-portfolio-supervisor-vX.Y.Z` |
| `@potential-guide/cli-core` | `cli-core-vX.Y.Z` |
| `@potential-guide/config` | `config-vX.Y.Z` |
| `pguide` | `pguide-vX.Y.Z` |

Packages must be released in dependency order: `effects`, then `git-source`
and `objective-pilot`, then `objective-regulator` and
`objective-portfolio-supervisor`. `cli-core` must precede `config`; `pguide`
comes after all its dependencies. The three Objective packages are domain logic and
must not depend on `cli-core`; only `config` and the `pguide` composition layer
consume CLI infrastructure.

All extension packages use the `@potential-guide` npm scope. Their executable
and command names remain independent of the package name; for example,
`@potential-guide/config` installs `pguide-config` and advertises `config`.
Only the composition package is named `pguide` because it is the package users
invoke through `npx pguide`.

The tag version must exactly match that package's `package.json`, and the tagged
commit must be reachable from `origin/main`. Each tag publishes only one
package, which keeps a failure from partially publishing a multi-package
release.

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

## Before configuring npm

Merge `.github/workflows/publish-npm.yaml` to `main`. npm matches the workflow
by its exact filename, and release tags are rejected unless their commit is
reachable from `origin/main`.

In the GitHub repository, open **Settings → Environments**, create an
environment named `npm`, and leave it without npm secrets. Optional required
reviewers are compatible with the workflow, but any deployment branch or tag
rules must allow these release tags:

- `effects-v*`
- `git-source-v*`
- `objective-pilot-v*`
- `objective-regulator-v*`
- `objective-portfolio-supervisor-v*`
- `cli-core-v*`
- `config-v*`
- `pguide-v*`

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
npm publish .cache/npm-bootstrap/potential-guide-objective-portfolio-supervisor-0.0.0.tgz \
  --access public --registry=https://registry.npmjs.org/
npm publish .cache/npm-bootstrap/potential-guide-config-0.0.0.tgz \
  --access public --registry=https://registry.npmjs.org/
npm publish .cache/npm-bootstrap/pguide-0.0.0.tgz \
  --access public --registry=https://registry.npmjs.org/

npm logout --registry=https://registry.npmjs.org/
```

The `bootstrap:pack` command only creates eight minimal tarballs containing a
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

This mode skips packing, dry-run publishing and actual publishing. Its receipt
records the original package tag's source commit separately from the
verification commit. Never rerun a successful publish step to repair a
metadata propagation failure.

After every selected RC has published successfully, run the CI workflow
manually with `published=true`. Its independent consumers install the exact
manifest RC versions from npm, not local tarballs, and verify the CLI and
runtime scenarios on the declared operating systems:

```sh
gh workflow run ci.yaml --ref main -f published=true
```

If the registry is blocked by network policy, inspect package metadata through
the approved [npmx browser](https://npmx.dev/) and use the existing
GitHub-hosted workflow for authoritative registry/install verification.
Do not disable TLS checks, change local routing, or use an unapproved proxy
to bypass the policy.
