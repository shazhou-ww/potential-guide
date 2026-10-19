import type { Contract, Workspace } from "./contract.js";
import type { Dependency, ReportPut } from "./shared.js";
import { type RecordValue, record, texts } from "./shared.js";

export function checkDependencyRules(
  contract: Contract,
  workspace: Workspace,
  manifest: RecordValue,
  byName: Map<string, Workspace>,
  manifests: Map<string, RecordValue>,
  workspaceConfig: RecordValue,
  dependencies: Dependency[],
  put: ReportPut,
) {
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
          texts(manifest.bundleDependencies ?? manifest.bundledDependencies).includes(target.name);
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
    else if (typeof dependency.version === "string" && dependency.version.startsWith("catalog:")) {
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
}
