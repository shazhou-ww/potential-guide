import { isJsonValue } from "@potential-guide/objective-pilot";

export function canonicalJson(value: unknown): string {
  if (!isJsonValue(value)) throw new TypeError("Expected finite JSON data.");
  function normalize(entry: unknown): unknown {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry !== null && typeof entry === "object")
      return Object.fromEntries(
        Object.entries(entry)
          // Persisted identities use localeCompare, not code-point key ordering.
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, normalize(child)]),
      );
    return entry;
  }
  return JSON.stringify(normalize(value));
}
