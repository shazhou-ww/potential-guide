import { encodeContentCar } from "./codec.js";
import { openContent, type ContentAccessOptions, type IpfsClient } from "./read.js";

/** Snapshot a bounded canonical UnixFS tree; reject alternative imports, links and empty dirs. */
export async function readContentTree(
  client: IpfsClient,
  cid: string,
  options: ContentAccessOptions & { maxFiles?: number; maxBytes?: number; maxPaths?: number },
) {
  const files = new Map<string, Uint8Array>();
  const paths = new Set<string>();
  const roots = new Map<string, string>();
  const access = { ...options, retainedBlocks: options.retainedBlocks ?? new Map() };
  const requested = new Set<string>();
  const bounded: IpfsClient = {
    block: {
      async get(cid, request) {
        requested.add(cid);
        if (requested.size > (options.maxDagBlocks ?? 16_384))
          throw new Error("Content block budget exceeded.");
        return client.block.get(cid, request);
      },
    },
  };
  let total = 0;
  async function walk(address: string, path: string, depth: number): Promise<void> {
    options.signal.throwIfAborted();
    if (depth > 64) throw new Error("Content tree depth exceeded.");
    if (path) {
      if (
        path
          .split("/")
          .some((part) => !part || part === "." || part === ".." || /[\\:\0]/.test(part)) ||
        paths.has(path.toLowerCase())
      )
        throw new Error("Unsafe or ambiguous content path.");
      paths.add(path.toLowerCase());
      if (paths.size > (options.maxPaths ?? 8192)) throw new Error("Content path budget exceeded.");
    }
    const entry = await openContent(bounded, address, access);
    if (entry.type === "directory") {
      roots.set(path, entry.cid.toString());
      let count = 0;
      for await (const child of entry.entries({ signal: options.signal })) {
        if (!child.name || child.name.includes("/") || child.name.includes("\\"))
          throw new Error("Unsafe content directory entry.");
        await walk(child.cid.toString(), path ? `${path}/${child.name}` : child.name, depth + 1);
        count++;
      }
      if (!count) throw new Error("Empty content directory.");
    } else if (
      path &&
      (entry.type === "raw" ||
        (entry.type === "file" && ["file", "raw"].includes(entry.unixfs.type)))
    ) {
      if (files.size >= (options.maxFiles ?? 4096))
        throw new Error("Content file budget exceeded.");
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of entry.content({ signal: options.signal })) {
        total += chunk.byteLength;
        length += chunk.byteLength;
        if (total > (options.maxBytes ?? 64 * 1024 * 1024))
          throw new Error("Content byte budget exceeded.");
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      files.set(path, bytes);
    } else throw new Error("Content requires a directory of regular files.");
  }
  await walk(cid, "", 0);
  const encoded = await encodeContentCar(files, { signal: options.signal });
  if (encoded.cid !== cid) throw new Error("Content root differs from its canonical file tree.");
  return { cid, files, roots, archive: encoded.bytes };
}
