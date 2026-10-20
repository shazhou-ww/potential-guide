import type { Contract, Workspace } from "./contract.js";
import type { Add } from "./shared.js";
import { dependencyGroups, type RecordValue, type Snapshot, under } from "./shared.js";

export function checkUnmappedDeploymentFiles(contract: Contract, inventory: string[], add: Add) {
  for (const file of inventory.filter((file) =>
    /(?:^|\/)wrangler\.(?:json|jsonc|toml)$/.test(file),
  )) {
    if (
      !contract.deliveries.some((delivery) => delivery.config === file) &&
      !contract.policy.assignments.some(
        (assignment) =>
          assignment.path === file && ["generated", "tool"].includes(assignment.purpose),
      ) &&
      !contract.policy.exceptions.some((exception) => under(file, exception.path))
    ) {
      add(
        1,
        "unverified",
        "deployment-entry-coverage",
        file,
        "Known deployment configuration has no requirement mapping or explicit fixture/tool exception.",
        "Classify the configuration; do not infer a live service or silently omit it.",
      );
    }
  }
}

export async function checkDeliveryMappings(
  snapshot: Snapshot,
  contract: Contract,
  contractPath: string,
  byName: Map<string, Workspace>,
  manifests: Map<string, RecordValue>,
  add: Add,
) {
  const ids = new Set<string>();
  for (const delivery of contract.deliveries) {
    if (ids.has(delivery.id))
      add(
        1,
        "fail",
        "delivery-identity",
        contractPath,
        "Duplicate delivery ID.",
        "Use stable unique IDs.",
        [],
        [delivery.id],
      );
    ids.add(delivery.id);
    if (
      new Set(delivery.resources.map((resource) => resource.name)).size !==
      delivery.resources.length
    ) {
      add(
        1,
        "fail",
        "resource-identity",
        contractPath,
        "Duplicate or contradictory resource names in one requirement.",
        "Use unique reference names for the selected environment.",
        delivery.packages,
        [delivery.id],
      );
    }
    for (const name of delivery.packages) {
      const manifest = manifests.get(name);
      if (!manifest) continue;
      for (const dependency of dependencyGroups(manifest).filter(
        (dependency) => dependency.kind !== "devDependencies",
      )) {
        if (byName.has(dependency.name) && !delivery.packages.includes(dependency.name)) {
          add(
            1,
            "fail",
            "requirement-closure",
            contractPath,
            `Runtime/peer support package ${dependency.name} is missing from requirement ${delivery.id}.`,
            "Associate the complete runtime support closure; a requirement may span multiple packages.",
            [name, dependency.name],
            [delivery.id],
          );
        }
      }
    }
    const referenced = [...new Set([...delivery.packages, delivery.entry.package])];
    if (
      !delivery.packages.includes(delivery.entry.package) ||
      referenced.some((name) => !byName.has(name))
    )
      add(
        1,
        "fail",
        "delivery-mapping",
        contractPath,
        "Delivery entry or support package is not mapped consistently.",
        "Declare the entry and all support packages.",
        referenced,
        [delivery.id],
      );
    const owner = byName.get(delivery.entry.package);
    if (owner && !owner.entries.includes(delivery.entry.path))
      add(
        1,
        "fail",
        "entry-coverage",
        contractPath,
        "Delivery entry is not a declared package entry.",
        "Declare the actual entry.",
        [owner.name],
        [delivery.id],
      );
    for (const path of [delivery.config, delivery.output].filter(
      (path): path is string => path !== undefined,
    )) {
      try {
        if (path === delivery.config && !(await snapshot.exists(path)))
          add(
            1,
            "fail",
            "delivery-file",
            path,
            "Required delivery configuration is missing.",
            "Provide configuration, not production values.",
            delivery.packages,
            [delivery.id],
          );
      } catch (error) {
        add(
          1,
          "unverified",
          "delivery-file",
          path,
          String(error),
          "Use safe non-secret configuration.",
          delivery.packages,
          [delivery.id],
        );
      }
    }
  }
}
