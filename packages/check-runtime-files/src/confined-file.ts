import { constants, type BigIntStats } from "node:fs";
import { type FileHandle, lstat, open } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { readWindowsFile } from "./confined-file-windows.js";

export class ConfinedFileError extends Error {
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(`Confined archive read failed (${code}).`, options);
    this.name = "ConfinedFileError";
  }
}
function localAbsolute(path: string): boolean {
  return (
    typeof path === "string" &&
    isAbsolute(path) &&
    (process.platform === "win32" ? /^[A-Za-z]:[\\/]/.test(path) : !path.startsWith("//"))
  );
}
function canonicalPath(path: string): string {
  const value = resolve(path);
  return process.platform === "win32" ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
export function normalizeFileRoots(roots: readonly string[]): readonly string[] {
  return roots.map((root) => {
    if (!localAbsolute(root)) throw new ConfinedFileError("file_denied");
    return canonicalPath(root);
  });
}
/** Lexical policy only; physical confinement still requires readConfinedFile's handle walk. */
export function filePathAllowed(path: string, roots: readonly string[]): boolean {
  if (!localAbsolute(path)) return false;
  const candidate = canonicalPath(path);
  return roots.some((root) => {
    if (!localAbsolute(root)) return false;
    const granted = canonicalPath(root);
    const child = relative(granted, candidate);
    return (
      child.length > 0 &&
      !isAbsolute(child) &&
      child !== ".." &&
      !child.startsWith(`..${sep}`) &&
      join(granted, child) === candidate
    );
  });
}
export function fileReadError(error: unknown): ConfinedFileError {
  if (error instanceof ConfinedFileError) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return new ConfinedFileError("file_missing");
  if (["ELOOP", "ENOTDIR", "EACCES", "EPERM"].includes(code ?? ""))
    return new ConfinedFileError("file_denied");
  return new ConfinedFileError("file_unavailable");
}
type Metadata = BigIntStats;

/** Every component is opened relative to an already pinned directory descriptor. */
export async function readConfinedFile(
  path: string,
  roots: readonly string[],
  maximum: number,
  signal: AbortSignal,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 128 * 1024 * 1024)
    throw new ConfinedFileError("file_too_large");
  if (!localAbsolute(path)) throw new ConfinedFileError("file_denied");
  if (path.endsWith(sep) || (process.platform === "win32" && path.endsWith("/")))
    throw new ConfinedFileError("file_not_regular");
  path = canonicalPath(path);
  const normalized = normalizeFileRoots(roots);
  if (
    !filePathAllowed(path, normalized) ||
    (process.platform === "win32" && (!/^[A-Za-z]:\\/.test(path) || path.slice(3).includes(":")))
  )
    throw new ConfinedFileError("file_denied");
  signal.throwIfAborted();
  if (process.platform === "win32") {
    const root = normalized.find((root) => filePathAllowed(path, [root]));
    if (!root) throw new ConfinedFileError("file_denied");
    try {
      return await readWindowsFile(path, root, maximum, signal);
    } catch (error) {
      signal.throwIfAborted();
      throw fileReadError(error);
    }
  }
  const handles: FileHandle[] = [];
  if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY || !constants.O_NONBLOCK)
    throw new ConfinedFileError("file_unsupported");
  const links: { path: string; stat: Metadata }[] = [];
  const same = (a: Metadata, b: Metadata) => a.dev === b.dev && a.ino === b.ino;
  const descriptorRoot = process.platform === "linux" ? "/proc/self/fd" : "/dev/fd";
  try {
    const root = parse(path).root;
    let parent = await open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    handles.push(parent);
    const parts = path.slice(root.length).split(sep).filter(Boolean);
    if (!parts.length) throw new ConfinedFileError("file_not_regular");
    for (const [index, component] of parts.entries()) {
      signal.throwIfAborted();
      const base = join(descriptorRoot, String(parent.fd));
      try {
        const descriptor = await open(base, constants.O_RDONLY | constants.O_DIRECTORY);
        handles.push(descriptor);
        if (!same(await descriptor.stat({ bigint: true }), await parent.stat({ bigint: true })))
          throw new ConfinedFileError("file_changed");
      } catch (error) {
        if (error instanceof ConfinedFileError) throw error;
        throw new ConfinedFileError("file_unsupported");
      }
      const entry = join(base, component);
      const final = index === parts.length - 1;
      const handle = await open(
        entry,
        constants.O_RDONLY |
          constants.O_NOFOLLOW |
          (final ? constants.O_NONBLOCK : constants.O_DIRECTORY),
      );
      handles.push(handle);
      const before = await handle.stat({ bigint: true });
      links.push({ path: entry, stat: before });
      if (!final) {
        parent = handle;
        continue;
      }
      if (!before.isFile() || before.nlink !== 1n) throw new ConfinedFileError("file_not_regular");
      if (before.size > BigInt(maximum)) throw new ConfinedFileError("file_too_large");
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        signal.throwIfAborted();
        const chunk = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - total));
        const { bytesRead } = await handle.read(chunk);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > maximum) throw new ConfinedFileError("file_too_large");
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const after = await handle.stat({ bigint: true });
      if (
        !same(before, after) ||
        after.nlink !== 1n ||
        BigInt(total) !== before.size ||
        after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs
      )
        throw new ConfinedFileError("file_changed");
      for (const link of links) {
        const current = await lstat(link.path, { bigint: true });
        if (current.isSymbolicLink() || !same(link.stat, current))
          throw new ConfinedFileError("file_changed");
      }
      signal.throwIfAborted();
      return Buffer.concat(chunks, total);
    }
    throw new ConfinedFileError("file_not_regular");
  } catch (error) {
    signal.throwIfAborted();
    throw fileReadError(error);
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }
}
