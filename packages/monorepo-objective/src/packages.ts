import { dirname, relative, resolve, sep } from "node:path";
import type { Contract } from "./contract.js";
import { checkDelivery } from "./delivery.js";
import { sourceImports } from "./imports.js";
import {
  type Add,
  dependencyGroups,
  matches,
  nodeImports,
  type RecordValue,
  record,
  resolveSource,
  type Snapshot,
  type State,
  secretPath,
  taskFor,
  texts,
  under,
} from "./shared.js";
import { checkTaskGraph } from "./task-graph.js";
export async function checkPackages(
  snapshot: Snapshot,
  contract: Contract,
  manifests: Map<string, RecordValue>,
  tasks: RecordValue,
  workspaceConfig: RecordValue,
  inventory: string[],
  add: Add,
) {
  const byName = new Map(contract.workspaces.map((workspace) => [workspace.name, workspace]));
  const edges = new Map<string, string[]>();
  for (const workspace of contract.workspaces) {
    const manifest = manifests.get(workspace.name);
    if (!manifest) continue;
    const requirements = contract.deliveries
      .filter((delivery) => delivery.packages.includes(workspace.name))
      .map((delivery) => delivery.id);
    const put = (
      state: State,
      rule: string,
      evidence: string,
      remedy = "",
      location = `${workspace.path}/package.json`,
    ) => add(2, state, rule, location, evidence, remedy, [workspace.name], requirements);
    const dependencies = dependencyGroups(manifest);
    edges.set(
      workspace.name,
      dependencies
        .filter((dependency) => byName.has(dependency.name))
        .map((dependency) => dependency.name),
    );
    for (const dependency of dependencies) {
      const target = byName.get(dependency.name);
      if (target) {
        const exception = contract.policy.dependencyExceptions.find(
          (item) => item.from === workspace.name && item.to === target.name,
        );
        if (!workspace.allows.includes(target.name) && !exception)
          put(
            "fail",
            "dependency-direction",
            `${dependency.kind}: ${target.name} is outside the allowed dependency direction.`,
            "Declare a justified exception or correct the dependency.",
          );
        if (typeof dependency.version !== "string" || !dependency.version.startsWith("workspace:"))
          put(
            "fail",
            "workspace-range",
            `${dependency.name} must use workspace: resolution.`,
            "Use the appropriate workspace: range.",
          );
        if (
          dependency.kind !== "devDependencies" &&
          ["browser", "worker"].includes(workspace.runtime) &&
          target.runtime !== workspace.runtime &&
          target.runtime !== "universal"
        )
          put(
            "fail",
            "runtime-boundary",
            `${workspace.runtime} consumes ${target.runtime} package ${target.name}.`,
            "Use a runtime-compatible shared boundary.",
          );
        if (
          workspace.roles.includes("npm") &&
          dependency.kind !== "devDependencies" &&
          manifests.get(target.name)?.private === true
        ) {
          const bundled =
            manifest.bundleDependencies === true ||
            manifest.bundledDependencies === true ||
            texts(manifest.bundleDependencies ?? manifest.bundledDependencies).includes(
              target.name,
            );
          put(
            bundled ? "unverified" : "fail",
            "npm-internal-resolution",
            bundled
              ? `Private dependency ${target.name} is declared bundled; actual tarball inclusion is unverified.`
              : `Published dependency ${target.name} is private and cannot resolve from npm.`,
            "Publish a valid dependency or use an explicitly verified bundling strategy; do not assume workspace rewriting makes a private package available.",
          );
        }
      } else if (
        typeof dependency.version === "string" &&
        dependency.version.startsWith("workspace:")
      )
        put(
          "fail",
          "workspace-dependency",
          `Unresolved internal dependency ${dependency.name}.`,
          "Declare the real workspace identity.",
        );
      else if (
        typeof dependency.version === "string" &&
        dependency.version.startsWith("catalog:")
      ) {
        const name = dependency.version.slice("catalog:".length);
        const catalogs = record(workspaceConfig.catalogs) ? workspaceConfig.catalogs : {};
        const catalog = name ? catalogs[name] : workspaceConfig.catalog;
        if (!record(catalog) || typeof catalog[dependency.name] !== "string")
          put(
            "fail",
            "catalog-reference",
            `Missing catalog version for ${dependency.name}.`,
            "Define the shared version in the pnpm catalog.",
          );
      } else
        put(
          "fail",
          "catalog-version",
          `${dependency.name} is not sourced from the shared pnpm catalog.`,
          "Use catalog: with the shared third-party version.",
        );
    }
    const scripts = record(manifest.scripts) ? manifest.scripts : {};
    for (const task of workspace.tasks) {
      const config = taskFor(tasks, workspace.name, task);
      if (typeof scripts[task] !== "string" || !config)
        put(
          "fail",
          "task-graph",
          `Required task ${task} is missing in package scripts or Turbo.`,
          "Align required scripts and Turbo tasks.",
        );
      if (task === "build" && config) {
        if (!Array.isArray(config.outputs) || config.outputs.length === 0)
          put(
            "fail",
            "build-outputs",
            "Build has no declared outputs.",
            "Declare actual artifact output paths in Turbo.",
          );
        if (
          (edges.get(workspace.name)?.length ?? 0) > 0 &&
          !texts(config.dependsOn).includes("^build")
        )
          put(
            "fail",
            "build-prerequisites",
            "Internal dependencies lack ^build scheduling.",
            "Declare dependency build prerequisites or an explicit supported task graph.",
          );
      }
    }
    if (
      workspace.roles.some((role) => ["internal", "tool"].includes(role)) &&
      !workspace.roles.includes("npm")
    )
      put(
        manifest.private === true ? "pass" : "fail",
        "internal-role",
        "Internal/tool packages must explicitly be private in pnpm-default-v1.",
        "Set private:true or declare a public package role instead.",
      );
    if (workspace.roles.includes("npm")) {
      put(
        manifest.private !== true &&
          typeof manifest.version === "string" &&
          record(manifest.publishConfig) &&
          manifest.publishConfig.access === "public"
          ? "pass"
          : "fail",
        "npm-identity",
        "Public npm identity, version and access metadata.",
        "Declare public publish metadata without publishing.",
      );
      const exports = texts(manifest.exports);
      const cliOnly = workspace.roles.includes("cli") && exports.length === 0;
      put(
        cliOnly ? "not-applicable" : exports.length > 0 ? "pass" : "fail",
        "npm-exports",
        cliOnly
          ? "Executable-only npm packages do not need a JavaScript library export."
          : "Public library exports must be explicit.",
        "Declare package entry exports.",
      );
      const publishing = record(manifest.publishConfig) ? manifest.publishConfig : {};
      put(
        typeof publishing.tag === "string" || publishing.tag === undefined ? "pass" : "fail",
        "npm-channel",
        `Configured npm channel is ${typeof publishing.tag === "string" ? publishing.tag : "latest (npm default)"}; release-command overrides are not executed.`,
        "Declare a valid publishConfig.tag or validate the release workflow separately.",
      );
      const files = texts(manifest.files);
      const sensitiveFiles = inventory.filter(
        (file) =>
          under(file, workspace.path) &&
          secretPath.test(file) &&
          !/(?:^|\/)(?:\.npmrc|\.env\.(?:example|sample|template))$/.test(file) &&
          files.some(
            (pattern) =>
              under(
                file.slice(workspace.path.length + 1),
                pattern.replace(/^\.\//, "").replace(/\/\*\*$/, ""),
              ) || matches(file.slice(workspace.path.length + 1), pattern),
          ),
      );
      for (const file of sensitiveFiles)
        put(
          "unverified",
          "npm-sensitive-file",
          "Publish scope contains a potentially sensitive file; only its path was observed, not its values.",
          "Remove secret-value files from publish scope or use a supported non-secret template convention.",
          file,
        );
      put(
        files.length > 0 &&
          !files.some((file) => secretPath.test(file) || file === "." || file === "**")
          ? "pass"
          : "fail",
        "npm-files",
        "Publish allowlist must be bounded and exclude secret-value paths.",
        "Declare precise publish paths.",
      );
      for (const file of [...exports, ...texts(manifest.types)]) {
        if (!file.startsWith("./") || file.includes("*")) {
          put(
            "unverified",
            "npm-export-target",
            "Conditional/pattern target is outside supported literal export targets.",
            "Provide literal targets or extend the observer.",
          );
          continue;
        }
        const included = files.some(
          (pattern) =>
            under(file.slice(2), pattern.replace(/^\.\//, "").replace(/\/\*\*$/, "")) ||
            matches(file.slice(2), pattern),
        );
        if (!included)
          put(
            "fail",
            "npm-content",
            `Public target ${file} is outside publish files.`,
            "Include the public target.",
          );
        try {
          put(
            (await snapshot.exists(`${workspace.path}/${file}`)) ? "pass" : "unverified",
            "npm-artifact",
            `Existing file check for public target ${file}; no pack/build executed.`,
            "Build/pack separately in an authorized environment; metadata is not consumption proof.",
          );
        } catch (error) {
          put("unverified", "npm-artifact", String(error), "Use a safe regular artifact.");
        }
      }
      if (cliOnly)
        put(
          "not-applicable",
          "npm-types",
          "Executable-only npm package has no public library typing surface.",
        );
      else if (!texts(manifest.types).length && !exports.some((file) => /\.d\.[cm]?ts$/.test(file)))
        put(
          "unverified",
          "npm-types",
          "No type declaration evidence.",
          "Provide types or establish that declarations are not applicable.",
        );
    }
    if (workspace.roles.includes("cli")) {
      const bins = texts(manifest.bin);
      put(
        bins.length > 0 ? "pass" : "fail",
        "cli-bin",
        "Executable entry metadata.",
        "Declare bin entry points.",
      );
      if (!record(manifest.engines) || typeof manifest.engines.node !== "string")
        put("fail", "cli-runtime", "CLI Node engine is missing.", "Declare a compatible runtime.");
      for (const bin of bins) {
        try {
          const path = `${workspace.path}/${bin}`;
          if (!(await snapshot.exists(path)))
            put(
              "unverified",
              "cli-artifact",
              `Executable ${bin} is absent.`,
              "Build and inspect the artifact separately.",
            );
          else
            put(
              (await snapshot.text(path)).startsWith("#!/usr/bin/env node") ? "pass" : "fail",
              "cli-entry",
              "Existing Node executable requires its shebang.",
              "Add the executable interpreter declaration.",
              path,
            );
        } catch (error) {
          put("unverified", "cli-entry", String(error), "Use a safe executable file.");
        }
        if (
          workspace.roles.includes("npm") &&
          !texts(manifest.files).some((file) =>
            under(bin.replace(/^\.\//, ""), file.replace(/^\.\//, "")),
          )
        )
          put(
            "fail",
            "cli-publish-files",
            `Executable ${bin} is outside the publish allowlist.`,
            "Include the executable.",
          );
      }
    }
    const actualSources = inventory.filter(
      (file) =>
        under(file, workspace.path) &&
        /\.[cm]?[jt]sx?$/.test(file) &&
        !file.includes("/dist/") &&
        !/(?:\/(?:test|tests|__tests__)\/|[.](?:test|spec)[.])/.test(file),
    );
    for (const source of actualSources) {
      try {
        const content = await snapshot.text(source);
        for (const { specifier, typeOnly } of sourceImports(source, content)) {
          if (specifier === null) {
            put(
              "unverified",
              "computed-import",
              "A computed import cannot be resolved by the static observer.",
              "Provide a supported static entry mapping or a target-specific observer.",
              source,
            );
            continue;
          }
          if (
            !typeOnly &&
            workspace.sources.some((path) => source === `${workspace.path}/${path}`) &&
            ["browser", "worker"].includes(workspace.runtime) &&
            (nodeImports.has(specifier) || /(?:server-only|secrets?)(?:\/|$)/.test(specifier))
          )
            put(
              workspace.runtime === "worker" ? "unverified" : "fail",
              "source-runtime",
              "Server-only import in browser/Worker source; Worker Node compatibility requires explicit platform verification.",
              "Remove the server-only dependency or validate the applicable Worker compatibility flags separately.",
              source,
            );
          if (specifier.startsWith(".")) {
            const targetPath = relative(
              snapshot.root,
              resolve(snapshot.root, dirname(source), specifier),
            )
              .split(sep)
              .join("/");
            const other = contract.workspaces.find(
              (candidate) => candidate.name !== workspace.name && under(targetPath, candidate.path),
            );
            if (other)
              put(
                "fail",
                "entry-boundary",
                `Relative import bypasses ${other.name}'s public boundary.`,
                "Import its declared package exports.",
                source,
              );
            else if (!(await resolveSource(snapshot, source, specifier))) {
              put(
                "unverified",
                "source-import-resolution",
                "A relative source import could not be resolved by the supported JS/TS mapping.",
                "Restore the required source or declare a supported build/alias mapping.",
                source,
              );
            }
          } else {
            const target = contract.workspaces.find(
              (candidate) =>
                specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
            );
            if (
              !target &&
              !nodeImports.has(specifier) &&
              !dependencies.some(
                (dependency) =>
                  specifier === dependency.name || specifier.startsWith(`${dependency.name}/`),
              )
            ) {
              put(
                "unverified",
                "external-import-resolution",
                "An import is neither a declared dependency, builtin nor a supported workspace entry.",
                "Declare its dependency or add an explicit tool-specific alias adapter.",
                source,
              );
            }
            if (target && target.name !== workspace.name) {
              if (!dependencies.some((dependency) => dependency.name === target.name))
                put(
                  "fail",
                  "undeclared-import",
                  `Import of ${target.name} has no dependency declaration.`,
                  "Declare the correct dependency kind.",
                  source,
                );
              const exported = manifests.get(target.name)?.exports;
              const subpath =
                specifier === target.name ? "." : `.${specifier.slice(target.name.length)}`;
              if (
                !(typeof exported === "string" && subpath === ".") &&
                !(
                  record(exported) &&
                  ((Object.hasOwn(exported, subpath) && exported[subpath] !== null) ||
                    Object.entries(exported).some(
                      ([key, value]) =>
                        key.includes("*") && value !== null && matches(subpath, key),
                    ) ||
                    (subpath === "." && !Object.keys(exported).some((key) => key.startsWith("."))))
                )
              )
                put(
                  "fail",
                  "entry-boundary",
                  `Import ${specifier} is not a declared literal export.`,
                  "Use a declared public entry.",
                  source,
                );
            }
          }
        }
      } catch (error) {
        put(
          "unverified",
          "source-observation",
          String(error),
          "Use safe bounded source files.",
          source,
        );
      }
    }
    put(
      "pass",
      "package-observed",
      "All declared roles were evaluated; pass here does not override any unverified or failing checks.",
    );
  }
  for (const start of byName.keys()) {
    const visited = new Set<string>();
    const visit = (name: string, path: string[]): boolean => {
      if (path.includes(name)) return name === start;
      if (visited.has(name)) return false;
      visited.add(name);
      return (edges.get(name) ?? [])
        .filter(
          (target) =>
            !contract.policy.dependencyExceptions.some(
              (exception) =>
                exception.from === name && exception.to === target && exception.allowCycle === true,
            ),
        )
        .some((target) => visit(target, [...path, name]));
    };
    if (visit(start, []))
      add(
        2,
        "fail",
        "dependency-cycle",
        byName.get(start)?.path ?? "",
        "Internal dependency graph contains a cycle involving this package (including development/peer edges).",
        "Remove the cycle; do not bypass public boundaries.",
        [start],
        contract.deliveries
          .filter((delivery) => delivery.packages.includes(start))
          .map((delivery) => delivery.id),
      );
  }
  checkTaskGraph(contract, manifests, tasks, edges, add);
  for (const delivery of contract.deliveries)
    await checkDelivery(snapshot, delivery, byName, tasks, add, contract.deliveries);
}
