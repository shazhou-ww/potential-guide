# Package layers and CLI migration

## Exactly three layers

| Layer | Packages |
| --- | --- |
| Protocol | `@potential-guide/effects`, `@potential-guide/pilot-protocol` |
| Business logic | `@potential-guide/objective-pilot`, `@potential-guide/objective-regulator`, `@potential-guide/regulation-coordinator` |
| Tools | `pguide`, `@potential-guide/cli-core`, `@potential-guide/pguide-config`, `@potential-guide/pguide-agents`, `@potential-guide/cli-runtime`, `@potential-guide/objective-declarations`, `@potential-guide/pguide-regulate`, `@potential-guide/pguide-objectives` |

Allowed dependencies point downwards, or stay within a layer. Tools can consume
protocol directly. Same-layer dependencies are permitted, not special exceptions;
ordinary workspace/build cycle restrictions still apply.

The Check author library `@potential-guide/check-sdk` belongs to business logic,
alongside `check-environment`. Its runtime root contains only result/callback
adaptation, its `contracts` subpath owns TypeBox Schemas, and its `authoring`
subpath prepares validated Task inputs. Only the environment build script and
the SDK's independent example build script may consume Task Bundle tooling
through the explicit development-tool policy; the shared SDK never embeds that
compiler or imports a concrete check. Generic Task SDK/Engine packages do not
depend on Check business rules.

`regulation-coordinator` is an independent scoped command-to-fact service. Its
helpers and public resource/runner types are owned locally, and ranking comes
from Pilot. Portfolio Supervisor and its command are [retired](./supervisor-retirement.md),
not redirected to the new service.

`effects` remains executable protocol primitives, not an empty types package.
`pilot-protocol` contains the canonical Pilot contract types, manifest and
reference parsing/validation, schema compilation, bounded subject projection and
resource-resolver capability interfaces. Loading a definition uses an injected
resolver; it does not fetch sources, run checks, observe or invoke Agents.
`objective-pilot` retains observation, probes and execution evidence and reexports
its former definition APIs from the protocol package for compatibility.

`cli-core` owns CLI output/options, configuration, persistence and Agent clients.
`cli-runtime` retains explicit npm package preparation and retired-execution diagnostics.
`objective-declarations` shares
declaration selection and subject binding using CLI Core and protocol only,
without installing execution. Neither service has command bins or depends on
any command package.
The regulation tool package owns Agent execution and process workers.
Declaration mutation stays in
`pguide-objectives`, not business logic or the shared selection module.

**Deferred externalization, not a fourth layer:** `@potential-guide/git-source`,
`@potential-guide/objective-devbox-health`,
`@potential-guide/objective-monorepo-standard`,
`@potential-guide/objective-pguide-setup`,
`@potential-guide/objective-pguide-self-check`.
They remain in this workspace. This change does not choose repositories, migrate
their source or alter their independent maintenance. Tools may consume Git
source; the three layers must not depend on concrete Objective implementations.

## Default and optional command packages

Command-wrapper npm packages follow `@potential-guide/pguide-<command-or-group>`.
`pguide-pilot` and its old probe/scaffold/validate commands are retired;
no probe/check placeholder package is created. `pguide-regulate` retains
legacy regulation/continuation rejection wrappers. Shared libraries retain responsibility names
(`cli-runtime`, `objective-declarations`). Configuration now follows the same
convention as `@potential-guide/pguide-config`; its existing `pguide-config`
binary and `config` metadata remain unchanged.

| Install | Commands / standalone binaries |
| --- | --- |
| `pguide` | discovery, dispatch, built-in `diagnose`, `complete`; installs config, agents and objectives commands below |
| `@potential-guide/pguide-regulate` | `regulate`, `continue` / `pguide-regulate`, `pguide-continue` |
| `@potential-guide/pguide-objectives` | `objectives` / `pguide-objectives` |
| `@potential-guide/pguide-config` | `config` / `pguide-config` |
| `@potential-guide/pguide-agents` | `agents` / `pguide-agents` |

Declaration and Agent resource management remain included by default without
the removed execution and static artifact-validation commands. New Task Bundle
authoring/checking and configuration validation remain separate supported surfaces.

`pguide` ships only its own entrypoint bin, but installs `pguide-config`,
`pguide-agents` and `pguide-objectives` as production dependencies. Its five default
commands are `agents`, `config`, `objectives`, `diagnose` and `complete`.
Regulation still requires explicit installation and rejects legacy execution:

```sh
npm install --global pguide
pguide config path
```

For an existing source checkout, run `pnpm clean`, then `pnpm install` and
`pnpm check` so old compiler outputs are not mistaken for current package files.
Packing rejects stale JavaScript outputs with no corresponding source.

For local installations use `pnpm exec pguide ...` or put the installation's
`node_modules/.bin` on PATH. One-shot invocation includes the default commands:

```sh
npx pguide config --help
```

Append explicit `@<version>` selectors for RC testing. Merely running
`npx pguide config` installs configuration support implicitly. Standalone bins require
explicit installation of their command package; transitive bins need not be
exposed by npm or pnpm. Discovery uses configured directories before PATH, excludes the cwd
PATH entry, deduplicates real paths, diagnoses same-tier conflicts and requires
`pguide-command-v1`. Only when neither an external candidate nor a conflict exists,
default commands fall back to the installed dependencies' public bin subpath
exports, resolved with `import.meta.resolve` and executed by the current Node
runtime. Structured help and diagnosis report source `bundled`; missing dependency
files are errors, not silently missing commands. Explicitly installing the same
command packages alongside `pguide` creates no synthetic conflicts. External
incompatible commands and conflicts are never bypassed by the fallback.
A missing optional official command identifies the package to install.
Global options, stdin, cancellation, JSON/Markdown envelopes, passthrough
arguments and exit codes retain their existing behavior.

### Configuration package rename

The old published name `@potential-guide/config` is retired in this source tree;
existing published versions are not renamed or unpublished. Replace explicit
dependencies/install scripts with `@potential-guide/pguide-config`, remove the
old global/local package and regenerate the lockfile. Do not install both names:
they expose the same binary. A default `pguide` installation needs neither name
listed explicitly. Releases now use `pguide-config-v*`, not the historical
`config-v*` tags; npm Trusted Publishing must be configured for the new name.

## Independent protocol consumption

```sh
npm install @potential-guide/pilot-protocol
```

```js
import {
  parseManifest, compileDomain, validateSubject,
} from "@potential-guide/pilot-protocol";

const definition = parseManifest(manifestYaml);
const issues = validateSubject(subject, compileDomain(definition.subjectSchema));
```

This installation has no dependency on business logic, tools, or `effects` when
its primitives are not used. Direct subpaths `types`, `validation`, `resources`
and `projection` are supported; there is one canonical implementation.

## Enforcement and verification

Root `package-layers.yaml` explicitly classifies every workspace. The repository
`standardize` subject opts in with `policy.packageLayers: "package-layers.yaml"`.
The `objective-monorepo-standard` structure phase owns this cross-package
architecture check; an unreadable/invalid policy or unknown, duplicate or missing
assignment blocks structure before package dependency probes.
`pnpm layers:check`, after generated-source validation in `pnpm check`, is a thin adapter to the same
bundled implementation, not an independent rule engine.
The checker uses actual pnpm workspace discovery and covers all package dependency fields and production
imports/reexports (including type imports, import types, dynamic imports,
CommonJS, npm/TypeScript path aliases and cross-package relative/file paths). Generated `dist`,
dependency directories and test fixtures are not production origins.

The optional `developmentTools` policy maps a tools-layer package to exact
non-`src` build-script paths. Listed tools may be declared in `devDependencies`
by lower-layer packages for authoring and tests. Only the listed scripts may
import them, and only with that direct development dependency; runtime
dependencies and imports under `src/` remain forbidden. This permits repository
Bundle fixtures and `check-environment/build.mjs` to use
`@potential-guide/pguide-task-bundle` without coupling the Worker SDK or runtime
packages to an author command. Bundle budgets, paths and declaration/file
inspection belong to `task-protocol`; local directory acquisition uses native
Node file APIs in the author/runtime consumers, and Node version comparison
uses `semver`. Check portable names use `sanitize-filename` without rewriting
artifact identity. The former `artifact-files` workspace is retired rather
than replaced by a generic filesystem or declaration utility layer.

`packages/objective-monorepo-standard/test/package-layers.test.mjs` exercises valid downward/direct-protocol/same-layer
edges and rejects reverse/deferred-concrete/unknown edges, including actual
temporary workspace manifests and relative source/type references.
All scratch data stays under repository `.cache`.

`pnpm pack:check` builds and packs the release inventory and checks artifact
structure, exports and bins. `pnpm consumers:check` additionally installs isolated tarball consumers: protocol-only,
main-only, each standalone command package, and all commands together.
The default packed `pnpm deployment:verify` runs these same combinations
before its npm runtime scenarios, so the existing Ubuntu/macOS/Windows deployment
CI matrix executes them too; published/latest verification remains registry-based.
The Node 22/24 matrix runs default checks without repeating these installs.
The publishing workflow explicitly runs `pnpm consumers:check` after `pnpm check`
to preserve its full pre-release consumer gate; neither validation command publishes.
Internal transitive versions are resolved from each real installed parent,
including pnpm's physical symlink layout. Protocol-only consumption installs no
business packages; main-only consumption installs Pilot, config and objectives but no
regulation packages. Its default command
surface and bundled fallback run without transitive bins on PATH. Combination
installs verify real generated command shims,
metadata, discovery and dispatch without ambient global extensions. On POSIX,
the isolated shim toolchain includes the standard shell utilities pnpm shims need.
CLI integration tests retain execution, permissions, evidence, persistence,
source revision and Supervisor retirement coverage. See [npm publishing](./npm-publishing.md)
for package-specific release tags. No package is published by these checks.

Internal packages are always resolved to the current local tarballs. Third-party
dependencies use `--prefer-offline`, allowing registry downloads when a fresh
consumer resolves a compatible version absent from the store; the checks do not
assume that a developer's warmed cache is available in CI.

## Package-owned repository governance

Repository preparation uses the root `objectives.yaml` and each workspace's own
`objectives.yaml`, not a restored central `config/monorepo-requirements.json`.
All nineteen workspaces, including the seven extracted packages, own their
dependency intent, entrypoints and delivery joins. The root declaration retains
joint delivery requirements and includes the complete fifteen-package release
inventory. Root `package-layers.yaml` declares the three-layer architecture policy,
enforced by the repository standardization Objective.

Declaration parsing, input validation, bounded projection and domain binding are
canonical `pilot-protocol` APIs (`parseObjectives`, `projectObjective`,
`bindObjective`). `objective-pilot` preserves compatibility reexports.
`objective-declarations` only adds tool-side file discovery and Git context; it
does not depend on business execution.
