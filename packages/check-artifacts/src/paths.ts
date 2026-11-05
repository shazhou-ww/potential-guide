import { posix } from "node:path";
import sanitize from "sanitize-filename";

export const artifactLimits = Object.freeze({
  bytes: 64 * 1024 * 1024,
  files: 256,
  paths: 512,
  archiveBytes: 72 * 1024 * 1024,
  expandedTarBytes: 66 * 1024 * 1024,
});

export function safeComponent(name: string): boolean {
  return (
    !!name &&
    name === name.normalize("NFC") &&
    name.toLowerCase() !== "node_modules" &&
    sanitize(name) === name
  );
}

export function safePath(path: string): boolean {
  return (
    !posix.isAbsolute(path) &&
    posix.normalize(path) === path &&
    Buffer.byteLength(path) <= 1024 &&
    path.split("/").every(safeComponent)
  );
}
