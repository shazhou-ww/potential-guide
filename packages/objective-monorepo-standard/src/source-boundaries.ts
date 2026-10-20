import { dirname, relative, resolve, sep } from "node:path";
import type { Contract, Workspace } from "./contract.js";
import type { Dependency, ReportPut } from "./shared.js";
import {
  matches,
  nodeImports,
  type RecordValue,
  record,
  resolveSource,
  type Snapshot,
  under,
} from "./shared.js";
import { observeSourceImports } from "./source-observation.js";
export interface SourceBoundaryContext {
  snapshot: Snapshot;
  contract: Contract;
  workspace: Workspace;
  manifests: Map<string, RecordValue>;
  dependencies: Dependency[];
  put: ReportPut;
}

export async function checkSourceImport(
  context: SourceBoundaryContext,
  source: string,
  observed: { specifier: string | null; typeOnly: boolean },
) {
  const { snapshot, contract, workspace, manifests, dependencies, put } = context;
  const { specifier, typeOnly } = observed;

  if (specifier === null) {
    put(
      "unverified",
      "computed-import",
      "A computed import cannot be resolved by the static observer.",
      "Provide a supported static entry mapping or a target-specific observer.",
      source,
    );
    return;
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
    const targetPath = relative(snapshot.root, resolve(snapshot.root, dirname(source), specifier))
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
      (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
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
      const subpath = specifier === target.name ? "." : `.${specifier.slice(target.name.length)}`;
      if (
        !(typeof exported === "string" && subpath === ".") &&
        !(
          record(exported) &&
          ((Object.hasOwn(exported, subpath) && exported[subpath] !== null) ||
            Object.entries(exported).some(
              ([key, value]) => key.includes("*") && value !== null && matches(subpath, key),
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

export async function checkSourceBoundaries(context: SourceBoundaryContext, inventory: string[]) {
  const { snapshot, contract, workspace, put } = context;
  const actualSources = inventory.filter(
    (file) =>
      under(file, workspace.path) &&
      /\.[cm]?[jt]sx?$/.test(file) &&
      !file.includes("/dist/") &&
      !contract.policy.assignments.some(
        (assignment) => assignment.path === file && assignment.purpose === "generated",
      ) &&
      !/(?:\/(?:test|tests|__tests__)\/|[.](?:test|spec)[.])/.test(file),
  );
  for (const source of actualSources) {
    try {
      for (const observed of await observeSourceImports(snapshot, source))
        await checkSourceImport(context, source, observed);
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
}
