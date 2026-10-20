import type { Delivery, Workspace } from "./contract.js";
import type { ReportPut } from "./shared.js";

export function checkServiceReferences(
  delivery: Delivery,
  byName: Map<string, Workspace>,
  deliveries: readonly Delivery[],
  put: ReportPut,
) {
  for (const service of delivery.services) {
    const target = byName.get(service);
    const external = delivery.resources.find(
      (resource) =>
        resource.name === service &&
        resource.kind === "service" &&
        resource.environment === delivery.environment,
    );
    if (!target && external) {
      put(
        delivery.runtime !== "browser" || external.visibility === "public" ? "pass" : "fail",
        "service-visibility",
        `External service ${service} is an explicit environment-scoped supply reference, not a verified live endpoint.`,
        "Browser API references must be public, without embedding credentials.",
      );
      continue;
    }
    if (!target || !delivery.packages.includes(service)) {
      put(
        "fail",
        "service-mapping",
        `API/service reference ${service} is not associated with this requirement.`,
        "Associate the actual service workspace, or declare an explicit external service reference in the same environment.",
      );
      continue;
    }
    if (!target.roles.includes("cloudflare-worker")) {
      put(
        "fail",
        "service-role",
        `Associated package ${service} is not a supported service role.`,
        "Reference an actual supported service entry; an internal/shared package is not an API service.",
      );
      continue;
    }
    const sameEnvironment = deliveries.some(
      (candidate) =>
        candidate.kind === "cloudflare-worker" &&
        candidate.entry.package === service &&
        candidate.runtime === "worker" &&
        candidate.environment !== undefined &&
        candidate.environment === delivery.environment,
    );
    put(
      sameEnvironment ? "pass" : "fail",
      "service-environment",
      `Service ${service} must have a supported service delivery in the consumer's exact environment.`,
      "Align the actual service delivery environment; package association alone is not evidence.",
    );
  }
}
