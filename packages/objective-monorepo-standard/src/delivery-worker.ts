import { dirname, relative, resolve, sep } from "node:path";
import type { Delivery, Workspace } from "./contract.js";
import { checkWorkerBindings, checkWorkerVariables } from "./delivery-worker-bindings.js";

import type { ReportPut } from "./shared.js";
import { type RecordValue, record } from "./shared.js";

export function checkWorkerConfiguration(
  config: RecordValue,
  delivery: Delivery,
  owner: Workspace,
  root: string,
  configPath: string,
  environmentName: string,
  put: ReportPut,
) {
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

  const environment = envs[environmentName];

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
  checkWorkerVariables(delivery, environment, put);

  const expected = relative(
    root,
    resolve(root, dirname(configPath), typeof main === "string" ? main : ""),
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
    !/^\d{4}-\d{2}-\d{2}$/.test(String(environment.compatibility_date ?? config.compatibility_date))
  )
    put(
      "fail",
      "worker-schema",
      "Wrangler name or compatibility_date is invalid.",
      "Declare explicit Worker metadata.",
    );
  checkWorkerBindings(delivery, environment, put);
  return environment;
}
