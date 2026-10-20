import { realpath } from "node:fs/promises";
import { type Contract, parseContract } from "./contract.js";
import { checkDeliveryMappings, checkUnmappedDeploymentFiles } from "./delivery-mapping.js";
import { checkFileAssignments, checkFileClassification } from "./file-placement.js";
import { checkPackages } from "./packages.js";
import { checkRepositoryConfiguration } from "./repository-configuration.js";
import { observeRepository } from "./repository-observation.js";
import { checkRequiredFiles } from "./required-files.js";
import { type Finding, type Report, Snapshot, type State, summary } from "./shared.js";
import { checkWorkspaceLayout } from "./workspace-layout.js";
import { checkWorkspaceIdentities, checkWorkspaceMapping } from "./workspace-mapping.js";
export async function checkMonorepo(
  root: string,
  contractPath: string,
  maxLayer: 1 | 2 = 2,
): Promise<Report> {
  const snapshot = new Snapshot(await realpath(root));
  const findings: Finding[] = [];
  function add(
    layer: 1 | 2,
    state: State,
    rule: string,
    location: string,
    evidence: string,
    remedy: string,
    packages: string[] = [],
    requirements: string[] = [],
    targetDirectory?: string,
  ) {
    findings.push({
      layer,
      state,
      rule,
      location,
      evidence,
      remedy,
      packages,
      requirements,
      ...(targetDirectory === undefined ? {} : { targetDirectory }),
    });
  }
  function result(blocked: boolean): Report {
    return {
      schemaVersion: 1,
      scope: "delivery-preparation",
      state: summary(findings),
      layer2: blocked ? "blocked" : maxLayer === 1 ? "not-requested" : "checked",
      findings,
      evidenceKind: "configuration-and-existing-files",
      onlineVerified: false,
      limitations: [
        "No builds, package packing, isolated consumers or CLI command/extension discovery are executed; existing required artifacts and delivery configuration are checked.",
        "Static source boundaries and declared runtimes are checked, not third-party transitive execution or engine-range intersections.",
        "No remote resource provisioning, secret-value access, deployment, migration, live API health or online OIDC login is performed.",
        "These outside-scope proofs do not block delivery-preparation readiness; unsupported adapters, unresolved imports and missing required configuration/artifacts remain blocking findings.",
      ],
    };
  }
  let contract: Contract;
  try {
    contract = parseContract(await snapshot.json(contractPath));
    add(
      1,
      "pass",
      "contract-schema-v1",
      contractPath,
      "Versioned requirements contract is valid.",
      "",
    );
  } catch (error) {
    add(
      1,
      "fail",
      "contract-schema-v1",
      contractPath,
      error instanceof Error ? error.message : String(error),
      "Repair the contract without inferring requirements from source.",
    );
    add(
      2,
      "unverified",
      "layer-order",
      contractPath,
      "Layer 2 is blocked by the invalid contract.",
      "Resolve layer 1 first.",
    );
    return result(true);
  }

  const facts = await observeRepository(snapshot);
  checkRepositoryConfiguration(facts, contract, add);
  const { manifests, tasks, workspaceConfig, inventory } = facts;
  const byName = new Map(contract.workspaces.map((workspace) => [workspace.name, workspace]));
  await checkRequiredFiles(snapshot, contract, add);
  checkWorkspaceIdentities(contract, contractPath, byName, add);
  checkUnmappedDeploymentFiles(contract, inventory, add);
  for (const workspace of contract.workspaces) {
    checkWorkspaceMapping(workspace, contract, contractPath, byName, manifests, add);
    await checkWorkspaceLayout(snapshot, contract, workspace, add);
  }
  await checkDeliveryMappings(snapshot, contract, contractPath, byName, manifests, add);
  checkFileAssignments(contract, contractPath, inventory, byName, add);
  checkFileClassification(contract, contractPath, inventory, add);
  if (
    findings.some(
      (finding) => finding.layer === 1 && ["fail", "unverified"].includes(finding.state),
    )
  ) {
    add(
      2,
      "unverified",
      "layer-order",
      contractPath,
      "Layer 2 blocked: structure or mappings are not fully established.",
      "Resolve layer 1 first.",
    );
    return result(true);
  }
  if (maxLayer === 2)
    await checkPackages(snapshot, contract, manifests, tasks, workspaceConfig, inventory, add);
  return result(false);
}
