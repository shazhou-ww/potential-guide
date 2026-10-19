# Credential-free self-check Docker harness

Validates the existing `packages/pguide-self-check-pilot` through a **source-built,
packed, installed** pguide in Linux. No real model, credentials, user config,
host HOME, host environment forwarding, bind mounts, or Docker socket. This is
controlled ACP integration evidence, **not** real-device/model acceptance.

## Prepare and build (PowerShell, repository root)

Choose an explicit, full committed source revision. Preparation does not invoke
Docker: it writes a new, minimal context using `git archive`, then copies only
the nine named harness files. Uncommitted source edits and untracked files
(including `.env`, `node_modules`, and credentials) cannot enter the source
archive. Harness edits may be uncommitted; their hashes are recorded separately.
Do not build with the repository root as context.

```powershell
$revision = (git rev-parse HEAD).Trim()
$suffix = $revision.Substring(0, 12) + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$context = Join-Path '.cache' "pilot-docker-$suffix"
$image = "pguide-pilot-migration:$suffix"
node scripts\prepare-self-check-docker.mjs $revision $context
docker build --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 -t $image $context
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

The Objective repository now includes both complete setup and self-check Pilot
packages. The setup package's embedded sanity fixture and generated transport
runtime stay with its manifest. Development dependencies and package tests are
excluded from this repository copy.

## Create a reusable container, then verify

The image defaults to UID 1000 (`node`), HOME `/work/home`, and `sleep infinity`.
No host settings are changed. These limits apply to this named container only;
do not stop, inspect credentials from, or remove other users' containers.

```powershell
$container = "pguide-pilot-migration-$suffix"
docker run -d --name $container --network none --cap-drop ALL --security-opt no-new-privileges --cpus 2 --memory 1g --memory-swap 1g --pids-limit 128 $image
docker exec $container node --version
docker exec $container node /harness/verify.mjs fix
docker exec $container node /harness/verify.mjs wrong
docker exec $container node /harness/verify.mjs summary-only
docker exec $container node /harness/verify.mjs fix setup
docker exec $container node /harness/verify.mjs wrong setup
docker exec $container node /harness/verify.mjs summary-only setup
docker inspect --format '{{.Config.User}} {{.HostConfig.NetworkMode}} {{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}} {{json .Mounts}}' $container
```

The earlier `pguide-self-check-811f28d-7dd2` has already been retained with all
three self-check probe results. Inspect its existing evidence rather than
rerunning prompts just to confirm; the older `pguide-self-check-7dd2b7ee` is also
preserved, not replaced. The migration commands above use a distinct source-pinned
image/container and need the new setup-capable verifier; do not run them against
either retained historical image.
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

The optional second argument `setup` switches to the committed setup package,
uses a 20000 ms check budget and explicitly sets `allowSanity: true` for this
credential-free fixture only. It verifies the existing nested regulation repair
and independent marker recheck. The default remains self-check with its direct
Agent repair and no consent/target input. Neither mode uses a real account or
paid model; Linux fixture evidence does not prove Windows nested-probe readiness
or SSH identity/authentication on an external device.

The container stays running for reuse; `/work` is its writable layer (no
mounts). To independently inspect evidence, use `docker exec ... cat` with the
printed run path or `docker cp <container>:/work/runs <chosen-local-directory>`.
Parent/operator owns verification, approvals and lifecycle. When intentionally
finished, remove **only** this container/image by their exact names.

## Real Agent baseline (separate, opt-in target)

The default `runtime` target above remains credential-free and uses a fixture.
Build `--target real-agent` to additionally install the pinned official Copilot
CLI (`COPILOT_VERSION=1.0.98`) and the real ACP baseline runner.
Automatic CLI updates are disabled for this target and its ACP child processes.

```powershell
docker build --target real-agent --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 -t $image $context
docker run -d --name $container --cap-drop ALL --security-opt no-new-privileges --cpus 2 --memory 2g --memory-swap 2g --pids-limit 256 $image
docker exec $container copilot --version
docker exec $container node /harness/keychain.mjs
docker exec -it $container /harness/keychain-unlock.sh
docker exec -it $container copilot login --device-code
docker exec $container node /harness/real-agent.mjs --mode discover
docker exec $container node /harness/real-agent.mjs --model <advertised-model-id>
```

Use a distinct image/container name from fixture verification. This target needs
network access for independent official login and model requests, but publishes
no ports and mounts no host directories, credentials, Docker socket or source.
Do not pass host tokens, HOME, npm configuration or inherited environment.
The entrypoint supervises a private user D-Bus; secure unlock starts GNOME
Secret Service on that bus. Status inspection does not autoactivate a locked
daemon before the first password has initialized the encrypted keyring. The bus
uses a user-owned mode-0700 runtime directory and a Unix socket, not TCP.
Initialize/unlock the encrypted keychain in your own interactive terminal with
`keychain-unlock.sh`; enter and confirm a nonempty password. The helper does not
echo it, accept it as an argument/environment variable, or write it to a file.
Do not send that password to the Agent or put it in shell history.
The master password is not retained; after restarting the container, unlock again
with the same password before login or model requests. Empty passwords, silent
auto-unlock and plaintext credential fallback are not configured.
Unlock deliberately replaces only this container's Secret Service daemon, so
initialize/unlock before starting Agent work, not during a running request.
The daemon runs in a detached session with no terminal descriptors. Unlock waits
for a new D-Bus owner to become unlocked, rather than accepting the old owner's
state while replacement is still pending. Disposable verification runs the
interactive helper through a real pseudo-terminal and checks that unlocking
survives its closure.
The real Agent baseline refuses to start while the collection is missing or
locked, and explicitly forwards only the container's HOME, private D-Bus address
and runtime directory to the ACP child.

Authenticate directly inside the named container. Device codes may be relayed
to the user when explicitly requested, but must not be copied into durable
reports. Require successful keychain storage, not just browser authorization;
do not accept Copilot's plaintext fallback. Never commit/export that authenticated
container as an image, copy its HOME/keyrings, or collect its credential files as evidence.
Keep it private and remove only that named container when intentionally finished.

Model discovery is **not** a passing baseline. It returns `discovered` and zero
prompts. Verification requires an explicitly selected, advertised model and a
matching session result before one real task. Only `ready` means that the real
Agent returned an explicit `end_turn`, no requested permission was denied, and
an independent check verified the exact random contents of a regular, non-linked,
single-hard-link marker file. Writes are preauthorized only for that absolute
marker path; shell and URL tools and automatic temp-directory access are denied.
Any other permission request is rejected, not silently granted.

Each run has a maximum 120-second Agent diagnostic budget and a 192 KiB ACP
output bound. This does **not** change the Pilot's 24-second limit: even a
successful longer baseline is not a full self-check terminal result or acceptance.
There are no model substitutions or automatic retries. Authentication, model
mismatch, timeout, false repairs and cleanup errors fail explicitly and produce
a nonzero exit. The runner deletes only its task and retains
`/work/runs/real-agent-*/baseline.json`, with fixed error classifications and no
prompt, nonce, model text, token or raw server error.

**Gate subsequent validation on a real `ready` report from this container.**
Do not start another pguide self-check merely because the image built, the CLI
printed its version, login succeeded, or `discover` returned a model list.
Re-run the baseline after a material Agent/model/authentication change; do not
interpret a retained report as permanent readiness.

### Disposable keychain verification

Before using the real container, verify Secret Service with a fresh, disposable
instance of the same image:

```powershell
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges -e PGUIDE_KEYCHAIN_SELF_TEST=1 $image node /harness/keychain.mjs --self-test
```

This uses only random, generated test material, refuses an existing collection,
and verifies a store/read/clear round-trip, a private encrypted keyring file
without plaintext test material, rejection of an incorrect password, and
lock/unlock using the same in-memory test password. It never logs that password
or copies any keyring. Do not run this
test in an authenticated container. A passing keychain test is not a real-model
baseline.

### Host-only tests

`node --test scripts\prepare-self-check-docker.test.mjs` validates context
construction without Docker. The existing `scripts/*.test.mjs` default test
path includes it; `pnpm check` never starts Docker.
