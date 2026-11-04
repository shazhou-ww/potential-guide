import { lstat, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { artifactLimits, safePath } from "./paths.js";
import { type ArtifactTreeLimits, readArtifactTree } from "./tree.js";

export async function readPortableTree(
  directory: string,
  configuration: Partial<ArtifactTreeLimits> = {},
) {
  const limits = { ...artifactLimits, ...configuration };
  const root = resolve(directory);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error("Artifact root must be a canonical regular directory.");
  const seen = new Set<string>();
  const directories: string[] = [];
  async function visit(path: string, prefix: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (!safePath(name) || seen.has(name.toLowerCase()))
        throw new Error("Artifact contains an unsafe or ambiguous path.");
      seen.add(name.toLowerCase());
      if (seen.size > limits.paths) throw new Error("Artifact exceeds path bounds.");
      if (entry.isDirectory()) {
        directories.push(name);
        await visit(join(path, entry.name), `${name}/`);
      } else if (!entry.isFile())
        throw new Error("Artifact links and special files are forbidden.");
    }
  }
  await visit(root, "");
  const artifact = await readArtifactTree(root, configuration);
  return { files: artifact.files, directories };
}
export function rejectEmptyDirectories(
  files: ReadonlyMap<string, Buffer>,
  directories: readonly string[],
) {
  if (directories.some((name) => ![...files.keys()].some((file) => file.startsWith(`${name}/`))))
    throw new Error("Artifact contains an undeclared empty directory.");
}
/** Bounded, no-link portable tree reader shared by declarative artifact consumers. */
export async function readArtifactFiles(
  directory: string,
  configuration: Partial<ArtifactTreeLimits> = {},
): Promise<ReadonlyMap<string, Buffer>> {
  const { files, directories } = await readPortableTree(directory, configuration);
  rejectEmptyDirectories(files, directories);
  return files;
}
