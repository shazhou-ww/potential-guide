import type { Json } from "./worker-types.js";

export function isJson(value: unknown, depth = 0, ancestors = new Set<object>()): value is Json {
  if (depth > 64) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  const array = Array.isArray(value);
  if (
    !array &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  const keys = Object.keys(value);
  if (
    Object.getOwnPropertySymbols(value).length ||
    Object.getOwnPropertyNames(value).length !== keys.length + (array ? 1 : 0)
  )
    return false;
  if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index))))
    return false;
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const valid = keys.every((key) => {
    const descriptor = descriptors[key];
    return (
      descriptor !== undefined &&
      "value" in descriptor &&
      isJson(descriptor.value, depth + 1, ancestors)
    );
  });
  ancestors.delete(value);
  return valid;
}
