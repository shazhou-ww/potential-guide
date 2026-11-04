import { car, type ExportStrategy } from "@helia/car";
import { unixfs } from "@helia/unixfs";
import { CarBlockIterator } from "@ipld/car";
import { defaultLogger } from "@libp2p/logger";
import { MemoryBlockstore } from "blockstore-core";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { balanced } from "ipfs-unixfs-importer/layout";
import { CID } from "multiformats/cid";
import type { BlockView } from "multiformats";
import {
  collectBytes,
  defaultCarBytes,
  getCodec,
  snapshotCar,
  verifyBlock,
  visitBlocks,
} from "./blocks.js";

export const unixfsImportOptions = Object.freeze({
  cidVersion: 1 as const,
  rawLeaves: true,
  wrapWithDirectory: true,
  reduceSingleLeafToSelf: true,
  shardSplitThresholdBytes: Number.MAX_SAFE_INTEGER,
  fileImportConcurrency: 1,
  blockWriteConcurrency: 4,
});

export interface ContentCarOptions {
  signal?: AbortSignal;
  maxCarBytes?: number;
  maxDagBlocks?: number;
  maxBlockBytes?: number;
}
const logger = defaultLogger();

function validateOptions(options: ContentCarOptions) {
  options.signal?.throwIfAborted();
  for (const value of [options.maxCarBytes, options.maxDagBlocks, options.maxBlockBytes])
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
      throw new Error("Invalid IPFS CAR resource limit.");
}

async function importTree(
  files: ReadonlyMap<string, Uint8Array>,
  blockstore: MemoryBlockstore,
  options: ContentCarOptions,
): Promise<string> {
  validateOptions(options);
  let total = 0;
  for (const bytes of files.values()) {
    total += bytes.byteLength;
    if (total > (options.maxCarBytes ?? defaultCarBytes))
      throw new Error("IPFS CAR capacity exceeded.");
  }
  let root: string | undefined;
  for await (const entry of unixfs({ blockstore }).addAll(
    [...files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, content]) => ({ path, content })),
    {
      ...unixfsImportOptions,
      chunker: fixedSize({ chunkSize: 262_144 }),
      layout: balanced({ maxChildrenPerNode: 174 }),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  ))
    root = entry.cid.toString();
  if (!root) throw new Error("Cannot import an empty content tree.");
  return root;
}

/** Compatibility entry point; all UnixFS construction is performed by Helia. */
export async function importContent(
  files: ReadonlyMap<string, Uint8Array>,
  put: (cid: string, bytes: Uint8Array) => Promise<void>,
): Promise<string> {
  const blockstore = new MemoryBlockstore();
  const store = Object.assign(blockstore, {
    put: async (cid: CID, bytes: Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>) => {
      const value =
        bytes instanceof Uint8Array ? bytes : await collectBytes(bytes, defaultCarBytes);
      await put(cid.toString(), value);
      return cid;
    },
  });
  return importTree(files, store, {});
}

/** Offline codec: no Helia node, routing, discovery, network, or pin service is constructed. */
export async function encodeContentCar(
  files: ReadonlyMap<string, Uint8Array>,
  options: ContentCarOptions = {},
): Promise<{ cid: string; bytes: Uint8Array }> {
  const blockstore = new MemoryBlockstore();
  const cid = await importTree(files, blockstore, options);
  const signal = options.signal ?? new AbortController().signal;
  const blocks: BlockView<unknown, number, number, 0 | 1>[] = [];
  await visitBlocks(CID.parse(cid), blockstore, { ...options, signal }, async (block) => {
    blocks.push(block);
  });
  const exporter: ExportStrategy = {
    async *export() {
      for (const block of blocks) {
        signal.throwIfAborted();
        yield block;
      }
    },
  };
  const archive = car({ blockstore, getCodec, logger }).export(CID.parse(cid), {
    signal,
    exporter,
  });
  return {
    cid,
    bytes: await collectBytes(archive, options.maxCarBytes ?? defaultCarBytes, signal),
  };
}

/** CAR parsing alone does not verify hashes. Admission verifies every block before Helia import. */
export async function validateContentCar(
  bytes: Uint8Array,
  expectedRoot?: string,
  options: ContentCarOptions = {},
): Promise<{ cid: string; blockstore: MemoryBlockstore }> {
  validateOptions(options);
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const reader = await CarBlockIterator.fromBytes(snapshotCar(bytes, options.maxCarBytes, signal));
  const roots = await reader.getRoots();
  if (
    roots.length !== 1 ||
    (expectedRoot !== undefined && !roots[0]!.equals(CID.parse(expectedRoot)))
  )
    throw new Error("CAR must contain exactly the expected root.");
  const root = roots[0]!;
  const blockstore = new MemoryBlockstore();
  const supplied = new Set<string>();
  let blockCount = 0;
  await car({ blockstore, getCodec, logger }).import(
    {
      async *blocks() {
        for await (const block of reader) {
          signal.throwIfAborted();
          if (++blockCount > (options.maxDagBlocks ?? 16_384))
            throw new Error("IPFS DAG block capacity exceeded.");
          if (block.bytes.byteLength > (options.maxBlockBytes ?? 2 * 1024 * 1024))
            throw new Error("IPFS block capacity exceeded.");
          await verifyBlock(block.cid, block.bytes);
          signal.throwIfAborted();
          supplied.add(block.cid.toString());
          yield block;
        }
      },
    },
    { signal },
  );
  const reached = new Set<string>();
  await visitBlocks(root, blockstore, { ...options, signal }, async (block) => {
    reached.add(block.cid.toString());
  });
  if (supplied.size !== reached.size || [...supplied].some((cid) => !reached.has(cid)))
    throw new Error("CAR contains blocks outside its root DAG.");
  return { cid: root.toString(), blockstore };
}
