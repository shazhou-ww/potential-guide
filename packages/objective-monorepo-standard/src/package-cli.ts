import type { Workspace } from "./contract.js";
import type { ReportPut } from "./shared.js";
import { type RecordValue, record, type Snapshot, texts, under } from "./shared.js";

export async function checkCliPackage(
  snapshot: Snapshot,
  workspace: Workspace,
  manifest: RecordValue,
  put: ReportPut,
) {
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
}
