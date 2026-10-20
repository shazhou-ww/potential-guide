import type { Contract } from "../src/contract.js";
import { checkDeliveryMappings, checkUnmappedDeploymentFiles } from "../src/delivery-mapping.js";
import { checkFileAssignments, checkFileClassification } from "../src/file-placement.js";
import { checkPackages } from "../src/packages.js";
import { recorder } from "../src/report.js";
import { checkRepositoryConfiguration } from "../src/repository-configuration.js";
import { observeRepository } from "../src/repository-observation.js";
import { checkRequiredFiles } from "../src/required-files.js";
import { Snapshot } from "../src/shared.js";
import { checkWorkspaceLayout } from "../src/workspace-layout.js";
import { checkWorkspaceIdentities, checkWorkspaceMapping } from "../src/workspace-mapping.js";

// Unit-test composition of low-level rules, not a production contract-loading entry point.
// The directory/dependency protocol is exercised separately by pilot.test.mjs.
export async function checkFixture(root: string, model: Contract, maxLayer: 1 | 2 = 2) {
  const snapshot = new Snapshot(root);
  const output = recorder();
  const { add } = output;
  const facts = await observeRepository(snapshot);
  checkRepositoryConfiguration(facts, model, add);
  const { manifests, tasks, workspaceConfig, inventory } = facts;
  const byName = new Map(model.workspaces.map((workspace) => [workspace.name, workspace]));
  await checkRequiredFiles(snapshot, model, add);
  checkWorkspaceIdentities(model, "objectives.yaml", byName, add);
  checkUnmappedDeploymentFiles(model, inventory, add);
  for (const workspace of model.workspaces) {
    checkWorkspaceMapping(workspace, model, "objectives.yaml", byName, manifests, add);
    await checkWorkspaceLayout(snapshot, model, workspace, add);
  }
  await checkDeliveryMappings(snapshot, model, "objectives.yaml", byName, manifests, add);
  checkFileAssignments(model, "objectives.yaml", inventory, byName, add);
  checkFileClassification(model, "objectives.yaml", inventory, add);
  if (!output.blocked() && maxLayer === 2)
    await checkPackages(snapshot, model, manifests, tasks, workspaceConfig, inventory, add);
  return output.report(maxLayer);
}
