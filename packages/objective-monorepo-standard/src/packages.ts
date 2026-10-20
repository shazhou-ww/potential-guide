import type { Contract } from "./contract.js";
import { checkDelivery } from "./delivery.js";
import { checkDependencyCycles } from "./dependency-graph.js";
import { checkDependencyRules } from "./dependency-rules.js";
import { checkCliPackage } from "./package-cli.js";
import { checkPackagePublication } from "./package-publication.js";
import { checkPackageTasks } from "./package-tasks.js";
import {
  type Add,
  dependencyGroups,
  type RecordValue,
  type Snapshot,
  type State,
} from "./shared.js";
import { checkSourceBoundaries } from "./source-boundaries.js";
import { checkTaskGraph } from "./task-graph.js";
export async function checkPackages(
  snapshot: Snapshot,
  contract: Contract,
  manifests: Map<string, RecordValue>,
  tasks: RecordValue,
  workspaceConfig: RecordValue,
  inventory: string[],
  add: Add,
) {
  const byName = new Map(contract.workspaces.map((workspace) => [workspace.name, workspace]));
  const edges = new Map<string, string[]>();
  for (const workspace of contract.workspaces) {
    const manifest = manifests.get(workspace.name);
    if (!manifest) continue;
    const requirements = contract.deliveries
      .filter((delivery) => delivery.packages.includes(workspace.name))
      .map((delivery) => delivery.id);
    const put = (
      state: State,
      rule: string,
      evidence: string,
      remedy = "",
      location = `${workspace.path}/package.json`,
    ) => add(2, state, rule, location, evidence, remedy, [workspace.name], requirements);
    const dependencies = dependencyGroups(manifest);
    edges.set(
      workspace.name,
      dependencies
        .filter((dependency) => byName.has(dependency.name))
        .map((dependency) => dependency.name),
    );

    checkDependencyRules(
      contract,
      workspace,
      manifest,
      byName,
      manifests,
      workspaceConfig,
      dependencies,
      put,
    );
    checkPackageTasks(
      workspace,
      manifest,
      tasks,
      (edges.get(workspace.name)?.length ?? 0) > 0,
      put,
    );
    await checkPackagePublication(snapshot, workspace, manifest, inventory, put);
    await checkCliPackage(snapshot, workspace, manifest, put);
    await checkSourceBoundaries(
      { snapshot, contract, workspace, manifests, dependencies, put },
      inventory,
    );
    put(
      "pass",
      "package-observed",
      "All declared roles were evaluated; pass here does not override any unverified or failing checks.",
    );
  }
  checkDependencyCycles(contract, byName, edges, add);
  checkTaskGraph(contract, manifests, tasks, edges, add);
  for (const delivery of contract.deliveries)
    await checkDelivery(snapshot, delivery, byName, tasks, add, contract.deliveries);
}
