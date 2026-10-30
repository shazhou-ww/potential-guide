import { isAbsolute, parse, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Syntax only. No existence, authorization, filesystem or runtime checks. */
export function parseFileArtifactUrl(text: string): string {
  if (typeof text !== "string" || text.length > 4096) throw new Error("Invalid file URL.");
  const url = new URL(text);
  if (
    url.protocol !== "file:" ||
    !text.startsWith("file:///") ||
    text.endsWith("/") ||
    url.hostname ||
    url.username ||
    url.password ||
    text.includes("?") ||
    text.includes("#") ||
    url.href !== text
  )
    throw new Error("Expected a canonical local file URL without host, query or fragment.");
  const path = fileURLToPath(url);
  if (
    !isAbsolute(path) ||
    pathToFileURL(path).href !== text ||
    [...path].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    path !== path.normalize("NFC")
  )
    throw new Error("Invalid canonical file path.");
  if (process.platform === "win32") {
    if (!/^[A-Za-z]:\\/.test(path)) throw new Error("Network and device paths are forbidden.");
    const components = path.slice(parse(path).root.length).split(sep).filter(Boolean);
    if (
      components.some(
        (part) =>
          /[<>:"|?*]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
            part,
          ),
      )
    )
      throw new Error("Unsafe Windows file path.");
  } else if (path.startsWith("//") || path.includes("\\")) {
    throw new Error("Network and ambiguous file paths are forbidden.");
  }
  return path;
}
