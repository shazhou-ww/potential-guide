import { basename } from "node:path";
import type { Contract, Workspace } from "./contract.js";
import type { Add } from "./shared.js";
import { secretPath, under } from "./shared.js";

export function checkFileAssignments(
  contract: Contract,
  contractPath: string,
  inventory: string[],
  byName: Map<string, Workspace>,
  add: Add,
) {
  const dirs = contract.policy.directories;
  const assignments = new Map(
    contract.policy.assignments.map((assignment) => [assignment.path, assignment]),
  );
  if (assignments.size !== contract.policy.assignments.length)
    add(
      1,
      "fail",
      "file-assignment",
      contractPath,
      "Duplicate file assignment.",
      "Resolve conflicting responsibilities.",
    );
  for (const assignment of assignments.values()) {
    const owner = assignment.owner ? byName.get(assignment.owner) : undefined;
    if (assignment.owner && !owner)
      add(
        1,
        "fail",
        "file-owner",
        assignment.path,
        "Unknown file owner.",
        "Declare the owning workspace.",
      );
    let target = assignment.targetDirectory;
    if (!target) {
      if (assignment.purpose === "project-doc") target = dirs.docs;
      if (assignment.purpose === "package-doc" && owner) target = `${owner.path}/docs`;
      if (assignment.purpose === "script") target = owner ? `${owner.path}/scripts` : dirs.scripts;
      if (assignment.purpose === "migration" && owner) target = `${owner.path}/migrations`;
    }
    if (!inventory.includes(assignment.path))
      add(
        1,
        "fail",
        "file-assignment",
        assignment.path,
        "Assigned file does not exist.",
        "Correct the assignment.",
      );
    else if (contract.policy.exceptions.some((item) => under(assignment.path, item.path)))
      add(1, "pass", "file-exception", assignment.path, "Explicit policy exception applies.", "");
    else if (target && !under(assignment.path, target)) {
      const destination = `${target}/${basename(assignment.path)}`;
      add(
        1,
        "fail",
        "file-responsibility",
        assignment.path,
        `pnpm-default-v1 / assignment: ${assignment.reason}.${inventory.includes(destination) ? " Target already exists; explicit conflict resolution is required." : ""}`,
        "After authorization, preserve content and update imports, scripts, links and tool-fixed references; never overwrite an existing target.",
        owner ? [owner.name] : [],
        [],
        target,
      );
    } else
      add(
        1,
        target || ["tool", "generated"].includes(assignment.purpose) ? "pass" : "unverified",
        "file-responsibility",
        assignment.path,
        assignment.reason,
        target
          ? ""
          : "Classify ownership and destination; do not move or delete based on a filename.",
      );
  }
}

export function checkFileClassification(
  contract: Contract,
  contractPath: string,
  inventory: string[],
  add: Add,
) {
  const dirs = contract.policy.directories;
  const assignments = new Set(contract.policy.assignments.map((item) => item.path));
  const rootAllowed = new Set([
    ".editorconfig",
    ".node-version",
    ".npmrc",
    ".gitattributes",
    ".gitignore",
    ".git-lineage.yaml",
    "README.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "AGENTS.md",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "turbo.json",
    "biome.json",
    "tsconfig.json",
    "tsconfig.base.json",
    "tsconfig.test.json",
    contractPath,
  ]);
  if (contract.policy.packageLayers) rootAllowed.add(contract.policy.packageLayers);
  for (const file of inventory) {
    if (
      assignments.has(file) ||
      rootAllowed.has(file) ||
      secretPath.test(file) ||
      [".github", ".silvermoon", ".vscode"].some((directory) => under(file, directory)) ||
      contract.workspaces.some((workspace) => under(file, workspace.path)) ||
      [dirs.docs, dirs.scripts].some((directory) => under(file, directory)) ||
      contract.policy.allowedDirectories.some((item) => under(file, item.path)) ||
      contract.policy.exceptions.some((item) => under(file, item.path))
    )
      continue;
    add(
      1,
      "unverified",
      "file-classification",
      file,
      "No responsibility rule covers this existing file; filename alone is not a violation.",
      "Declare purpose/owner, a reasoned policy override or a tool/generated exception. Do not move or delete.",
    );
  }
}
