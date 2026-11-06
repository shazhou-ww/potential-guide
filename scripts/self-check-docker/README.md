# Isolated consumer and real-Agent Docker harness

Builds a **source-built, packed, installed** pguide consumer in Linux and
provides a separate opt-in real-Agent baseline. The old full-Pilot CLI verifier
is retired. No host HOME, environment forwarding, bind mounts or Docker socket
are imported into the base consumer. Real-Agent credentials remain an explicitly
authorized, separate concern and are not part of ordinary image validation.

## Prepare and build (PowerShell, repository root)

Choose an explicit, full committed source revision. Preparation does not invoke
Docker: it writes a new, minimal context using `git archive`, then copies only
the seven named harness files. Uncommitted source edits and untracked files
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
through the root TypeScript project references, then runs the UI package's
existing build script to produce its esbuild server/browser bundles and
Tailwind stylesheet, without installing or substituting Turbo.
The isolated `/toolchain` compiler installation pins
TypeScript 5.9.3, `@types/node` 22.20.5, `@types/cross-spawn` 6.0.6 and
`undici-types` 6.21.0, also with lifecycle scripts disabled. Before installing
the toolchain, the build reads the selected source catalog using the production
`yaml` dependency of objective-pilot and rejects mismatched compiler/Node/
cross-spawn declaration versions. This does not change source manifests or
the source lockfile.
The source catalog also supplies `@types/semver`, linked into the source type
root for compiling the runtime-version policies.
UI build dependencies use their exact existing source catalog versions:
`esbuild`, `@tailwindcss/cli`, `tailwindcss`, `tw-animate-css`,
`@types/react`, `@types/react-dom`, `@types/jsdom`, `jsdom`, and `linkedom`.
The last three are needed because the UI's TypeScript project includes tests
and fixtures. They are linked only into the build-stage UI workspace;
the toolchain's bin directory supplies `tsc` and `tailwindcss` to the existing
build script. No package versions or source manifests are changed.
The script is invoked with `npm --prefix ... run build`, which runs the existing
manifest command without installing source workspace development dependencies.
Required-file checks still reject missing server declarations, browser
JavaScript, HTML or CSS before the UI tarball is packed.

It then packs every release package, installs an explicitly selected CLI-command consumer with local tarball
overrides, and verifies the complete internal dependency graph using the
deployment consumer helpers. It never publishes or fetches a replacement
published pguide/internal package. Consumer third-party resolution and apt
repositories are not hermetically pinned; the installed npm lock hash is
recorded, not a claim of byte-identical images. Provenance also records
`buildMethod: frozen-prod-plus-tsc-and-ui-build`, the exact toolchain
versions and its separate npm lockfile SHA-256. The toolchain is not covered by
the repository's frozen install. This build is **not** a full repository
`pnpm check`; the parent/operator runs repository checks independently.

Only the installed consumer, self-check Objective Git repository, and harness
tools cross into the runtime stage—not the source workspace, build dependency
tree, isolated toolchain, pnpm store, or tarballs. The Objective is committed during construction
with fixed Git dates; provenance records both the original source revision and
the separate copied Objective revision, not proof of a current CLI probe.

The Objective repository now includes both complete setup and self-check Pilot
packages. The setup package's embedded sanity fixture and generated transport
runtime stay with its manifest. Development dependencies and package tests are
excluded from this repository copy.

## Retired legacy CLI verification

The old full-Pilot `probe` verifier and its deterministic ACP fixture are
retired along with `pguide-pilot`. Do not invoke `/harness/verify.mjs` or
interpret historical setup/self-check evidence as a current CLI capability.
Existing historical containers and evidence are not removed by this change.

The image preparation and the separate real-Agent/keychain baseline below
remain available. They do not prove Task Bundle migration of the setup or
self-check Objectives. The generic CLI/SDK consumers and repository tests
verify current command discovery, with no legacy probe executable.

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
