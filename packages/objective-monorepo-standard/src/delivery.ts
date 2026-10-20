import { extname } from "node:path";
import type { Delivery, Workspace } from "./contract.js";
import { checkBrowserConfiguration } from "./delivery-browser.js";
import { checkDeliveryEntry } from "./delivery-entry.js";
import { checkIdentityPreparation } from "./delivery-identity.js";
import { checkMigrationPreparation } from "./delivery-migrations.js";
import { checkDeliveryOutput } from "./delivery-output.js";
import { checkDeliveryResources } from "./delivery-resources.js";
import { checkServiceReferences } from "./delivery-services.js";
import { checkWorkerConfiguration } from "./delivery-worker.js";
import { type Add, type RecordValue, type Snapshot, type State, taskFor } from "./shared.js";
export async function checkDelivery(
  snapshot: Snapshot,
  delivery: Delivery,
  byName: Map<string, Workspace>,
  tasks: RecordValue,
  add: Add,
  deliveries: readonly Delivery[],
) {
  const put = (
    state: State,
    rule: string,
    evidence: string,
    remedy = "",
    location = delivery.config ?? delivery.entry.path,
  ) => add(2, state, rule, location, evidence, remedy, delivery.packages, [delivery.id]);
  const owner = byName.get(delivery.entry.package);
  if (!owner) return;
  await checkDeliveryEntry(snapshot, delivery, owner, put);
  const kinds = ["npm", "cli", "browser", "cloudflare-worker"];
  if (!kinds.includes(delivery.kind)) {
    put(
      "unverified",
      "unsupported-delivery",
      `Unsupported delivery target ${delivery.kind}.`,
      "Add a target-specific observer; do not treat this as successful service readiness.",
    );
    return;
  }
  if (!owner.roles.includes(delivery.kind as "npm" | "cli" | "browser" | "cloudflare-worker"))
    put(
      "fail",
      "delivery-role",
      "Delivery kind is missing from entry package roles.",
      "Compose all applicable roles on the package.",
    );
  if (owner.runtime !== delivery.runtime && owner.runtime !== "universal")
    put(
      "fail",
      "delivery-runtime",
      "Entry runtime and delivery runtime disagree.",
      "Correct the explicit runtime mapping.",
    );

  checkDeliveryResources(delivery, put);
  checkServiceReferences(delivery, byName, deliveries, put);
  for (const capability of delivery.capabilities) {
    if (capability === "oidc") checkIdentityPreparation(delivery, put);
    else if (capability === "migrations") checkMigrationPreparation(delivery, byName, put);
    else
      put(
        "unverified",
        "unsupported-capability",
        `Unsupported capability ${capability}.`,
        "Add a dedicated observer.",
      );
  }
  if (!delivery.capabilities.includes("oidc"))
    put("not-applicable", "oidc-preparation", "OIDC is not requested.");
  if (delivery.independent) {
    const build = taskFor(tasks, owner.name, "build");
    put(
      build && typeof build === "object" ? "pass" : "fail",
      "independent-delivery",
      "Independent delivery requires a declared build task.",
      "Declare an independently schedulable build.",
    );
  } else
    put(
      "not-applicable",
      "independent-delivery",
      "No independent delivery constraint is declared.",
    );
  if (!["browser", "cloudflare-worker"].includes(delivery.kind)) return;
  if (!delivery.config || !delivery.output || !delivery.environment) {
    put(
      "fail",
      "deployment-preparation",
      "Target needs configuration, output and environment references.",
      "Declare all three references.",
    );
    return;
  }
  try {
    if (extname(delivery.config) !== ".json") {
      put(
        "unverified",
        "deployment-format",
        "Only strict JSON deployment configuration is supported (no JSONC/TOML executable adapters).",
        "Use strict JSON or add the tool's parser.",
      );
      return;
    }

    const config = await snapshot.json(delivery.config);
    if (delivery.kind === "cloudflare-worker") {
      if (
        !checkWorkerConfiguration(
          config,
          delivery,
          owner,
          snapshot.root,
          delivery.config,
          delivery.environment,
          put,
        )
      )
        return;
    } else checkBrowserConfiguration(config, delivery, owner, put);
    await checkDeliveryOutput(snapshot, delivery.output, owner, tasks, put);
  } catch (error) {
    put(
      error instanceof SyntaxError || error instanceof TypeError ? "fail" : "unverified",
      "delivery-observation",
      error instanceof Error ? error.message : String(error),
      "Repair readable non-secret JSON configuration; unsupported observation is never success.",
    );
  }
}
