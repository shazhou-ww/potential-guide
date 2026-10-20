import type { Delivery } from "./contract.js";
import type { ReportPut } from "./shared.js";

export function checkDeliveryResources(delivery: Delivery, put: ReportPut) {
  for (const resource of delivery.resources) {
    if (resource.environment !== delivery.environment)
      put(
        "fail",
        "resource-environment",
        `Reference ${resource.name} belongs to a different environment.`,
        "Map resources to the exact target environment.",
      );
    if (
      resource.kind === "secret" &&
      (resource.visibility === "public" || delivery.runtime === "browser")
    )
      put(
        "fail",
        "secret-boundary",
        `Secret reference ${resource.name} would cross the public boundary.`,
        "Keep secrets on the service side; never supply their values to the checker.",
      );
    if (
      resource.kind === "configuration" &&
      delivery.kind === "browser" &&
      resource.visibility !== "public"
    )
      put(
        "fail",
        "browser-configuration",
        `Browser configuration ${resource.name} is not explicitly public.`,
        "Declare public configuration and its build/runtime injection stage.",
      );
  }
}
