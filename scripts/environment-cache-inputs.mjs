import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(
  new URL("../packages/check-environment/package.json", import.meta.url),
);
const { parse } = require("yaml");

/** Git hashes can erase binary CRLF differences. This key is only a build-cache input, not artifact identity. */
export async function environmentCacheInputs(root) {
  const directory = join(root, "packages", "check-environment");
  const inputs = new Set();
  for (const kind of ["tools", "directories", "network"]) {
    const config = parse(await readFile(join(directory, `${kind}.check.build.yaml`), "utf8"));
    if (!Array.isArray(config?.binary) || !config.binary.length) continue;
    for (const reference of Object.values(config.references ?? {})) {
      inputs.add(reference.check);
      for (const path of Object.values(reference.problems ?? {})) inputs.add(path);
    }
    for (const resource of config.resources ?? []) inputs.add(resource.from);
  }
  if (!inputs.size) return "default-text-v1";
  const hash = createHash("sha256");
  // Conservatively cover all resource inputs of checks with binary enabled.
  // Selection is still exclusively the compiler's final-path glob decision.
  for (const name of [...inputs].sort()) {
    if (
      typeof name !== "string" ||
      /[\\:]/.test(name) ||
      name.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error(`Unsafe environment cache input: ${name}`);
    const path = resolve(directory, name);
    if ((await realpath(path)) !== path || !(await lstat(path)).isFile())
      throw new Error(`Non-canonical environment cache input: ${name}`);
    const bytes = await readFile(path);
    hash.update(`${name.length}:${name}:${bytes.length}:`).update(bytes);
  }
  return hash.digest("hex");
}
