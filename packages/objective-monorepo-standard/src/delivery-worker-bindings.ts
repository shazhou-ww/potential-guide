import type { Delivery } from "./contract.js";
import type { ReportPut } from "./shared.js";
import { type RecordValue, record } from "./shared.js";

export function checkWorkerVariables(delivery: Delivery, environment: RecordValue, put: ReportPut) {
  for (const resource of delivery.resources) {
    if (
      resource.kind === "configuration" &&
      (!record(environment.vars) || !Object.hasOwn(environment.vars, resource.name))
    ) {
      put(
        "fail",
        "worker-configuration",
        `Missing environment-local ordinary configuration reference ${resource.name}.`,
        "Declare the non-secret variable in the selected environment.",
      );
    }
    if (
      resource.kind === "secret" &&
      record(environment.vars) &&
      Object.hasOwn(environment.vars, resource.name)
    ) {
      put(
        "fail",
        "worker-secret-storage",
        `Secret reference ${resource.name} is configured as a plain variable.`,
        "Remove literal secrets from configuration and use platform secret provisioning; values are not reported.",
      );
    }
  }
}

export function checkWorkerBindings(delivery: Delivery, environment: RecordValue, put: ReportPut) {
  for (const resource of delivery.resources.filter(
    (resource) =>
      resource.kind === "resource" ||
      (resource.kind === "service" && resource.supply === "platform"),
  )) {
    const bindings = ["d1_databases", "kv_namespaces", "r2_buckets", "services", "queues"].flatMap(
      (field) => {
        const value = environment[field];
        return Array.isArray(value) ? value : record(value) ? Object.values(value).flat() : [];
      },
    );
    if (!bindings.some((binding) => record(binding) && binding.binding === resource.name))
      put(
        "fail",
        "worker-binding",
        `Missing environment-local binding ${resource.name}.`,
        "Declare the binding in the target environment (not a secret value).",
      );
  }
}
