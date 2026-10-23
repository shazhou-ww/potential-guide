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
  let size = 0;
  async function visit(path: string) {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (entry.name === "node_modules" || /[:\\]/.test(entry.name))
        throw new HostError(400, "Artifact contains a forbidden path.");
      const full = join(path, entry.name);
      const details = await lstat(full);
      if (details.isSymbolicLink() || (!details.isFile() && !details.isDirectory()))
        throw new HostError(400, "Artifact links and special files are forbidden.");
      if ((await realpath(full)) !== full)
        throw new HostError(400, "Artifact path changed while reading.");
      if (details.isDirectory()) {
        await visit(full);
        continue;
      }
      if (details.nlink !== 1 || details.size > limit || size + details.size > limit)
        throw new HostError(413, "Artifact exceeds size or hard-link boundary.");
      const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let bytes: Buffer;
      try {
        const before = await handle.stat();
        if (before.ino !== details.ino || before.dev !== details.dev || !before.isFile())
          throw new HostError(409, "Artifact changed while reading.");
        bytes = await handle.readFile();
        const after = await handle.stat();
        if (
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs ||
          bytes.length !== before.size
        )
          throw new HostError(409, "Artifact changed while reading.");
      } finally {
        await handle.close();
      }
      size += bytes.length;
      if (size > limit || files.size >= 256) throw new HostError(413, "Artifact exceeds bounds.");
      files.set(relative(canonical, full).split(sep).join("/"), bytes);
    }
  }
  await visit(canonical);
  if (!files.has("worker.cjs"))
    throw new HostError(400, "Expected self-contained worker.cjs; legacy run.* is unsupported.");
  const hash = createHash("sha256");
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    hash
      .update(JSON.stringify([name, bytes.length]))
      .update("\0")
      .update(bytes);
  }
  return { directory: canonical, revision: hash.digest("hex"), files };
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
      await writeFile(path, bytes, { flag: "wx", mode: 0o400 });
      await chmod(path, 0o400);
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
