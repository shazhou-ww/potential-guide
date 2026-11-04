import type { ExportContentOptions, UnixFSEntry } from "ipfs-unixfs-exporter";
import type { KuboRPCClient } from "kubo-rpc-client";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";

export interface IpfsClient {
  block: { get(cid: string, options?: { signal?: AbortSignal }): Promise<Uint8Array> };
}
export interface IpfsImportClient {
  block: {
    put(
      bytes: Uint8Array,
      options: { format: string; mhtype: string; version: 1; pin: false },
    ): Promise<{ toString(): string }>;
  };
  pin: { add(cid: string, options: { recursive: true }): Promise<{ toString(): string }> };
}
export const unixfsImportOptions = Object.freeze({
  cidVersion: 1 as const,
  rawLeaves: true,
  wrapWithDirectory: true,
  reduceSingleLeafToSelf: true,
  shardSplitThresholdBytes: Number.MAX_SAFE_INTEGER,
  fileImportConcurrency: 1,
  blockWriteConcurrency: 4,
});

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

/** RPC transport only; the independently managed node and client belong to the caller. */
export async function createIpfsClient(url: string): Promise<
  Omit<KuboRPCClient, "block"> & {
    block: Omit<KuboRPCClient["block"], "get"> & {
      get(
        cid: string | CID,
        options?: Parameters<KuboRPCClient["block"]["get"]>[1],
      ): Promise<Uint8Array>;
    };
  }
> {
  const endpoint = new URL(url);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.href.includes("?") ||
    endpoint.href.includes("#")
  )
    throw new Error("IPFS endpoint must be an HTTP(S) RPC base URL.");
  const { create } = await import("kubo-rpc-client");
  const client = create({ url: endpoint, timeout: 30_000 });
  return {
    ...client,
    block: {
      ...client.block,
      get: (cid, options) =>
        client.block.get(typeof cid === "string" ? CID.parse(cid) : cid, options),
    },
  };
}

export interface ContentAccessOptions {
  signal: AbortSignal;
  gateways?: readonly string[];
  allowGateway?: (url: URL) => boolean;
  fetch?: typeof globalThis.fetch;
  maxBlockBytes?: number;
  protectedBlocks?: Map<string, Uint8Array>;
  maxProtectedBytes?: number;
  protectionBudget?: { bytes: number; limit: number };
  maxDagBlocks?: number;
  maxFileBytes?: number;
  inspectNode?: (entry: UnixFSEntry) => void;
}

/** Every block is hash-checked before the standard UnixFS exporter interprets it. */
export async function openContent(
  client: IpfsClient,
  path: string,
  options: ContentAccessOptions,
): Promise<UnixFSEntry> {
  const { exporter } = await import("ipfs-unixfs-exporter");
  const get = async function* (cid: CID): AsyncGenerator<Uint8Array> {
    options.signal.throwIfAborted();
    const limit = options.maxBlockBytes ?? 2 * 1024 * 1024;
    const verify = async (bytes: Uint8Array) => {
      options.signal.throwIfAborted();
      if (bytes.byteLength > limit) throw new Error("IPFS block capacity exceeded.");
      if (cid.multihash.code !== sha256.code) throw new Error("Unsupported IPFS block hash.");
      const hash = await sha256.digest(bytes);
      options.signal.throwIfAborted();
      if (!hash.bytes.every((byte, index) => byte === cid.multihash.bytes[index]))
        throw new Error("IPFS block CID verification failed.");
      if (options.protectedBlocks && !options.protectedBlocks.has(cid.toString())) {
        const size = [...options.protectedBlocks.values()].reduce(
          (sum, block) => sum + block.length,
          bytes.length,
        );
        if (size > (options.maxProtectedBytes ?? 128 * 1024 * 1024))
          throw new Error("IPFS protection capacity exceeded.");
        if (options.protectionBudget) {
          if (options.protectionBudget.bytes + bytes.length > options.protectionBudget.limit)
            throw new Error("IPFS protection capacity exceeded.");
          options.protectionBudget.bytes += bytes.length;
        }
        options.protectedBlocks.set(cid.toString(), Uint8Array.from(bytes));
      }
      return bytes;
    };
    let failure: unknown;
    const protectedBlock = options.protectedBlocks?.get(cid.toString());
    if (protectedBlock) {
      yield await verify(protectedBlock);
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
  const entry = await exporter(path, { get }, { signal: options.signal });
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

/** Traverse every standard decoded DAG link, including blocks outside file ranges. */
export async function protectContent(
  client: IpfsClient,
  root: string,
  options: ContentAccessOptions,
): Promise<void> {
  const pending = [root];
  const seen = new Set<string>(pending);
  while (pending.length) {
    options.signal.throwIfAborted();
    const cid = pending.pop()!;
    if (seen.size > (options.maxDagBlocks ?? 16_384))
      throw new Error("IPFS DAG block capacity exceeded.");
    const entry = await openContent(client, cid, options);
    options.inspectNode?.(entry);
    if (
      (entry.type === "file" || entry.type === "raw") &&
      entry.size > BigInt(options.maxFileBytes ?? Number.MAX_SAFE_INTEGER)
    )
      throw new Error("IPFS file capacity exceeded.");
    if (entry.type === "file" || entry.type === "directory")
      for (const link of entry.node.Links) {
        const child = link.Hash.toString();
        if (seen.has(child)) continue;
        seen.add(child);
        if (seen.size > (options.maxDagBlocks ?? 16_384))
          throw new Error("IPFS DAG block capacity exceeded.");
        pending.push(child);
      }
    else if (entry.type !== "raw") throw new Error("Unsupported UnixFS DAG node.");
  }
}

/** Standard deterministic UnixFS import; useful for offline builds and private fixtures. */
export async function importContent(
  files: ReadonlyMap<string, Uint8Array>,
  put: (cid: string, bytes: Uint8Array) => Promise<void>,
): Promise<string> {
  const [{ importer }, { fixedSize }, { balanced }] = await Promise.all([
    import("ipfs-unixfs-importer"),
    import("ipfs-unixfs-importer/chunker"),
    import("ipfs-unixfs-importer/layout"),
  ]);
  let root: string | undefined;
  for await (const entry of importer(
    [...files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, content]) => ({ path, content })),
    {
      put: async (cid, bytes) => {
        const chunks: Uint8Array[] = [];
        if (bytes instanceof Uint8Array) chunks.push(bytes);
        else for await (const chunk of bytes) chunks.push(chunk);
        const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const block = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          block.set(chunk, offset);
          offset += chunk.length;
        }
        await put(cid.toString(), block);
        return cid;
      },
    },
    {
      ...unixfsImportOptions,
      chunker: fixedSize({ chunkSize: 262_144 }),
      layout: balanced({ maxChildrenPerNode: 174 }),
    },
  ))
    root = entry.cid.toString();
  if (!root) throw new Error("Cannot import an empty content tree.");
  return root;
}

/** Upload the standard import's exact blocks, independent of daemon import defaults. */
export async function publishContent(
  files: ReadonlyMap<string, Uint8Array>,
  client: IpfsImportClient,
): Promise<string> {
  const root = await importContent(files, async (cid, bytes) => {
    const expected = CID.parse(cid);
    const stored = await client.block.put(bytes, {
      format: expected.code === 0x55 ? "raw" : "dag-pb",
      mhtype: "sha2-256",
      version: 1,
      pin: false,
    });
    if (!expected.equals(CID.parse(stored.toString())))
      throw new Error("IPFS block publication returned a different CID.");
  });
  const pinned = await client.pin.add(root, { recursive: true });
  if (!CID.parse(root).equals(CID.parse(pinned.toString())))
    throw new Error("IPFS publication did not confirm the requested root pin.");
  return root;
}
