import { createHash } from "node:crypto";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import * as tar from "tar";
import { artifactLimits, inspectFiles, safePath } from "./manifest.js";

export function transportDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export async function unpackArtifactFiles(bytes: Buffer, signal?: AbortSignal) {
  if (bytes.length > artifactLimits.archiveBytes) throw new Error("Check archive exceeds bounds.");
  const files = new Map<string, Buffer>();
  const seen = new Set<string>();
  const spellings = new Map<string, string>();
  const directories: string[] = [];
  let total = 0;
  let expanded = 0;
  let first = Buffer.alloc(0);
  let headerVerified = false;
  let eof = false;
  const parser = tar.t({
    strict: true,
    maxMetaEntrySize: 16 * 1024,
    brotli: false,
    zstd: false,
    onReadEntry(entry) {
      try {
        const name = entry.type === "Directory" ? entry.path.replace(/\/$/, "") : entry.path;
        const raw =
          entry.type === "Directory" ? entry.header.path?.replace(/\/$/, "") : entry.header.path;
        if (
          !raw ||
          !safePath(raw) ||
          !safePath(name) ||
          seen.has(name.toLowerCase()) ||
          !["File", "Directory"].includes(entry.type) ||
          entry.linkpath
        )
          throw new Error("Check archive contains an unsafe, duplicate, link or special entry.");
        seen.add(name.toLowerCase());
        let prefix = "";
        for (const part of name.split("/")) {
          prefix += `${part}/`;
          const folded = prefix.toLowerCase();
          if (spellings.has(folded) && spellings.get(folded) !== prefix)
            throw new Error("Check archive contains ambiguous path casing.");
          spellings.set(folded, prefix);
        }
        if (seen.size > artifactLimits.paths) throw new Error("Check archive exceeds path bounds.");
        if (entry.type === "Directory") {
          if (entry.size) throw new Error("Check archive directory has content.");
          directories.push(name);
          entry.resume();
          return;
        }
        if (!Number.isSafeInteger(entry.size) || entry.size < 0)
          throw new Error("Check archive has an invalid entry size.");
        total += entry.size;
        if (total > artifactLimits.bytes || files.size >= artifactLimits.files)
          throw new Error("Check archive exceeds delivered-tree bounds.");
        const chunks: Buffer[] = [];
        let length = 0;
        // Reserve now so an empty/unfinished entry still counts against file limits.
        files.set(name, Buffer.alloc(0));
        entry.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > entry.size) parser.abort(new Error("Check archive entry exceeds its size."));
          else chunks.push(chunk);
        });
        entry.on("end", () => {
          if (length !== entry.size) parser.abort(new Error("Truncated Check archive entry."));
          else files.set(name, Buffer.concat(chunks));
        });
      } catch (error) {
        parser.abort(error instanceof Error ? error : new Error("Invalid Check archive."));
      }
    },
  });
  parser.on("ignoredEntry", () =>
    parser.abort(new Error("Check archive contains an unsupported entry.")),
  );
  let metadataEntries = 0;
  parser.once("eof", () => {
    eof = true;
  });
  parser.on("meta", () => {
    if (++metadataEntries > artifactLimits.paths)
      parser.abort(new Error("Check archive exceeds metadata bounds."));
  });
  await pipeline(
    Readable.from([bytes]),
    createGunzip(),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        expanded += chunk.length;
        if (expanded > artifactLimits.expandedTarBytes)
          return callback(new Error("Expanded Check archive exceeds bounds."));
        // node-tar otherwise retains unused padding after its EOF, growing its internal buffer.
        if (eof) return callback();
        if (!headerVerified) {
          first = Buffer.concat([first, chunk]);
          if (first.length < 512) return callback();
          // Reject nested compression before node-tar can auto-detect it.
          try {
            if (!new tar.Header(first).cksumValid) throw new Error("Invalid header.");
          } catch {
            return callback(new Error("Check archive must contain a gzip-compressed tar."));
          }
          headerVerified = true;
          callback(null, first);
          first = Buffer.alloc(0);
        } else callback(null, chunk);
      },
    }),
    parser,
    { ...(signal ? { signal } : {}) },
  );
  if (!eof) throw new Error("Check archive is missing its tar end marker.");
  for (const name of files.keys()) {
    const parts = name.split("/");
    parts.pop();
    while (parts.length) {
      if (files.has(parts.join("/"))) throw new Error("Check archive file is also a parent.");
      parts.pop();
    }
  }
  if (
    directories.some(
      (name) => files.has(name) || ![...files.keys()].some((file) => file.startsWith(`${name}/`)),
    )
  )
    throw new Error("Check archive contains an undeclared directory.");
  return files;
}
export async function unpackCheckArchive(bytes: Buffer, signal?: AbortSignal) {
  return inspectFiles(await unpackArtifactFiles(bytes, signal));
}
