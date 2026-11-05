import { gte, valid } from "semver";
import type { TaskBundleDeclaration } from "@potential-guide/task-protocol";

export function assertTaskRuntime(declaration: TaskBundleDeclaration) {
  const minimum = valid(declaration.runtime.minVersion);
  if (!minimum) throw new Error("Invalid runtime version.");
  if (!gte(process.versions.node, "22.13.0"))
    throw new Error("Runtime is below the Host support policy (Node 22.13.0).");
  if (!gte(process.versions.node, minimum)) throw new Error("Task minimum runtime is unavailable.");
}
