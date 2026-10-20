import type { Delivery, Workspace } from "./contract.js";
import type { RecordValue, ReportPut } from "./shared.js";

export function checkBrowserConfiguration(
  config: RecordValue,
  delivery: Delivery,
  owner: Workspace,
  put: ReportPut,
) {
  if (Object.keys(config).some((key) => !["entry", "environment", "outputDirectory"].includes(key)))
    put(
      "unverified",
      "browser-deployment-schema",
      "Unknown fields in the supported static deployment reference adapter.",
      "Use the documented adapter schema or add target-specific support.",
    );

  if (delivery.runtime !== "browser")
    put(
      "fail",
      "browser-runtime",
      "Browser delivery requires browser runtime.",
      "Correct the runtime.",
    );

  if (
    config.outputDirectory !== delivery.output ||
    config.environment !== delivery.environment ||
    config.entry !== `${owner.path}/${delivery.entry.path}`
  )
    put(
      "fail",
      "browser-deployment",
      "Static deployment JSON entry/environment/output disagree with the requirement.",
      "Align deployment references; this JSON is a reference adapter, not a platform deployment.",
    );
}
