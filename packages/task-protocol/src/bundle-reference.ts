import { fail, type JsonObject } from "./json.js";

export interface BundleReference extends JsonObject {
  url: string;
  digest: string;
}

export function validateBundleReference(value: unknown): BundleReference {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "digest,url"
  )
    fail("invalid_request", "A complete Bundle {url,digest} reference is required.");
  const ref = value as BundleReference;
  if (typeof ref.url !== "string" || ref.url.length > 4096)
    fail("invalid_request", "Invalid Bundle URL.");
  if (typeof ref.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(ref.digest))
    fail("invalid_request", "Invalid Bundle content Digest.");
  let url: URL;
  try {
    url = new URL(ref.url);
  } catch {
    return fail("invalid_request", "Invalid Bundle URL.");
  }
  if (
    !["file:", "https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    ref.url.includes("#") ||
    (url.protocol === "file:" && (url.search || (url.hostname && url.hostname !== "localhost")))
  )
    fail("invalid_request", "Unsupported Bundle URL.");
  return { url: ref.url, digest: ref.digest };
}

export function parseBundleReference(value: string): BundleReference {
  if (typeof value !== "string")
    fail("invalid_request", "A complete Bundle URL#Digest reference is required.");
  const separator = value.indexOf("#");
  if (separator < 0) fail("invalid_request", "A complete Bundle URL#Digest reference is required.");
  return validateBundleReference({
    url: value.slice(0, separator),
    digest: value.slice(separator + 1),
  });
}

export function formatBundleReference(value: BundleReference): string {
  const ref = validateBundleReference(value);
  return `${ref.url}#${ref.digest}`;
}
