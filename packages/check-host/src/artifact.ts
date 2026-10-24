import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { HostError } from "./types.js";

const limit = 64 * 1024 * 1024;
export async function readArtifact(directory: string) {
  if (!isAbsolute(directory)) throw new HostError(400, "Worker directory must be absolute.");
  const canonical = await realpath(directory);
  const files = new Map<string, Buffer>();
  const executables = new Set<string>();
  let size = 0;
  async function visit(path: string) {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (entry.name.toLowerCase() === "node_modules" || /[:\\]/.test(entry.name))
        throw new HostError(400, "Artifact contains a forbidden path.");
      const full = join(path, entry.name);
      const details = await lstat(full, { bigint: true });
      if (details.isSymbolicLink() || (!details.isFile() && !details.isDirectory()))
        throw new HostError(400, "Artifact links and special files are forbidden.");
      if ((await realpath(full)) !== full)
        throw new HostError(400, "Artifact path changed while reading.");
      if (details.isDirectory()) {
        await visit(full);
        continue;
      }
      if (
        details.nlink !== 1n ||
        details.size > BigInt(limit) ||
        size + Number(details.size) > limit
      )
        throw new HostError(413, "Artifact exceeds size or hard-link boundary.");
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
          throw new HostError(409, "Artifact changed while reading.");
        if (before.size > BigInt(limit) || size + Number(before.size) > limit)
          throw new HostError(413, "Artifact exceeds size boundary.");
        bytes = await handle.readFile();
        const after = await handle.stat({ bigint: true });
        if (
          after.mtimeNs !== before.mtimeNs ||
          after.ctimeNs !== before.ctimeNs ||
          after.nlink !== 1n ||
          BigInt(bytes.length) !== before.size
        )
          throw new HostError(409, "Artifact changed while reading.");
      } finally {
        await handle.close();
      }
      size += bytes.length;
      if (size > limit || files.size >= 256) throw new HostError(413, "Artifact exceeds bounds.");
      const name = relative(canonical, full).split(sep).join("/");
      files.set(name, bytes);
      if ((Number(details.mode) & 0o111) !== 0) executables.add(name);
    }
  }
  await visit(canonical);
  if (!files.has("worker.cjs"))
    throw new HostError(400, "Expected self-contained worker.cjs; legacy run.* is unsupported.");
  const hash = createHash("sha256");
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    hash
      .update(
        JSON.stringify(executables.has(name) ? [name, bytes.length, true] : [name, bytes.length]),
      )
      .update("\0")
      .update(bytes);
  }
  return { directory: canonical, revision: hash.digest("hex"), files, executables };
}

export async function snapshotArtifact(
  artifact: Awaited<ReturnType<typeof readArtifact>>,
  root: string,
): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = join(root, randomUUID());
  await mkdir(target, { mode: 0o700 });
  try {
    for (const [name, bytes] of artifact.files) {
      const parts = name.split("/");
      const path = join(target, ...parts);
      await mkdir(join(target, ...parts.slice(0, -1)), { recursive: true, mode: 0o700 });
      const mode = artifact.executables.has(name) ? 0o500 : 0o400;
      await writeFile(path, bytes, { flag: "wx", mode });
      await chmod(path, mode);
    }
    return target;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

/** Stable per business binding; the host still independently verifies every byte. */
export async function publishArtifact(source: string, destination: string): Promise<string> {
  const artifact = await readArtifact(source);
  await mkdir(join(destination, ".."), { recursive: true, mode: 0o700 });
  const lock = `${destination}.lock`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      handle = await open(lock, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!handle) throw new HostError(409, "Artifact publication is busy.");
  let prepared: string | undefined;
  const previous = `${destination}.${randomUUID()}`;
  let moved = false;
  let installed = false;
  try {
    await handle.close();
    try {
      if ((await readArtifact(destination)).revision === artifact.revision)
        return artifact.revision;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    prepared = await snapshotArtifact(artifact, join(destination, ".."));
    try {
      await rename(destination, previous);
      moved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(prepared, destination);
    installed = true;
  } catch (error) {
    if (moved && !installed) {
      try {
        await rename(previous, destination);
      } catch (rollback) {
        throw new AggregateError(
          [error, rollback],
          `Artifact rollback failed; previous artifact retained at ${previous}.`,
        );
      }
    }
    throw error;
  } finally {
    if (prepared !== undefined) await rm(prepared, { recursive: true, force: true });
    if (moved && installed) await rm(previous, { recursive: true, force: true });
    await rm(lock, { force: true });
  }
  return artifact.revision;
}
