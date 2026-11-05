import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCheck } from "@potential-guide/check-sdk/authoring";

export async function prepareEnvironment(root) {
  const checks = [];
  for (const kind of ["tools", "directories", "network"])
    checks.push(await prepareCheck(resolve(root, `${kind}.check.build.yaml`)));
  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await prepareEnvironment(fileURLToPath(new URL(".", import.meta.url)));
