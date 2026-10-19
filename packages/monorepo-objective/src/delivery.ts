import { dirname, extname, relative, resolve, sep } from "node:path";
import type { Delivery, Workspace } from "./contract.js";
import { sourceImports } from "./imports.js";
import {
  type Add,
  nodeImports,
  type RecordValue,
  record,
  resolveSource,
  type Snapshot,
  type State,
  taskFor,
  texts,
  under,
} from "./shared.js";
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
  const ownerPath = owner.path;
  if (delivery.runtime === "browser" || delivery.runtime === "worker") {
    const seen = new Set<string>();
    async function inspect(path: string): Promise<void> {
      if (seen.has(path)) return;
      seen.add(path);
      if (seen.size > 1000) {
        put(
          "unverified",
          "entry-runtime",
          "Entry import graph exceeds 1,000 files.",
          "Narrow or extend the runtime observer.",
          path,
        );
        return;
      }
      let source: string;
      try {
        source = await snapshot.text(path);
      } catch {
        put(
          "unverified",
          "entry-runtime",
          "Referenced entry source cannot be inspected.",
          "Provide a readable source/build mapping.",
          path,
        );
        return;
      }
      for (const { specifier, typeOnly } of sourceImports(path, source)) {
        if (typeOnly) continue;
        if (specifier === null) {
          put(
            "unverified",
            "computed-import",
            "Delivery entry contains an unresolved computed import.",
            "Use a supported static entry mapping.",
            path,
          );
          continue;
        }
        if (nodeImports.has(specifier) || /(?:server-only|secrets?)(?:\/|$)/.test(specifier)) {
          put(
            delivery.runtime === "browser" ? "fail" : "unverified",
            "entry-runtime",
            "Delivery entry transitively imports a server-only module.",
            "Remove it from browser paths or separately verify Worker compatibility.",
            path,
          );
        }
        if (specifier.startsWith(".")) {
          const candidate = await resolveSource(snapshot, path, specifier);
          if (candidate && under(candidate, ownerPath)) await inspect(candidate);
          else
            put(
              "unverified",
              "entry-source-mapping",
              "A relative entry import could not be resolved by the supported JS/TS mapping.",
              "Validate the tool-specific alias/extension mapping.",
              path,
            );
        }
      }
    }
    await inspect(`${owner.path}/${delivery.entry.path}`);
  }
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
  for (const capability of delivery.capabilities) {
    if (capability === "oidc") {
      put(
        delivery.resources.some((resource) => resource.kind === "identity") ? "pass" : "fail",
        "oidc-preparation",
        "OIDC needs an identity reference and supply/environment mapping, not secret values.",
        "Declare the identity supply reference.",
      );
    } else if (capability === "migrations") {
      put(
        delivery.migration !== undefined &&
          delivery.packages.includes(delivery.migration.package) &&
          byName.get(delivery.migration.package)?.entries.includes(delivery.migration.entry) ===
            true &&
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
    } else
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
        Object.keys(config).some(
          (key) =>
            ![
              "$schema",
              "name",
              "main",
              "compatibility_date",
              "compatibility_flags",
              "env",
              "vars",
              "d1_databases",
              "kv_namespaces",
              "r2_buckets",
              "services",
              "queues",
            ].includes(key),
        )
      ) {
        put(
          "unverified",
          "worker-schema",
          "Wrangler fields outside the supported preparation adapter are present.",
          "Validate those fields with a target-specific adapter instead of ignoring them.",
        );
      }
      if (delivery.runtime !== "worker")
        put(
          "fail",
          "worker-runtime",
          "Cloudflare requires worker runtime.",
          "Correct the target runtime.",
        );
      const envs = record(config.env) ? config.env : {};
      const environment = envs[delivery.environment];
      if (!record(environment)) {
        put(
          "fail",
          "worker-environment",
          "Wrangler target environment is absent.",
          "Declare the exact Wrangler environment.",
        );
        return;
      }
      const main = environment.main ?? config.main;
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
      const expected = relative(
        snapshot.root,
        resolve(snapshot.root, dirname(delivery.config), typeof main === "string" ? main : ""),
      )
        .split(sep)
        .join("/");
      if (expected !== `${owner.path}/${delivery.entry.path}`)
        put(
          "fail",
          "worker-entry",
          "Wrangler main does not match the declared entry.",
          "Align the entry relative to Wrangler configuration.",
        );
      if (
        typeof (environment.name ?? config.name) !== "string" ||
        typeof (environment.compatibility_date ?? config.compatibility_date) !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(
          String(environment.compatibility_date ?? config.compatibility_date),
        )
      )
        put(
          "fail",
          "worker-schema",
          "Wrangler name or compatibility_date is invalid.",
          "Declare explicit Worker metadata.",
        );
      for (const resource of delivery.resources.filter(
        (resource) =>
          resource.kind === "resource" ||
          (resource.kind === "service" && resource.supply === "platform"),
      )) {
        const bindings = [
          "d1_databases",
          "kv_namespaces",
          "r2_buckets",
          "services",
          "queues",
        ].flatMap((field) => {
          const value = environment[field];
          return Array.isArray(value) ? value : record(value) ? Object.values(value).flat() : [];
        });
        if (!bindings.some((binding) => record(binding) && binding.binding === resource.name))
          put(
            "fail",
            "worker-binding",
            `Missing environment-local binding ${resource.name}.`,
            "Declare the binding in the target environment (not a secret value).",
          );
      }
    } else {
      if (
        Object.keys(config).some(
          (key) => !["entry", "environment", "outputDirectory"].includes(key),
        )
      )
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
    const build = taskFor(tasks, owner.name, "build");
    if (
      !build ||
      !texts(build.outputs).some((output) =>
        under(delivery.output ?? "", `${owner.path}/${output.replace(/\/\*\*$/, "")}`),
      )
    )
      put(
        "fail",
        "deployment-output",
        "Delivery output is not covered by the entry package's Turbo build outputs.",
        "Align build and deployment output directories.",
      );
    const outputFiles = await snapshot.files(delivery.output).catch((error: unknown) => {
      if (record(error) && error.code === "ENOENT") return [];
      throw error;
    });
    put(
      outputFiles.length ? "pass" : "unverified",
      "delivery-artifact",
      "Only existing output files are observed; no build, deploy or migration is executed.",
      "Produce and verify artifacts separately.",
    );
  } catch (error) {
    put(
      error instanceof SyntaxError || error instanceof TypeError ? "fail" : "unverified",
      "delivery-observation",
      error instanceof Error ? error.message : String(error),
      "Repair readable non-secret JSON configuration; unsupported observation is never success.",
    );
  }
}
