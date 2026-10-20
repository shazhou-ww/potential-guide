# Package layers and CLI migration

## Exactly three layers

| Layer | Packages |
| --- | --- |
| Protocol | `@potential-guide/effects`, `@potential-guide/pilot-protocol` |
| Business logic | `@potential-guide/objective-pilot`, `@potential-guide/objective-regulator`, `@potential-guide/objective-portfolio-supervisor` |
| Tools | `pguide`, `@potential-guide/cli-core`, `@potential-guide/pguide-config`, `@potential-guide/pguide-agents`, `@potential-guide/cli-runtime`, `@potential-guide/objective-declarations`, `@potential-guide/pguide-pilot`, `@potential-guide/pguide-regulate`, `@potential-guide/pguide-supervise`, `@potential-guide/pguide-objectives` |

Allowed dependencies point downwards, or stay within a layer. Tools can consume
protocol directly. Same-layer dependencies are permitted, not special exceptions;
ordinary workspace/build cycle restrictions still apply.

`effects` remains executable protocol primitives, not an empty types package.
`pilot-protocol` contains the canonical Pilot contract types, manifest and
reference parsing/validation, schema compilation, bounded subject projection and
resource-resolver capability interfaces. Loading a definition uses an injected
resolver; it does not fetch sources, run checks, observe or invoke Agents.
`objective-pilot` retains observation, probes and execution evidence and reexports
its former definition APIs from the protocol package for compatibility.

`cli-core` owns CLI output/options, configuration, persistence and Agent clients.
`cli-runtime` assembles Git-backed resources. `objective-declarations` shares
declaration selection and subject binding using CLI Core and protocol only,
without installing execution. Neither service has command bins or depends on
any command package.
The regulation tool package owns Agent execution and process workers; supervision
uses its public API, never the reverse. Declaration mutation stays in
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
`pguide-pilot` groups Pilot authoring/validation/observation; `pguide-regulate`
groups regulation and continuation. Shared libraries retain responsibility names
(`cli-runtime`, `objective-declarations`). Configuration now follows the same
convention as `@potential-guide/pguide-config`; its existing `pguide-config`
binary and `config` metadata remain unchanged.

| Install | Commands / standalone binaries |
| --- | --- |
| `pguide` | discovery, dispatch, built-in `diagnose`, `complete`; installs Pilot, config and objectives commands below |
| `@potential-guide/pguide-pilot` | `probe`, `scaffold`, `validate` / `pguide-probe`, `pguide-scaffold`, `pguide-validate` |
| `@potential-guide/pguide-regulate` | `regulate`, `continue` / `pguide-regulate`, `pguide-continue` |
| `@potential-guide/pguide-supervise` | `supervise` / `pguide-supervise` |
| `@potential-guide/pguide-objectives` | `objectives` / `pguide-objectives` |
| `@potential-guide/pguide-config` | `config` / `pguide-config` |
| `@potential-guide/pguide-agents` | `agents` / `pguide-agents` |

Pilot authoring, validation and observation share source/definition conventions.
Regulation and continuation share persisted state and Agent execution. These
closely cooperating commands ship together; supervision remains optional.
Declaration management is included by default so aliases can be managed alongside probing.

`pguide` ships only its own entrypoint bin, but installs `pguide-pilot`,
`pguide-config`, `pguide-agents` and `pguide-objectives` as production dependencies. Its default
commands are `probe`, `scaffold`, `validate`, `config`, `objectives`, `diagnose`,
and `complete`. Regulation and supervision still require explicit installation:

```sh
npm install --global pguide
pguide validate pilot ./objective
```

For an existing source checkout, run `pnpm clean`, then `pnpm install` and
`pnpm check` so old compiler outputs are not mistaken for current package files.
Packing rejects stale JavaScript outputs with no corresponding source.

For local installations use `pnpm exec pguide ...` or put the installation's
`node_modules/.bin` on PATH. One-shot invocation includes the default commands:

```sh
npx pguide probe --help
```

Append explicit `@<version>` selectors for RC testing. Merely running
`npx pguide probe` installs Pilot support implicitly. Standalone bins require
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

`config/package-layers.json` explicitly classifies every workspace. Unknown,
duplicate or missing assignments fail `pnpm layers:check`, the first step of
`pnpm check`. The checker covers all package dependency fields and production
imports/reexports (including type imports, import types, dynamic imports,
CommonJS, npm/TypeScript path aliases and cross-package relative/file paths). Generated `dist`,
dependency directories and test fixtures are not production origins.

`scripts/check-layers.test.mjs` exercises valid downward/direct-protocol/same-layer
edges and rejects reverse/deferred-concrete/unknown edges, including actual
temporary workspace manifests and relative source/type references.
All scratch data stays under repository `.cache`.

`pnpm pack:check` builds and packs the release inventory, checks exports and bins,
then installs eight isolated tarball consumers: protocol-only,
main-only, each standalone command package, and all commands together.
The default packed `pnpm deployment:verify` runs these same eight combinations
before its npm runtime scenarios, so the existing Ubuntu/macOS/Windows deployment
CI matrix executes them too; published/latest verification remains registry-based.
Internal transitive versions are resolved from each real installed parent,
including pnpm's physical symlink layout. Protocol-only consumption installs no
business packages; main-only consumption installs Pilot, config and objectives but no
regulation, supervision or declaration-management packages. Its exact six-command
surface and bundled fallback run without transitive bins on PATH. Combination
installs verify real generated command shims,
metadata, discovery and dispatch without ambient global extensions. On POSIX,
the isolated shim toolchain includes the standard shell utilities pnpm shims need.
CLI integration tests retain execution, permissions, evidence, persistence,
source revision and supervisor coverage. See [npm publishing](./npm-publishing.md)
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
inventory. `config/package-layers.json` remains the independent three-layer policy.

Declaration parsing, input validation, bounded projection and domain binding are
canonical `pilot-protocol` APIs (`parseObjectives`, `projectObjective`,
`bindObjective`). `objective-pilot` preserves compatibility reexports.
`objective-declarations` only adds tool-side file discovery and Git context; it
does not depend on business execution.
