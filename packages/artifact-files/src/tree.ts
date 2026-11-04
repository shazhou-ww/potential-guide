import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export class ArtifactTreeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const limit = 64 * 1024 * 1024;
export interface ArtifactTreeLimits {
  bytes: number;
  fileBytes: number;
  files: number;
  paths: number;
}
/** Generic bounded no-follow tree reader; execution eligibility is checked by readArtifact. */
export async function readArtifactTree(
  directory: string,
  configuration: Partial<ArtifactTreeLimits> = {},
) {
  const limits: ArtifactTreeLimits = {
    bytes: limit,
    fileBytes: limit,
    files: 256,
    paths: 512,
    ...configuration,
  };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value <= 0))
    throw new ArtifactTreeError(400, "Invalid artifact tree capacity.");
  if (!isAbsolute(directory))
    throw new ArtifactTreeError(400, "Worker directory must be absolute.");
  const canonical = await realpath(directory);
  const files = new Map<string, Buffer>();
  const executables = new Set<string>();
  let size = 0;
  let paths = 0;
  async function visit(path: string) {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (++paths > limits.paths) throw new ArtifactTreeError(413, "Artifact exceeds path bounds.");
      if (entry.name.toLowerCase() === "node_modules" || /[:\\]/.test(entry.name))
        throw new ArtifactTreeError(400, "Artifact contains a forbidden path.");
      const full = join(path, entry.name);
      const details = await lstat(full, { bigint: true });
      if (details.isSymbolicLink() || (!details.isFile() && !details.isDirectory()))
        throw new ArtifactTreeError(400, "Artifact links and special files are forbidden.");
      if ((await realpath(full)) !== full)
        throw new ArtifactTreeError(400, "Artifact path changed while reading.");
      if (details.isDirectory()) {
        await visit(full);
        continue;
      }
      if (files.size >= limits.files)
        throw new ArtifactTreeError(413, "Artifact exceeds file bounds.");
      if (
        details.nlink !== 1n ||
        details.size > BigInt(limits.fileBytes) ||
        size + Number(details.size) > limits.bytes
      )
        throw new ArtifactTreeError(413, "Artifact exceeds size or hard-link boundary.");
      const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let bytes: Buffer;
      try {
        const before = await handle.stat({ bigint: true });
        // Node 22 on Windows reports no volume ID in path stats, but does in handle stats.
        const missingDevice = process.platform === "win32" && details.dev === 0n;
        if (
          before.ino !== details.ino ||
          (!missingDevice && before.dev !== details.dev) ||
          !before.isFile() ||
          before.nlink !== 1n
        )
          throw new ArtifactTreeError(409, "Artifact changed while reading.");
        if (before.size > BigInt(limits.fileBytes) || size + Number(before.size) > limits.bytes)
          throw new ArtifactTreeError(413, "Artifact exceeds size boundary.");
        const chunks: Buffer[] = [];
        let length = 0;
        for (;;) {
          const chunk = Buffer.alloc(
            Math.min(65_536, limits.fileBytes - length + 1, limits.bytes - size - length + 1),
          );
          const { bytesRead } = await handle.read(chunk);
          if (!bytesRead) break;
          length += bytesRead;
          if (length > limits.fileBytes || size + length > limits.bytes)
            throw new ArtifactTreeError(413, "Artifact exceeds size boundary.");
          chunks.push(chunk.subarray(0, bytesRead));
        }
        bytes = Buffer.concat(chunks, length);
        const after = await handle.stat({ bigint: true });
        if (
          after.mtimeNs !== before.mtimeNs ||
          after.ctimeNs !== before.ctimeNs ||
          after.nlink !== 1n ||
          BigInt(bytes.length) !== before.size
        )
          throw new ArtifactTreeError(409, "Artifact changed while reading.");
      } finally {
        await handle.close();
      }
      size += bytes.length;
      if (size > limits.bytes || files.size >= limits.files)
        throw new ArtifactTreeError(413, "Artifact exceeds bounds.");
      const name = relative(canonical, full).split(sep).join("/");
      files.set(name, bytes);
      if ((Number(details.mode) & 0o111) !== 0) executables.add(name);
    }
  }
  await visit(canonical);
  return { directory: canonical, files, executables };
}
