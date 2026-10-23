import { createHash } from "node:crypto";
import { canonicalJson } from "@potential-guide/objective-portfolio-supervisor";

export function identityKey(kind: string, value: unknown): string {
  canonicalJson(value);
  // Identity encoding must not depend on the host's locale collation.
  const encoded = JSON.stringify(value, (_name, entry: unknown) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(
      Object.entries(entry).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    );
  });
  if (encoded === undefined) throw new TypeError("Identity must be JSON data.");
  return `${kind}:${createHash("sha256").update(encoded).digest("hex")}`;
}
