import type { Workspace } from "./contract.js";
import type { ReportPut } from "./shared.js";
import { type RecordValue, record, taskFor, texts } from "./shared.js";

export function checkPackageTasks(
  workspace: Workspace,
  manifest: RecordValue,
  tasks: RecordValue,
  hasInternalDependencies: boolean,
  put: ReportPut,
) {
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
      if (hasInternalDependencies && !texts(config.dependsOn).includes("^build"))
        put(
          "fail",
          "build-prerequisites",
          "Internal dependencies lack ^build scheduling.",
          "Declare dependency build prerequisites or an explicit supported task graph.",
        );
    }
  }
}
