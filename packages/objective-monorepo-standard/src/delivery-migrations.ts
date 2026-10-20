import type { Delivery, Workspace } from "./contract.js";
import type { ReportPut } from "./shared.js";

export function checkMigrationPreparation(
  delivery: Delivery,
  byName: Map<string, Workspace>,
  put: ReportPut,
) {
  put(
    delivery.migration !== undefined &&
      delivery.packages.includes(delivery.migration.package) &&
      byName.get(delivery.migration.package)?.entries.includes(delivery.migration.entry) === true &&
      delivery.resources.some(
        (resource) =>
          resource.kind === "resource" && resource.name === delivery.migration?.resource,
      )
      ? "pass"
      : "fail",
    "migration-preparation",
    "Migration requires a target resource and declared execution entry.",
    "Declare the migration resource and entry; never execute it in this observer.",
  );
}
