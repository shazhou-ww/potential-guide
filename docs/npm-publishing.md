# npm publishing

Potential Guide publishes three independent public packages from this monorepo:

| Package | Release tag |
| --- | --- |
| `@potential-guide/objective-guide` | `objective-guide-vX.Y.Z` |
| `@potential-guide/objective-regulator` | `objective-regulator-vX.Y.Z` |
| `@potential-guide/objective-portfolio-supervisor` | `objective-portfolio-supervisor-vX.Y.Z` |

The tag version must exactly match that package's `package.json`, and the tagged
commit must be reachable from `origin/main`. Each tag publishes only one
package, which keeps a failure from partially publishing a multi-package
release.

## Before configuring npm

Merge `.github/workflows/publish-npm.yaml` to `main`. npm matches the workflow
by its exact filename, and release tags are rejected unless their commit is
reachable from `origin/main`.

In the GitHub repository, open **Settings → Environments**, create an
environment named `npm`, and leave it without npm secrets. Optional required
reviewers are compatible with the workflow, but any deployment branch or tag
rules must allow these release tags:

- `objective-guide-v*`
- `objective-regulator-v*`
- `objective-portfolio-supervisor-v*`

## Create the npm package records

On npmjs.com, open the `potential-guide` organization and create these three
public package records:

- `@potential-guide/objective-guide`
- `@potential-guide/objective-regulator`
- `@potential-guide/objective-portfolio-supervisor`

Create only the package records. Do not manually publish a placeholder or the
`0.1.0` product version, and do not create an npm automation token.

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

Configure the publishers only when the `0.1.0` release can run immediately.
Each connection expires if it does not complete a successful publish within two
days. A dry-run can diagnose the connection but does not satisfy that deadline.

## Publish the first product versions

After creating all three package records and Trusted Publishers, publish in
dependency order. Wait for each workflow to succeed before creating the next
tag:

```sh
git fetch origin main --tags
git switch main
git pull --ff-only origin main

git tag -a objective-guide-v0.1.0 -m "release: objective-guide v0.1.0"
git push origin refs/tags/objective-guide-v0.1.0

git tag -a objective-regulator-v0.1.0 -m "release: objective-regulator v0.1.0"
git push origin refs/tags/objective-regulator-v0.1.0

git tag -a objective-portfolio-supervisor-v0.1.0 \
  -m "release: objective-portfolio-supervisor v0.1.0"
git push origin refs/tags/objective-portfolio-supervisor-v0.1.0
```

Use `gh run list --workflow publish-npm.yaml` and
`gh run watch <run-id> --exit-status` after each push. Do not move or reuse a
pushed release tag.

The workflow also supports a manual package-specific dry-run from GitHub's
**Actions → Publish package to npm → Run workflow** UI or the CLI:

```sh
gh workflow run publish-npm.yaml --ref main -f package=objective-guide
```

Use the dry-run only as a quick diagnostic, then perform the real tag release
within the two-day window.

After every package has one successful OIDC release, set its npm **Publishing
access** to **Require two-factor authentication and disallow tokens**. Trusted
Publishing continues to work with that setting.

## Verify a release

Registry propagation can take a short time. Do not repeat a publish while
waiting. Verify the immutable version and `latest` tag:

```sh
npm view "@potential-guide/objective-guide@0.1.0" \
  name version dist-tags exports engines dist \
  --json --registry=https://registry.npmjs.org/
```

Repeat for the other packages and confirm that npm displays provenance linking
the release to this repository and workflow. If the npm registry is blocked by
network policy, perform CLI verification on an approved device or use the
npmjs.com package pages; do not use a proxy or mirror to bypass the policy.
