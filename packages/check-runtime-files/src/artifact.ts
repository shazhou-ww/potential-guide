import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ArtifactTreeError,
  type ArtifactTreeLimits,
  readArtifactTree as readTree,
} from "@potential-guide/artifact-files";
import { HostError } from "./error.js";

export type { ArtifactTreeLimits } from "@potential-guide/artifact-files";
export async function readArtifactTree(
  directory: string,
  configuration: Partial<ArtifactTreeLimits> = {},
) {
  try {
    return await readTree(directory, configuration);
  } catch (error) {
    if (error instanceof ArtifactTreeError) throw new HostError(error.status, error.message);
    throw error;
  }
}
export async function readArtifact(directory: string) {
  const { directory: canonical, files, executables } = await readArtifactTree(directory);
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
