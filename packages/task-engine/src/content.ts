import { withHTTP } from "@helia/http";
import { unixfs } from "@helia/unixfs";
import { MemoryBlockstore } from "blockstore-core";
import { createHeliaLight } from "helia";
import { exporter, type ExportContentOptions, type UnixFSEntry } from "ipfs-unixfs-exporter";
import { CID } from "multiformats/cid";

/** Caller-owned read port. Production hosts use createIpfsGatewayClient. */
export interface IpfsClient {
  block: { get(cid: string, options?: { signal?: AbortSignal }): Promise<Uint8Array> };
}
export interface GatewayClientOptions {
  timeoutMs?: number;
}
/** Only this configured gateway; no delegated routing, libp2p, public fallback or redirects. */
export function createIpfsGatewayClient(
  url: string,
  options: GatewayClientOptions = {},
): IpfsClient {
  const endpoint = new URL(url);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  )
    throw new Error("IPFS endpoint must be an HTTP(S) Gateway base URL.");
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0)
    throw new Error("Invalid IPFS Gateway timeout.");
  return {
    block: {
      async get(cid, request = {}) {
        const signal = AbortSignal.any([
          AbortSignal.timeout(timeout),
          ...(request.signal ? [request.signal] : []),
        ]);
        signal.throwIfAborted();
        // Helia 7.1.16's routing queue does not finish an empty primary-router list.
        // This local empty provider source disables discovery without that deadlock.
        const node = withHTTP(
          createHeliaLight({
            routers: [
              {
                name: "no-discovery",
                async *findProviders() {
                  yield* [];
                },
              },
            ],
          }),
          {
            delegatedRouters: [],
            recursiveGateways: [endpoint.href],
            allowInsecure: endpoint.protocol === "http:",
            allowLocal: true,
            transformRequestInit: (init) => ({
              ...init,
              redirect: "error",
              credentials: "omit",
              signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]),
            }),
          },
        );
        await node.start();
        try {
          const parts: Uint8Array[] = [];
          for await (const part of node.blockstore.get(CID.parse(cid), { signal }))
            parts.push(part);
          signal.throwIfAborted();
          return Buffer.concat(parts);
        } finally {
          await node.stop();
        }
      },
    },
  };
}
export interface ContentAccessOptions {
  signal: AbortSignal;
  retainedBlocks: Map<string, Uint8Array>;
  retentionBudget: { bytes: number; limit: number };
  maxBlockBytes: number;
  maxDagBlocks: number;
}

/** Bundle-owned accounting only. Helia verifies blocks; UnixFS resolves paths and content. */
export function contentStore(client: IpfsClient, options: ContentAccessOptions) {
  return Object.assign(new MemoryBlockstore(), {
    get: async function* (cid: CID) {
      options.signal.throwIfAborted();
      const key = cid.toString();
      const retained = options.retainedBlocks.get(key);
      if (retained) {
        yield retained;
        return;
      }
      const node = createHeliaLight({
        blockBrokers: [
          () => ({
            name: "caller-read-port",
            retrieve: async (target, request) => {
              const bytes = await client.block.get(target.toString(), { signal: options.signal });
              if (bytes.byteLength > options.maxBlockBytes)
                throw new Error("IPFS block capacity exceeded.");
              await request?.validateFn?.(bytes);
              return bytes;
            },
          }),
        ],
      });
      await node.start();
      let bytes: Uint8Array;
      try {
        const parts: Uint8Array[] = [];
        for await (const part of node.blockstore.get(cid, { signal: options.signal }))
          parts.push(part);
        bytes = Buffer.concat(parts);
      } finally {
        await node.stop();
      }
      options.signal.throwIfAborted();
      // Another concurrent read may have retained this block during the await.
      if (!options.retainedBlocks.has(key)) {
        if (
          options.retainedBlocks.size >= options.maxDagBlocks ||
          options.retentionBudget.bytes + bytes.byteLength > options.retentionBudget.limit
        )
          throw new Error("IPFS retention capacity exceeded.");
        options.retentionBudget.bytes += bytes.byteLength;
        options.retainedBlocks.set(key, bytes);
      }
      yield bytes;
    },
  });
}
export async function openContent(
  client: IpfsClient,
  path: string,
  options: ContentAccessOptions,
): Promise<UnixFSEntry> {
  const store = contentStore(client, options);
  const entry = await exporter(path, store, { signal: options.signal });
  if (entry.type !== "file" && entry.type !== "raw") return entry;
  const [root, ...parts] = path.split("/");
  const fs = unixfs({ blockstore: store });
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
      // UnixFS' exporter queues eagerly. One range per pull bounds its read-ahead.
      const window = 262_144;
      for (let offset = start; offset < start + length; offset += window) {
        const range = {
          path: parts.join("/"),
          signal,
          blockReadConcurrency: 1,
          offset,
          length: Math.min(window, start + length - offset),
        };
        for await (const chunk of fs.cat(CID.parse(root!), range)) {
          signal.throwIfAborted();
          if (chunk.byteLength) yield chunk;
        }
      }
      signal.throwIfAborted();
    },
  };
}
