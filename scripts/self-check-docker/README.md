# Credential-free self-check Docker harness

Validates the existing `objectives/pguide-self-check` through a **source-built,
packed, installed** pguide in Linux. No real model, credentials, user config,
host HOME, host environment forwarding, bind mounts, or Docker socket. This is
controlled ACP integration evidence, **not** real-device/model acceptance.

## Prepare and build (PowerShell, repository root)

Choose an explicit, full committed source revision. Preparation does not invoke
Docker: it writes a new, minimal context using `git archive`, then copies only
the five named harness files. Uncommitted source edits and untracked files
(including `.env`, `node_modules`, and credentials) cannot enter the source
archive. Harness edits may be uncommitted; their hashes are recorded separately.
Do not build with the repository root as context.

```powershell
$revision = '811f28d802028b8c5a82337a47f9b111d83cedb6'
node scripts\prepare-self-check-docker.mjs $revision .cache\self-check-docker-context-811f28d-7dd2
docker build --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 -t pguide-self-check:811f28d-7dd2 .cache\self-check-docker-context-811f28d-7dd2
```

Use a fresh context name on subsequent preparations; existing directories are
rejected rather than mixed with previous inputs. Keep/archive the context
provenance if needed, then delete the context explicitly after building.
`NODE_IMAGE` defaults to `node:22-bookworm-slim`; pin a digest for repeat builds.
The build needs public Debian/npm network access, but no authentication.
If direct npm access is blocked, explicitly pass an existing approved HTTPS
registry with `--build-arg NPM_REGISTRY=https://approved-registry/`. Do not pass
credentials, copy host npm configuration, disable TLS verification, or use an
unapproved mirror. This setting exists only in the build stage; the runtime
container still has no network or registry configuration.
It installs pnpm 11.22.0 and only production workspace dependencies using the
frozen source lockfile with lifecycle scripts disabled. It builds all packages
through the root TypeScript project references, without installing or
substituting Turbo. The isolated `/toolchain` compiler installation pins
TypeScript 5.9.3, `@types/node` 22.20.5, `@types/cross-spawn` 6.0.6 and
`undici-types` 6.21.0, also with lifecycle scripts disabled. Before installing
the toolchain, the build reads the selected source catalog using the production
`yaml` dependency of objective-pilot and rejects mismatched compiler/Node/
cross-spawn declaration versions. This does not change source manifests or
the source lockfile.

It then packs every release package, installs an entry-only consumer with local tarball
overrides, and verifies the complete internal dependency graph using the
deployment consumer helpers. It never publishes or fetches a replacement
published pguide/internal package. Consumer third-party resolution and apt
repositories are not hermetically pinned; the installed npm lock hash is
recorded, not a claim of byte-identical images. Provenance also records
`buildMethod: frozen-prod-plus-tsc-project-references`, the exact toolchain
versions and its separate npm lockfile SHA-256. The toolchain is not covered by
the repository's frozen install. This build is **not** a full repository
`pnpm check`; the parent/operator runs repository checks independently.

Only the installed consumer, self-check Objective Git repository, and harness
tools cross into the runtime stage—not the source workspace, build dependency
tree, isolated toolchain, pnpm store, or tarballs. The Objective is committed during construction
with fixed Git dates; provenance records both the original source revision and
the separate Objective revision actually passed to the probe.

## Create a reusable container, then verify

The image defaults to UID 1000 (`node`), HOME `/work/home`, and `sleep infinity`.
No host settings are changed. These limits apply to this named container only;
do not stop, inspect credentials from, or remove other users' containers.

```powershell
docker run -d --name pguide-self-check-811f28d-7dd2 --network none --cap-drop ALL --security-opt no-new-privileges --cpus 2 --memory 1g --memory-swap 1g --pids-limit 128 pguide-self-check:811f28d-7dd2
docker exec pguide-self-check-811f28d-7dd2 node --version
docker exec pguide-self-check-811f28d-7dd2 node /harness/verify.mjs fix
docker exec pguide-self-check-811f28d-7dd2 node /harness/verify.mjs wrong
docker exec pguide-self-check-811f28d-7dd2 node /harness/verify.mjs summary-only
docker inspect --format '{{.Config.User}} {{.HostConfig.NetworkMode}} {{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}} {{json .Mounts}}' pguide-self-check-811f28d-7dd2
```

The named container above has already been retained with all three probe
results. Inspect its existing evidence rather than rerunning prompts just to
confirm. Choose distinct image/container names to create another instance;
the older `pguide-self-check-7dd2b7ee` is also preserved, not replaced.
Recorded source revisions are not a claim that later HEAD revisions were built.
Parent-owned provenance and results are in the Idea's
[Docker validation evidence](../../.silvermoon/ideas/01M5669R0P9ZK68XCGDD51ZNNA/outer/inner/Docker-validation.md).

Each verifier invocation runs **one full probe, with exactly one prompt**. Do
not repeat `fix` merely to confirm the same outcome. Numeric ACP initialize,
session/new and session/prompt are handled by a deterministic local fixture.
Configuration/readiness handshakes do not count as prompts. `fix` writes the
requested marker nonce; `wrong` writes wrong content; `summary-only` reports
success but never repairs the marker. Negative modes must remain `configured`
with `sanity-failed`; only `fix` may reach `terminal` with no problems.

Each run gets new absolute Linux config/subject/scratch paths below
`/work/runs/<mode>-*`, a 24000 ms self-check budget, and an allowlisted child
environment. Neither `allowSanity` nor `target` is supplied. The verifier checks
the snapshot revision, exactly one safe prompt-count record, deletion of all
owned task scratch, and preservation of an unrelated scratch sentinel.
It writes `probe.json`, `prompts.jsonl` (mode/count only), and
`verification.json` beside the config and subject, then prints the report.
The fixture stores no prompt text or nonce. Assertions exit nonzero on any
mismatch; do not interpret a helper-only result as a full probe.

The container stays running for reuse; `/work` is its writable layer (no
mounts). To independently inspect evidence, use `docker exec ... cat` with the
printed run path or `docker cp <container>:/work/runs <chosen-local-directory>`.
Parent/operator owns verification, approvals and lifecycle. When intentionally
finished, remove **only** this container/image by their exact names.

## Host-only tests

`node --test scripts\prepare-self-check-docker.test.mjs` validates context
construction without Docker. The existing `scripts/*.test.mjs` default test
path includes it; `pnpm check` never starts Docker.
