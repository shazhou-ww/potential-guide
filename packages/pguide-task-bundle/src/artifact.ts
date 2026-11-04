import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  artifactLimits,
  assertRuntime,
  parseArtifactYaml,
  readArtifactFiles,
  safePath,
} from "@potential-guide/artifact-files";
import {
  type JsonObject,
  resolveBundleSchemas,
  validateTaskBundle,
  validateTaskBundleFiles,
} from "@potential-guide/task-protocol";
import { CID } from "multiformats/cid";
import { exporter } from "ipfs-unixfs-exporter";
import { computeContentCid, validateContentCar } from "./car.js";

export async function inspectTaskArtifact(files: ReadonlyMap<string, Buffer>) {
  if (
    files.size > artifactLimits.files ||
    [...files.values()].reduce((total, content) => total + content.length, 0) > artifactLimits.bytes
  )
    throw new Error("Task Bundle exceeds artifact capacity.");
  const declaration = validateTaskBundle(
    parseArtifactYaml(files.get("task.yaml") ?? Buffer.alloc(0)),
  );
  validateTaskBundleFiles(declaration, files.keys());
  if (!files.get("worker.cjs")?.length)
    throw new Error("Task Bundle requires a nonempty worker.cjs.");
  new TextDecoder("utf-8", { fatal: true }).decode(files.get("worker.cjs"));
  assertRuntime(declaration);
  const schemas = [...files].filter(([path]) => path.startsWith("schemas/"));
  const resolved = resolveBundleSchemas(
    declaration,
    schemas.map(
      ([, bytes]) =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as JsonObject,
    ),
    schemas.map(([path]) => path),
  );
  const cid = await computeContentCid(files);
  return { declaration, resolved, cid, files: [...files.keys()].sort() };
}

/** Read one immutable directory or CAR snapshot, without author module evaluation. */
export async function readTaskArtifact(path: string) {
  const absolute = resolve(path);
  const info = await lstat(absolute, { bigint: true });
  if (info.isDirectory()) return { files: await readArtifactFiles(absolute) };
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1n ||
    (await realpath(absolute)) !== absolute
  )
    throw new Error("Task CAR must be a canonical regular file, without links or hard links.");
  if (info.size > BigInt(artifactLimits.archiveBytes))
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
          artifactLimits.archiveBytes - length + 1,
          Number(before.size) - length + 1,
        ),
      );
      const { bytesRead } = await handle.read(buffer);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > artifactLimits.archiveBytes)
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
    maxCarBytes: artifactLimits.archiveBytes,
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
      if (paths.size > artifactLimits.paths) throw new Error("Task CAR exceeds path capacity.");
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
      if (files.size >= artifactLimits.files) throw new Error("Task CAR exceeds file capacity.");
      const parts: Buffer[] = [];
      for await (const part of entry.content({ signal })) {
        total += part.byteLength;
        if (total > artifactLimits.bytes) throw new Error("Task CAR exceeds byte capacity.");
        parts.push(Buffer.from(part));
      }
      files.set(path, Buffer.concat(parts));
    } else throw new Error("Task CAR requires a directory of regular UnixFS files.");
  };
  await walk(cid, "");
  const checked = await inspectTaskArtifact(files);
  if (checked.cid !== cid) throw new Error("Task CAR root differs from its canonical file tree.");
  return { files, archive, cid };
}

export async function checkTaskArtifact(path: string) {
  return inspectTaskArtifact((await readTaskArtifact(path)).files);
}
