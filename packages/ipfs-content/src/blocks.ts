import * as dagPb from "@ipld/dag-pb";
import type { MemoryBlockstore } from "blockstore-core";
import type { BlockCodec, BlockView } from "multiformats";
import { create } from "multiformats/block";
import type { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { walk } from "multiformats/traversal";

export const defaultCarBytes = 256 * 1024 * 1024;

export function snapshotCar(
  bytes: Uint8Array,
  limit = defaultCarBytes,
  signal?: AbortSignal,
): Uint8Array {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new Error("Invalid IPFS CAR resource limit.");
  if (bytes.byteLength > limit) throw new Error("IPFS CAR capacity exceeded.");
  return Uint8Array.from(bytes);
}

export async function getCodec<Code extends number, T>(code: Code): Promise<BlockCodec<Code, T>> {
  const codec = code === raw.code ? raw : code === dagPb.code ? dagPb : undefined;
  if (!codec) throw new Error("Unsupported UnixFS block codec.");
  return codec as unknown as BlockCodec<Code, T>;
}

export async function verifyBlock(cid: CID, bytes: Uint8Array): Promise<void> {
  if (cid.multihash.code !== sha256.code) throw new Error("Unsupported IPFS block hash.");
  try {
    await create({ bytes, cid, codec: await getCodec(cid.code), hasher: sha256 });
  } catch (cause) {
    throw new Error("IPFS block CID verification failed.", { cause });
  }
}

/** IPLD owns link decoding, traversal and deduplication; the loader only enforces local policy. */
export async function visitBlocks(
  root: CID,
  blockstore: Pick<MemoryBlockstore, "get">,
  options: { signal: AbortSignal; maxDagBlocks?: number; maxBlockBytes?: number },
  visit: (block: BlockView<unknown, number, number, 0 | 1>) => Promise<void>,
): Promise<void> {
  const limit = options.maxDagBlocks ?? 16_384;
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new Error("Invalid IPFS DAG resource limit.");
  let count = 0;
  await walk({
    cid: root,
    load: async (cid) => {
      options.signal.throwIfAborted();
      if (++count > limit) throw new Error("IPFS DAG block capacity exceeded.");
      const bytes = await collectBytes(
        blockstore.get(cid, { signal: options.signal }),
        options.maxBlockBytes ?? 2 * 1024 * 1024,
        options.signal,
      );
      if (cid.multihash.code !== sha256.code) throw new Error("Unsupported IPFS block hash.");
      const block = await create({ bytes, cid, codec: await getCodec(cid.code), hasher: sha256 });
      options.signal.throwIfAborted();
      await visit(block);
      return block;
    },
  });
  options.signal.throwIfAborted();
}

export async function collectBytes(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of source) {
    signal?.throwIfAborted();
    length += chunk.byteLength;
    if (length > limit) throw new Error("IPFS CAR capacity exceeded.");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
