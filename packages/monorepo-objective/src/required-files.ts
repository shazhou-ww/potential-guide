import type { Contract } from "./contract.js";
import type { Add, Snapshot } from "./shared.js";

export async function checkRequiredFiles(snapshot: Snapshot, contract: Contract, add: Add) {
  for (const file of [
    "README.md",
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
    ...contract.policy.requiredFiles,
  ]) {
    try {
      add(
        1,
        (await snapshot.exists(file)) ? "pass" : "fail",
        "required-file",
        file,
        "Required by pnpm-default-v1 or explicit policy.",
        "Restore the required file.",
      );
    } catch (error) {
      add(
        1,
        "unverified",
        "required-file",
        file,
        String(error),
        "Use a safe non-secret regular file.",
      );
    }
  }
}
