import { constants, type ReadStream } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isTaskBundlePath, taskBundleLimits } from "@potential-guide/task-protocol";

export async function readTaskArtifactFiles(
  directory: string,
): Promise<ReadonlyMap<string, Buffer>> {
  const input = resolve(directory);
  const info = await lstat(input);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Task artifact root must be a regular directory without links.");
  const root = await realpath(input);
  const files = new Map<string, Buffer>();
  const directories: string[] = [];
  const paths = new Set<string>();
  let total = 0;
  for await (const entry of await opendir(root, { recursive: true })) {
    const full = join(entry.parentPath, entry.name);
    const path = relative(root, full).split(sep).join("/");
    if (!isTaskBundlePath(path) || paths.has(path.toLowerCase()))
      throw new Error("Task artifact contains an unsafe or ambiguous path.");
    paths.add(path.toLowerCase());
    if (paths.size > taskBundleLimits.paths)
      throw new Error("Task artifact exceeds path capacity.");
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
      throw new Error("Task artifact links and special files are forbidden.");
    if (entry.isDirectory()) {
      directories.push(path);
      continue;
    }
    if (files.size >= taskBundleLimits.files)
      throw new Error("Task artifact exceeds file capacity.");
    const chunks: Buffer[] = [];
    let size = 0;
    const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let stream: ReadStream | undefined;
    try {
      stream = handle.createReadStream({
        autoClose: false,
        end: Math.min(taskBundleLimits.fileBytes, taskBundleLimits.bytes - total),
      });
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        total += bytes.length;
        if (size > taskBundleLimits.fileBytes || total > taskBundleLimits.bytes)
          throw new Error("Task artifact exceeds byte capacity.");
        chunks.push(bytes);
      }
    } finally {
      stream?.destroy();
      await handle.close();
    }
    files.set(path, Buffer.concat(chunks, size));
  }
  for (const directory of directories)
    if (![...files.keys()].some((path) => path.startsWith(`${directory}/`)))
      throw new Error("Task artifact contains an undeclared empty directory.");
  return files;
}
