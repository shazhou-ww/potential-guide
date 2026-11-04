import { MemoryBlockstore } from "blockstore-core";
import type { ExportContentOptions, UnixFSEntry } from "ipfs-unixfs-exporter";
import { CID } from "multiformats/cid";
import { verifyBlock, visitBlocks } from "./blocks.js";

export interface IpfsClient {
  block: { get(cid: string, options?: { signal?: AbortSignal }): Promise<Uint8Array> };
}

export interface GatewayClientOptions {
  fetch?: typeof globalThis.fetch;
  maxBlockBytes?: number;
  timeoutMs?: number;
}

/** A read-only Trustless Gateway transport; base paths are appended, not replaced. */
export function createIpfsGatewayClient(
  url: string,
  options: GatewayClientOptions = {},
): IpfsClient {
  const endpoint = new URL(url);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.href.includes("?") ||
    endpoint.href.includes("#")
  )
    throw new Error("IPFS endpoint must be an HTTP(S) Gateway base URL.");
  const limit = options.maxBlockBytes ?? 2 * 1024 * 1024;
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(timeout) || timeout <= 0)
    throw new Error("Invalid IPFS Gateway resource limits.");
  return {
    block: {
      async get(cid, request = {}) {
        const target = new URL(
          `${endpoint.href.replace(/\/+$/, "")}/ipfs/${CID.parse(cid)}?format=raw`,
        );
        const signal = AbortSignal.any([
          AbortSignal.timeout(timeout),
          ...(request.signal ? [request.signal] : []),
        ]);
        signal.throwIfAborted();
        const response = await (options.fetch ?? globalThis.fetch)(target, {
          signal,
          redirect: "error",
          credentials: "omit",
          headers: { Accept: "application/vnd.ipld.raw", "Accept-Encoding": "identity" },
        });
        const reader = response.body?.getReader();
        try {
          if (response.status !== 200 || !reader) throw new Error("IPFS gateway read failed.");
          if (
            response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
            "application/vnd.ipld.raw"
          )
            throw new Error("Unsupported gateway content type.");
          const encoding = response.headers.get("content-encoding");
          if (encoding && encoding !== "identity") throw new Error("Unsupported gateway encoding.");
          const declared = response.headers.get("content-length");
          if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
            throw new Error("IPFS block capacity exceeded.");
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (true) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            signal.throwIfAborted();
            if (done) break;
            size += value.byteLength;
            if (size > limit) throw new Error("IPFS block capacity exceeded.");
            chunks.push(value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return bytes;
        } finally {
          await reader?.cancel().catch(() => {});
          reader?.releaseLock();
        }
      },
    },
  };
}

export interface ContentAccessOptions {
  signal: AbortSignal;
  gateways?: readonly string[];
  allowGateway?: (url: URL) => boolean;
  fetch?: typeof globalThis.fetch;
  maxBlockBytes?: number;
  retainedBlocks?: Map<string, Uint8Array>;
  maxRetainedBytes?: number;
  retentionBudget?: { bytes: number; limit: number };
  maxDagBlocks?: number;
  maxFileBytes?: number;
  inspectNode?: (entry: UnixFSEntry) => void;
}

/** Every block is hash-checked before the standard UnixFS exporter interprets it. */
function readStore(client: IpfsClient, options: ContentAccessOptions) {
  const get = async function* (cid: CID): AsyncGenerator<Uint8Array> {
    options.signal.throwIfAborted();
    const limit = options.maxBlockBytes ?? 2 * 1024 * 1024;
    const verify = async (bytes: Uint8Array) => {
      options.signal.throwIfAborted();
      if (bytes.byteLength > limit) throw new Error("IPFS block capacity exceeded.");
      await verifyBlock(cid, bytes);
      options.signal.throwIfAborted();
      if (options.retainedBlocks && !options.retainedBlocks.has(cid.toString())) {
        const size = [...options.retainedBlocks.values()].reduce(
          (sum, block) => sum + block.length,
          bytes.length,
        );
        if (size > (options.maxRetainedBytes ?? 128 * 1024 * 1024))
          throw new Error("IPFS retention capacity exceeded.");
        if (options.retentionBudget) {
          if (options.retentionBudget.bytes + bytes.length > options.retentionBudget.limit)
            throw new Error("IPFS retention capacity exceeded.");
          options.retentionBudget.bytes += bytes.length;
        }
        options.retainedBlocks.set(cid.toString(), Uint8Array.from(bytes));
      }
      return bytes;
    };
    let failure: unknown;
    const retainedBlock = options.retainedBlocks?.get(cid.toString());
    if (retainedBlock) {
      yield await verify(retainedBlock);
      return;
    }
    try {
      yield await verify(await client.block.get(cid.toString(), { signal: options.signal }));
      return;
    } catch (error) {
      failure = error;
      options.signal.throwIfAborted();
    }
    for (const base of options.gateways ?? []) {
      const url = new URL(`${base.replace(/\/+$/, "")}/ipfs/${cid}?format=raw`);
      if (!options.allowGateway?.(url)) continue;
      try {
        const gateway = createIpfsGatewayClient(base, {
          ...(options.fetch ? { fetch: options.fetch } : {}),
          maxBlockBytes: limit,
        });
        yield await verify(await gateway.block.get(cid.toString(), { signal: options.signal }));
        return;
      } catch (error) {
        failure = error;
        options.signal.throwIfAborted();
      }
    }
    throw failure;
  };
  return Object.assign(new MemoryBlockstore(), { get });
}

/** Every block is verified by multiformats before the official UnixFS exporter interprets it. */
export async function openContent(
  client: IpfsClient,
  path: string,
  options: ContentAccessOptions,
): Promise<UnixFSEntry> {
  const { exporter } = await import("ipfs-unixfs-exporter");
  const entry = await exporter(path, readStore(client, options), { signal: options.signal });
  if (entry.type === "file" || entry.type === "raw") {
    const content = entry.content.bind(entry);
    return {
      ...entry,
      content: async function* (contentOptions: ExportContentOptions = {}) {
        const signal = contentOptions.signal
          ? AbortSignal.any([options.signal, contentOptions.signal])
          : options.signal;
        signal.throwIfAborted();
        if (entry.size > BigInt(Number.MAX_SAFE_INTEGER))
          throw new Error("IPFS file capacity exceeded.");
        const start = contentOptions.offset ?? 0;
        const length = contentOptions.length ?? Number(entry.size) - start;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(length) ||
          start < 0 ||
          length < 0 ||
          start + length > Number(entry.size)
        )
          throw new Error("Invalid UnixFS content range.");
        // The exporter has an eager internal queue. Range windows bound that queue;
        // addressing, DAG interpretation and range validation remain standard.
        for (let offset = start; offset < start + length; offset += 262_144) {
          for await (const chunk of content({
            ...contentOptions,
            signal,
            blockReadConcurrency: 1,
            offset,
            length: Math.min(262_144, start + length - offset),
          })) {
            signal.throwIfAborted();
            if (!chunk.byteLength) continue;
            yield chunk;
          }
        }
        signal.throwIfAborted();
      },
    };
  }
  return entry;
}

/** Retain a verified complete DAG in a bounded caller-owned cache, never an IPFS pin. */
export async function retainContent(
  client: IpfsClient,
  root: string,
  options: ContentAccessOptions,
): Promise<void> {
  const { exporter } = await import("ipfs-unixfs-exporter");
  const store = readStore(client, options);
  await visitBlocks(CID.parse(root), store, options, async (block) => {
    options.signal.throwIfAborted();
    const entry = await exporter(
      block.cid,
      {
        async *get() {
          yield block.bytes;
        },
      },
      { signal: options.signal },
    );
    options.inspectNode?.(entry);
    if (
      (entry.type === "file" || entry.type === "raw") &&
      entry.size > BigInt(options.maxFileBytes ?? Number.MAX_SAFE_INTEGER)
    )
      throw new Error("IPFS file capacity exceeded.");
    if (!["file", "directory", "raw"].includes(entry.type))
      throw new Error("Unsupported UnixFS DAG node.");
  });
}
