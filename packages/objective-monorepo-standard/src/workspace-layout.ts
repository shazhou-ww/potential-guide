import type { Contract, Workspace } from "./contract.js";
import type { Add } from "./shared.js";
import { type Snapshot, under } from "./shared.js";

export async function checkWorkspaceLayout(
  snapshot: Snapshot,
  contract: Contract,
  workspace: Workspace,
  add: Add,
) {
  const dirs = contract.policy.directories;
  const executable = workspace.roles.some((role) =>
    ["browser", "cloudflare-worker"].includes(role),
  );
  const expected = executable ? dirs.apps : dirs.packages;
  const exception = contract.policy.exceptions.find((item) => under(workspace.path, item.path));
  add(
    1,
    under(workspace.path, expected) || exception ? "pass" : "fail",
    "layout-package-role",
    workspace.path,
    exception?.reason ??
      `pnpm-default-v1: ${executable ? "applications" : "reusable and tooling packages"} belong under ${expected}.`,
    "Move only after authorization; update imports, workspace patterns, scripts and documentation references.",
    [workspace.name],
    [],
    expected,
  );
  for (const file of ["README.md", ...workspace.entries, ...workspace.sources]) {
    try {
      if (!(await snapshot.exists(`${workspace.path}/${file}`)))
        add(
          1,
          "fail",
          "workspace-file",
          `${workspace.path}/${file}`,
          "Declared entry/source or package documentation is missing.",
          "Restore the file or correct the explicit reference.",
          [workspace.name],
        );
    } catch (error) {
      add(
        1,
        "unverified",
        "workspace-file",
        `${workspace.path}/${file}`,
        String(error),
        "Use safe repository-local non-secret paths.",
        [workspace.name],
      );
    }
  }
}
