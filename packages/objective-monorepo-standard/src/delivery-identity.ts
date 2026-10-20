import type { Delivery } from "./contract.js";
import type { ReportPut } from "./shared.js";

export function checkIdentityPreparation(delivery: Delivery, put: ReportPut) {
  put(
    delivery.resources.some((resource) => resource.kind === "identity") ? "pass" : "fail",
    "oidc-preparation",
    "OIDC needs an identity reference and supply/environment mapping, not secret values.",
    "Declare the identity supply reference.",
  );
}
