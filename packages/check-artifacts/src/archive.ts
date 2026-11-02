import { createHash } from "node:crypto";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import * as tar from "tar";
import { artifactLimits, inspectFiles, safePath } from "./manifest.js";
export class ArchiveCapacityError extends Error {}

export function transportDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export interface ArchiveLimits {
  bytes: number;
  files: number;
  paths: number;
  archiveBytes: number;
  expandedTarBytes: number;
  fileBytes: number;
}
export async function unpackArtifactFiles(
  bytes: Buffer | AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
  configuration: Partial<ArchiveLimits> = {},
) {
  const limits: ArchiveLimits = {
    ...artifactLimits,
    fileBytes: artifactLimits.bytes,
    ...configuration,
  };
  for (const limit of Object.values(limits))
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Invalid archive capacity.");
  if (Buffer.isBuffer(bytes) && bytes.length > limits.archiveBytes)
    throw new ArchiveCapacityError("Check archive exceeds bounds.");
  const files = new Map<string, Buffer>();
  const seen = new Set<string>();
  const spellings = new Map<string, string>();
  const directories: string[] = [];
  let total = 0;
  let expanded = 0;
  let downloaded = 0;
  let framing = Buffer.alloc(0);
  let payloadRemaining = 0;
  let zeroBlocks = 0;
  let archiveEnded = false;
  let metadata: { remaining: number; chunks: Buffer[] } | undefined;
  function inspectFraming(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (archiveEnded) {
        if (chunk.subarray(offset).some((byte) => byte !== 0))
          throw new Error("Archive contains content after its tar end marker.");
        return;
      }
      if (payloadRemaining) {
        const size = Math.min(payloadRemaining, chunk.length - offset);
        if (metadata) {
          const length = Math.min(size, metadata.remaining);
          metadata.chunks.push(chunk.subarray(offset, offset + length));
          metadata.remaining -= length;
          if (!metadata.remaining) {
            new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(metadata.chunks));
            metadata = undefined;
          }
        }
        payloadRemaining -= size;
        offset += size;
        continue;
      }
      const size = Math.min(512 - framing.length, chunk.length - offset);
      framing = Buffer.concat([framing, chunk.subarray(offset, offset + size)]);
      offset += size;
      if (framing.length !== 512) continue;
      if (framing.every((byte) => byte === 0)) {
        if (++zeroBlocks === 2) archiveEnded = true;
      } else {
        if (zeroBlocks) throw new Error("Archive contains an incomplete tar end marker.");
        let header: tar.Header;
        try {
          const decoder = new TextDecoder("utf-8", { fatal: true });
          decoder.decode(framing.subarray(0, 100));
          decoder.decode(framing.subarray(345, 500));
          header = new tar.Header(framing);
          if (!header.cksumValid || !Number.isSafeInteger(header.size) || header.size! < 0)
            throw new Error("Invalid tar framing.");
        } catch {
          throw new Error("Archive must contain a gzip-compressed tar.");
        }
        payloadRemaining = Math.ceil(header.size! / 512) * 512;
        if (["x", "g", "L", "K"].includes(String.fromCharCode(framing[156]!)) && header.size) {
          if (header.size > 16 * 1024)
            throw new ArchiveCapacityError("Archive metadata exceeds bounds.");
          metadata = { remaining: header.size, chunks: [] };
        }
      }
      framing = Buffer.alloc(0);
    }
  }
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
        if (spellings.size > limits.paths)
          throw new ArchiveCapacityError("Check archive exceeds logical path bounds.");
        if (seen.size > limits.paths)
          throw new ArchiveCapacityError("Check archive exceeds path bounds.");
        if (entry.type === "Directory") {
          if (entry.size) throw new Error("Check archive directory has content.");
          directories.push(name);
          entry.resume();
          return;
        }
        if (!Number.isSafeInteger(entry.size) || entry.size < 0)
          throw new Error("Check archive has an invalid entry size.");
        if (entry.size > limits.fileBytes)
          throw new ArchiveCapacityError("Archive file exceeds bounds.");
        total += entry.size;
        if (total > limits.bytes || files.size >= limits.files)
          throw new ArchiveCapacityError("Check archive exceeds delivered-tree bounds.");
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
    if (++metadataEntries > limits.paths)
      parser.abort(new ArchiveCapacityError("Check archive exceeds metadata bounds."));
  });
  await pipeline(
    Readable.from(Buffer.isBuffer(bytes) ? [bytes] : bytes),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        downloaded += chunk.length;
        callback(
          downloaded > limits.archiveBytes
            ? new ArchiveCapacityError("Archive download exceeds bounds.")
            : null,
          chunk,
        );
      },
    }),
    createGunzip(),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        expanded += chunk.length;
        if (expanded > limits.expandedTarBytes)
          return callback(new ArchiveCapacityError("Expanded Check archive exceeds bounds."));
        try {
          inspectFraming(chunk);
        } catch (error) {
          return callback(error instanceof Error ? error : new Error("Invalid tar framing."));
        }
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
  if (!eof || !archiveEnded || payloadRemaining || framing.length)
    throw new Error("Check archive is missing its tar end marker.");
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
