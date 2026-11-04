import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function finiteJson(value: unknown, depth = 0, seen = new Set<object>()): value is Json {
  if (depth > 32) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  const array = Array.isArray(value);
  if (
    array
      ? Object.getPrototypeOf(value) !== Array.prototype
      : Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null
  )
    return false;
  if (Object.getOwnPropertySymbols(value).length) return false;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && Object.keys(descriptors).length !== value.length + 1) return false;
  const valid = Object.entries(descriptors).every(
    ([key, descriptor]) =>
      (array && key === "length") ||
      ((!array || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)) &&
        descriptor.enumerable &&
        "value" in descriptor &&
        finiteJson(descriptor.value, depth + 1, seen)),
  );
  seen.delete(value);
  return valid;
}
export function parseArtifactYaml(bytes: Uint8Array): Json {
  if (bytes.length > 64 * 1024) throw new Error("YAML exceeds bounds.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const document = parseDocument(text, { schema: "core", uniqueKeys: true, strict: true });
  if (
    document.errors.length ||
    document.warnings.length ||
    document.directives?.yaml.explicit ||
    (document.directives?.tags && Object.keys(document.directives.tags).some((key) => key !== "!!"))
  )
    throw new Error("Invalid JSON-subset YAML.");
  function inspect(node: unknown, depth: number): void {
    if (depth > 32 || isAlias(node)) throw new Error("YAML aliases or excessive depth.");
    if (isMap(node) || isSeq(node) || isScalar(node)) {
      if (node.tag) throw new Error("YAML tags are forbidden.");
      if (isMap(node))
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== "string")
            throw new Error("YAML keys must be strings.");
          inspect(pair.value, depth + 1);
        }
      if (isSeq(node)) for (const child of node.items) inspect(child, depth + 1);
    }
  }
  inspect(document.contents, 0);
  const result: unknown = document.toJS({ maxAliasCount: 0 });
  if (!finiteJson(result)) throw new Error("YAML must contain finite JSON.");
  return result;
}
export function assertRuntime(
  manifest: { runtime: { type: "node"; minVersion: string } },
  actual = { type: "node", version: process.versions.node },
) {
  if (actual.type !== manifest.runtime.type) throw new Error("Unsupported Checker runtime.");
  const parse = (version: string) => {
    if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version))
      throw new Error("Invalid runtime version.");
    const values = version.split(".").map(Number);
    if (!values.every(Number.isSafeInteger)) throw new Error("Runtime version exceeds bounds.");
    return values;
  };
  const minimum = parse(manifest.runtime.minVersion);
  const installed = parse(actual.version);
  if ((installed[0] ?? 0) < 22 || (installed[0] === 22 && (installed[1] ?? 0) < 13))
    throw new Error("Runtime is below the Host support policy (Node 22.13.0).");
  for (let i = 0; i < 3; i++) {
    if ((installed[i] ?? 0) > (minimum[i] ?? 0)) return;
    if ((installed[i] ?? 0) < (minimum[i] ?? 0))
      throw new Error("Checker minimum runtime is unavailable.");
  }
}
