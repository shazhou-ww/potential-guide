import type { Contract } from "./contract.js";
import type { RepositoryFacts } from "./repository-observation.js";
import { type Add, texts, workspaceFields } from "./shared.js";

export function checkRepositoryConfiguration(facts: RepositoryFacts, contract: Contract, add: Add) {
  if (facts.workspaceObserved) {
    if (Object.keys(facts.workspaceConfig).some((key) => !workspaceFields.has(key)))
      add(
        1,
        "unverified",
        "workspace-schema",
        "pnpm-workspace.yaml",
        "Unknown workspace configuration fields are outside the supported schema.",
        "Validate with the exact pnpm version and extend the observer; unknown fields are not ignored.",
      );
    if (texts(facts.workspaceConfig.packages).some((pattern) => /[{}[\]?\\]/.test(pattern)))
      add(
        1,
        "unverified",
        "workspace-pattern",
        "pnpm-workspace.yaml",
        "Workspace patterns outside literal, * and ** syntax are not supported.",
        "Use a supported pattern or extend the observer.",
      );
  }
  if (facts.turboValidity && facts.turboValidity !== "valid")
    add(
      1,
      facts.turboValidity,
      "turbo-schema",
      "turbo.json",
      "Invalid or unsupported Turbo fields; task graph cannot be certified.",
      "Validate against the tool schema and extend the explicitly supported subset.",
    );
  if (facts.rootObserved)
    add(
      1,
      "pass",
      "global-config",
      "pnpm-workspace.yaml",
      "Workspace YAML and package metadata are parseable; supported field types checked.",
      "",
    );
  const seen = new Set<string>();
  const byName = new Map(contract.workspaces.map((workspace) => [workspace.name, workspace]));
  for (const { file, directory, manifest, valid } of facts.packages) {
    if (!valid) {
      add(
        1,
        "fail",
        "package-schema",
        file,
        "Invalid package metadata types.",
        "Repair package.json.",
      );
      continue;
    }
    const name = String(manifest.name);
    if (seen.has(name))
      add(
        1,
        "fail",
        "workspace-identity",
        file,
        `Duplicate package name ${name}.`,
        "Give packages unique identities.",
        [name],
      );
    seen.add(name);
    const declared = byName.get(name);
    if (!declared || declared.path !== directory)
      add(
        1,
        "fail",
        "workspace-coverage",
        file,
        "Actual workspace is missing or has a contradictory path in the requirements contract.",
        "Declare its role and exact identity.",
        [name],
      );
  }
  if (facts.failure !== undefined)
    add(
      1,
      "fail",
      "global-config",
      "pnpm-workspace.yaml / turbo.json / package.json",
      facts.failure,
      "Repair the indicated readable configuration.",
    );
}
