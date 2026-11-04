import { car } from "@helia/car";
import { unixfs } from "@helia/unixfs";
import { CarBlockIterator } from "@ipld/car";
import * as dagPb from "@ipld/dag-pb";
import { defaultLogger } from "@libp2p/logger";
import { MemoryBlockstore } from "blockstore-core";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { balanced } from "ipfs-unixfs-importer/layout";
import { type BlockCodec, type BlockView } from "multiformats";
import { create } from "multiformats/block";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { walk } from "multiformats/traversal";

export interface ContentCarOptions {
  signal?: AbortSignal;
  maxCarBytes?: number;
  maxDagBlocks?: number;
  maxBlockBytes?: number;
}
const defaultCarBytes = 256 * 1024 * 1024;
const logger = defaultLogger();
const getCodec = async <Code extends number, T>(code: Code): Promise<BlockCodec<Code, T>> => {
  const codec = code === raw.code ? raw : code === dagPb.code ? dagPb : undefined;
  if (!codec) throw new Error("Unsupported UnixFS block codec.");
  return codec as unknown as BlockCodec<Code, T>;
};
async function collect(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  limit: number,
  signal?: AbortSignal,
) {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of source) {
    signal?.throwIfAborted();
    length += chunk.byteLength;
    if (length > limit) throw new Error("IPFS CAR capacity exceeded.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}
function validateOptions(options: ContentCarOptions) {
  options.signal?.throwIfAborted();
  for (const value of [options.maxCarBytes, options.maxDagBlocks, options.maxBlockBytes])
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
      throw new Error("Invalid IPFS CAR resource limit.");
}
async function visitBlocks(
  root: CID,
  blockstore: MemoryBlockstore,
  options: ContentCarOptions,
  visit: (block: BlockView<unknown, number, number, 0 | 1>) => Promise<void>,
) {
  let count = 0;
  await walk({
    cid: root,
    load: async (cid) => {
      options.signal?.throwIfAborted();
      if (++count > (options.maxDagBlocks ?? 16_384))
        throw new Error("IPFS DAG block capacity exceeded.");
      const bytes = await collect(
        blockstore.get(cid),
        options.maxBlockBytes ?? 2 * 1024 * 1024,
        options.signal,
      );
      if (cid.multihash.code !== sha256.code) throw new Error("Unsupported IPFS block hash.");
      const block = await create({ bytes, cid, codec: await getCodec(cid.code), hasher: sha256 });
      await visit(block);
      return block;
    },
  });
  options.signal?.throwIfAborted();
}
async function importTree(
  files: ReadonlyMap<string, Uint8Array>,
  blockstore: MemoryBlockstore,
  options: ContentCarOptions,
) {
  validateOptions(options);
  if (
    [...files.values()].reduce((sum, value) => sum + value.byteLength, 0) >
    (options.maxCarBytes ?? defaultCarBytes)
  )
    throw new Error("IPFS CAR capacity exceeded.");
  let root: CID | undefined;
  for await (const entry of unixfs({ blockstore }).addAll(
    [...files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, content]) => ({ path, content })),
    {
      cidVersion: 1,
      rawLeaves: true,
      wrapWithDirectory: true,
      reduceSingleLeafToSelf: true,
      shardSplitThresholdBytes: Number.MAX_SAFE_INTEGER,
      fileImportConcurrency: 1,
      blockWriteConcurrency: 4,
      chunker: fixedSize({ chunkSize: 262_144 }),
      layout: balanced({ maxChildrenPerNode: 174 }),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  ))
    root = entry.cid;
  if (!root) throw new Error("Cannot import an empty content tree.");
  return root;
}

/** Offline, deterministic UnixFS import; no node, network or pin service. */
export async function computeContentCid(files: ReadonlyMap<string, Uint8Array>) {
  return (await importTree(files, new MemoryBlockstore(), {})).toString();
}
export async function encodeContentCar(
  files: ReadonlyMap<string, Uint8Array>,
  options: ContentCarOptions = {},
) {
  const blockstore = new MemoryBlockstore();
  const cid = await importTree(files, blockstore, options);
  const blocks: BlockView<unknown, number, number, 0 | 1>[] = [];
  await visitBlocks(cid, blockstore, options, async (block) => {
    blocks.push(block);
  });
  const archive = car({ blockstore, getCodec, logger }).export(cid, {
    ...(options.signal ? { signal: options.signal } : {}),
    exporter: {
      async *export() {
        for (const block of blocks) {
          options.signal?.throwIfAborted();
          yield block;
        }
      },
    },
  });
  return {
    cid: cid.toString(),
    bytes: await collect(archive, options.maxCarBytes ?? defaultCarBytes, options.signal),
  };
}
export async function validateContentCar(
  bytes: Uint8Array,
  expectedRoot?: string,
  options: ContentCarOptions = {},
) {
  validateOptions(options);
  if (bytes.byteLength > (options.maxCarBytes ?? defaultCarBytes))
    throw new Error("IPFS CAR capacity exceeded.");
  const reader = await CarBlockIterator.fromBytes(Uint8Array.from(bytes));
  const roots = await reader.getRoots();
  if (
    roots.length !== 1 ||
    (expectedRoot !== undefined && !roots[0]!.equals(CID.parse(expectedRoot)))
  )
    throw new Error("CAR must contain exactly the expected root.");
  const root = roots[0]!;
  const blockstore = new MemoryBlockstore();
  const supplied = new Set<string>();
  let count = 0;
  await car({ blockstore, getCodec, logger }).import(
    {
      async *blocks() {
        for await (const block of reader) {
          options.signal?.throwIfAborted();
          if (++count > (options.maxDagBlocks ?? 16_384))
            throw new Error("IPFS DAG block capacity exceeded.");
          if (block.bytes.byteLength > (options.maxBlockBytes ?? 2 * 1024 * 1024))
            throw new Error("IPFS block capacity exceeded.");
          if (block.cid.multihash.code !== sha256.code)
            throw new Error("Unsupported IPFS block hash.");
          await create({ ...block, codec: await getCodec(block.cid.code), hasher: sha256 });
          supplied.add(block.cid.toString());
          yield block;
        }
      },
    },
    options.signal ? { signal: options.signal } : {},
  );
  const reached = new Set<string>();
  await visitBlocks(root, blockstore, options, async (block) => {
    reached.add(block.cid.toString());
  });
  if (supplied.size !== reached.size || [...supplied].some((cid) => !reached.has(cid)))
    throw new Error("CAR contains blocks outside its root DAG.");
  return { cid: root.toString(), blockstore };
}
