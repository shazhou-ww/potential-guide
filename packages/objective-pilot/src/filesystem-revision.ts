import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

const excluded = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".staging",
  ".turbo",
  ".next",
  ".wrangler",
  "coverage",
]);
const secret =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|[^/]*\.(?:pem|key|p12)|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?)(?:\/|$)/i;

export interface FilesystemObservationUnavailable {
  readonly reason: "input-changed" | "inventory-limit" | "byte-limit" | "unreadable";
  readonly code?: string;
}

class CaptureUnavailable extends Error {
  constructor(
    readonly reason: FilesystemObservationUnavailable["reason"],
    message: string,
  ) {
    super(message);
  }
}

const unavailableCodes = new Set([
  "ENOENT",
  "ENOTDIR",
  "EACCES",
  "EPERM",
  "EBUSY",
  "ELOOP",
  "EISDIR",
  "ESTALE",
  "EMFILE",
  "ENFILE",
  "EIO",
]);

function unavailable(
  error: unknown,
  signal: AbortSignal,
  phase: string,
  report?: (value: FilesystemObservationUnavailable) => void,
): undefined {
  signal.throwIfAborted();
  let diagnostic: FilesystemObservationUnavailable;
  if (error instanceof CaptureUnavailable) diagnostic = { reason: error.reason };
  else if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    "syscall" in error &&
    typeof error.syscall === "string" &&
    unavailableCodes.has(error.code)
  )
    diagnostic = { reason: "unreadable", code: error.code };
  else throw error;
  if (report !== undefined) report(diagnostic);
  else if (process.env.PGUIDE_TIMINGS === "1")
    process.stderr.write(
      `${JSON.stringify({
        type: "pguide-timing",
        phase,
        status: "unavailable",
        ...diagnostic,
      })}\n`,
    );
  return undefined;
}

/** Revision for the bounded, read-only filesystem observation contract.
 * Includes names, types and readable bytes, including build outputs. It does not
 * follow links or read secret values. This is not a general check purity detector.
 */
export interface FilesystemObservationView {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly entries: Record<
    string,
    {
      readonly kind: "link" | "directory" | "file" | "other";
      readonly size?: number;
      readonly text?: string;
      readonly encodedBytes?: string;
    }
  >;
}

async function collect(
  root: string,
  signal: AbortSignal,
  capture = false,
): Promise<{ revision: string; view: FilesystemObservationView }> {
  signal.throwIfAborted();
  const hash = createHash("sha256");
  let count = 0;
  let bytes = 0;
  const directory = await realpath(root);
  function samePath(left: string, right: string): boolean {
    return process.platform === "win32"
      ? left.toLowerCase() === right.toLowerCase()
      : left === right;
  }
  const entries: FilesystemObservationView["entries"] = Object.create(null);
  entries[""] = { kind: "directory" };
  hash.update(JSON.stringify(directory));
  async function walk(path: string): Promise<void> {
    signal.throwIfAborted();
    const absolute = join(directory, path);
    if (!samePath(await realpath(absolute), absolute))
      throw new CaptureUnavailable("input-changed", "Input directory changed to a symbolic link.");
    const children = (await readdir(absolute, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of children) {
      signal.throwIfAborted();
      if (excluded.has(entry.name)) continue;
      if (++count > 40_000)
        throw new CaptureUnavailable("inventory-limit", "Revision inventory limit exceeded.");
      const relative = path ? `${path}/${entry.name}` : entry.name;
      const file = join(directory, relative);
      const info = await lstat(file);
      const kind = info.isSymbolicLink()
        ? "link"
        : info.isDirectory()
          ? "directory"
          : info.isFile()
            ? "file"
            : "other";
      hash.update(JSON.stringify([relative, kind]));
      if (capture) entries[relative] = { kind, ...(info.isFile() ? { size: info.size } : {}) };
      if (info.isDirectory() && !secret.test(relative)) await walk(relative);
      else if (info.isFile()) {
        hash.update(JSON.stringify(info.size));
        if (!secret.test(relative) && info.size <= 1024 * 1024) {
          bytes += info.size;
          if (bytes > 128 * 1024 * 1024)
            throw new CaptureUnavailable("byte-limit", "Revision byte limit exceeded.");
          if (!samePath(await realpath(file), file))
            throw new CaptureUnavailable("input-changed", "Input path changed to a symbolic link.");
          const handle = await open(file, "r");
          const content = await (async () => {
            try {
              const opened = await handle.stat();
              if (
                !opened.isFile() ||
                opened.dev !== info.dev ||
                opened.ino !== info.ino ||
                opened.size !== info.size
              )
                throw new CaptureUnavailable(
                  "input-changed",
                  "Input changed while opening a file.",
                );
              return await handle.readFile();
            } finally {
              await handle.close();
            }
          })();
          if (content.length !== info.size)
            throw new CaptureUnavailable("input-changed", "Input changed during revision.");
          hash.update(content);
          if (capture)
            entries[relative] = {
              kind: "file",
              size: info.size,
              text: content.toString("utf8"),
              ...((content[0] === 0xff && content[1] === 0xfe) ||
              (content[0] === 0xfe && content[1] === 0xff)
                ? { encodedBytes: content.toString("base64") }
                : {}),
            };
        }
      }
    }
  }
  await walk("");
  signal.throwIfAborted();
  return { revision: hash.digest("hex"), view: { schemaVersion: 1, root: directory, entries } };
}

export async function filesystemObservationRevision(
  root: string,
  signal: AbortSignal,
  onUnavailable?: (value: FilesystemObservationUnavailable) => void,
): Promise<string | undefined> {
  try {
    return (await collect(root, signal)).revision;
  } catch (error) {
    return unavailable(error, signal, "filesystem.revision", onUnavailable);
  }
}

/** Capture host-owned facts and verify them against a second byte traversal.
 * A changing or oversized target falls back to ordinary live, uncached checks.
 */
export async function captureFilesystemObservation(
  root: string,
  signal: AbortSignal,
  onUnavailable?: (value: FilesystemObservationUnavailable) => void,
): Promise<FilesystemObservationView | undefined> {
  try {
    const captured = await collect(root, signal, true);
    const verified = await collect(root, signal);
    if (captured.revision !== verified.revision)
      throw new CaptureUnavailable("input-changed", "Input changed between capture traversals.");
    return captured.view;
  } catch (error) {
    return unavailable(error, signal, "input-view.capture", onUnavailable);
  }
}
