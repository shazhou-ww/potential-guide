import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isTaskBundlePath as safePath,
  readTaskBundle,
  taskBundleLimits,
} from "@potential-guide/task-protocol";
import { CID } from "multiformats/cid";
import { exporter } from "ipfs-unixfs-exporter";
import { computeContentCid, validateContentCar } from "./car.js";
import { readTaskArtifactFiles } from "./local-files.js";
import { assertTaskRuntime } from "./runtime.js";

export async function inspectTaskArtifact(files: ReadonlyMap<string, Buffer>) {
  const { declaration, resolved } = readTaskBundle(files);
  assertTaskRuntime(declaration);
  const cid = await computeContentCid(files);
  return { declaration, resolved, cid, files: [...files.keys()].sort() };
}

/** Read one immutable directory or CAR snapshot, without author module evaluation. */
export async function readTaskArtifact(path: string, expectedCid?: string) {
  const absolute = resolve(path);
  const info = await lstat(absolute, { bigint: true });
  if (info.isDirectory()) {
    const files = await readTaskArtifactFiles(absolute);
    const { cid } = await inspectTaskArtifact(files);
    if (expectedCid !== undefined && !CID.parse(cid).toV1().equals(CID.parse(expectedCid).toV1()))
      throw new Error("Task artifact CID does not match expected CID.");
    return { files, cid };
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1n ||
    (await realpath(absolute)) !== absolute
  )
    throw new Error("Task CAR must be a canonical regular file, without links or hard links.");
  if (info.size > BigInt(taskBundleLimits.archiveBytes))
    throw new Error("Task CAR exceeds artifact capacity.");
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    const before = await handle.stat({ bigint: true });
    const missingDevice = process.platform === "win32" && info.dev === 0n;
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.ino !== info.ino ||
      (!missingDevice && before.dev !== info.dev) ||
      before.size !== info.size ||
      before.mtimeNs !== info.mtimeNs ||
      before.ctimeNs !== info.ctimeNs
    )
      throw new Error("Task CAR changed while reading.");
    for (;;) {
      const buffer = Buffer.alloc(
        Math.min(
          65_536,
          taskBundleLimits.archiveBytes - length + 1,
          Number(before.size) - length + 1,
        ),
      );
      const { bytesRead } = await handle.read(buffer);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > taskBundleLimits.archiveBytes)
        throw new Error("Task CAR exceeds artifact capacity.");
      if (BigInt(length) > before.size) throw new Error("Task CAR changed while reading.");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolute, { bigint: true });
    const missingPathDevice = process.platform === "win32" && pathAfter.dev === 0n;
    if (
      !after.isFile() ||
      after.nlink !== 1n ||
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      BigInt(length) !== before.size ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      pathAfter.nlink !== 1n ||
      pathAfter.ino !== after.ino ||
      (!missingPathDevice && pathAfter.dev !== after.dev) ||
      pathAfter.size !== after.size ||
      pathAfter.mtimeNs !== after.mtimeNs ||
      pathAfter.ctimeNs !== after.ctimeNs ||
      (await realpath(absolute)) !== absolute
    )
      throw new Error("Task CAR changed while reading.");
  } finally {
    await handle.close();
  }
  const archive = Buffer.concat(chunks, length);
  const { cid, blockstore } = await validateContentCar(archive, undefined, {
    maxCarBytes: taskBundleLimits.archiveBytes,
  });
  const signal = new AbortController().signal;
  const files = new Map<string, Buffer>();
  const paths = new Set<string>();
  let total = 0;
  const walk = async (root: string, path: string): Promise<void> => {
    if (path) {
      if (!safePath(path) || paths.has(path.toLowerCase()))
        throw new Error("Task CAR contains an unsafe or ambiguous path.");
      paths.add(path.toLowerCase());
      if (paths.size > taskBundleLimits.paths) throw new Error("Task CAR exceeds path capacity.");
    }
    const entry = await exporter(CID.parse(root), blockstore, { signal });
    if (entry.type === "directory") {
      let children = 0;
      for await (const child of entry.entries({ signal })) {
        if (!child.name || child.name.includes("/") || child.name.includes("\\"))
          throw new Error("Task CAR contains an unsafe directory name.");
        await walk(child.cid.toString(), path ? `${path}/${child.name}` : child.name);
        children++;
      }
      if (path && !children) throw new Error("Task CAR contains an empty directory.");
    } else if (
      path &&
      (entry.type === "raw" ||
        (entry.type === "file" && ["file", "raw"].includes(entry.unixfs.type)))
    ) {
      if (files.size >= taskBundleLimits.files) throw new Error("Task CAR exceeds file capacity.");
      const parts: Buffer[] = [];
      for await (const part of entry.content({ signal })) {
        total += part.byteLength;
        if (total > taskBundleLimits.bytes) throw new Error("Task CAR exceeds byte capacity.");
        parts.push(Buffer.from(part));
      }
      files.set(path, Buffer.concat(parts));
    } else throw new Error("Task CAR requires a directory of regular UnixFS files.");
  };
  await walk(cid, "");
  const checked = await inspectTaskArtifact(files);
  if (checked.cid !== cid) throw new Error("Task CAR root differs from its canonical file tree.");
  if (expectedCid !== undefined && !CID.parse(cid).toV1().equals(CID.parse(expectedCid).toV1()))
    throw new Error("Task artifact CID does not match expected CID.");
  return { files, archive, cid };
}

export async function checkTaskArtifact(path: string, expectedCid?: string) {
  return inspectTaskArtifact((await readTaskArtifact(path, expectedCid)).files);
}
