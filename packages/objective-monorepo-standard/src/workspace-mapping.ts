import type { Contract, Workspace } from "./contract.js";
import type { Add, RecordValue } from "./shared.js";

export function checkWorkspaceIdentities(
  contract: Contract,
  contractPath: string,
  byName: Map<string, Workspace>,
  add: Add,
) {
  if (
    byName.size !== contract.workspaces.length ||
    new Set(contract.workspaces.map((workspace) => workspace.path)).size !==
      contract.workspaces.length
  )
    add(
      1,
      "fail",
      "workspace-identity",
      contractPath,
      "Duplicate workspace name or path.",
      "Remove contradictory mappings.",
    );
}

export function checkWorkspaceMapping(
  workspace: Workspace,
  contract: Contract,
  contractPath: string,
  byName: Map<string, Workspace>,
  manifests: Map<string, RecordValue>,
  add: Add,
) {
  const manifestPath = `${workspace.path}/package.json`;
  if (workspace.allows.some((name) => !byName.has(name))) {
    add(
      1,
      "fail",
      "dependency-mapping",
      contractPath,
      "Allowed dependency names must refer to declared workspaces.",
      "Correct the explicit dependency direction mapping.",
      [workspace.name],
    );
  }
  for (const role of workspace.roles.filter((role) =>
    ["npm", "cli", "browser", "cloudflare-worker"].includes(role),
  )) {
    if (
      !contract.deliveries.some(
        (delivery) => delivery.packages.includes(workspace.name) && delivery.kind === role,
      )
    ) {
      add(
        1,
        "fail",
        "delivery-coverage",
        manifestPath,
        `Role ${role} has no delivery requirement.`,
        "Map actual publishing/deployment entry roles to a requirement.",
        [workspace.name],
      );
    }
  }
  const actual = manifests.get(workspace.name);
  if (
    actual &&
    (actual.private !== true || actual.bin !== undefined) &&
    !workspace.roles.some((role) => role === "npm" || role === "cli")
  ) {
    add(
      1,
      "fail",
      "actual-entry-coverage",
      manifestPath,
      "Non-private package or executable metadata is not represented by its declared roles.",
      "Declare its public/CLI delivery or explicitly make an internal package private.",
      [workspace.name],
    );
  }
  if (!manifests.has(workspace.name))
    add(
      1,
      "fail",
      "workspace-mapping",
      manifestPath,
      "Declared package not included by pnpm workspace patterns or identity mismatch.",
      "Align requirements, workspace patterns and package identity.",
      [workspace.name],
    );
}
