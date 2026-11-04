import type { KuboRPCClient } from "kubo-rpc-client";
import { CID } from "multiformats/cid";
import { snapshotCar } from "./blocks.js";
import { type ContentCarOptions, encodeContentCar, validateContentCar } from "./codec.js";

export interface IpfsImportClient {
  dag: Pick<KuboRPCClient["dag"], "import">;
  pin: {
    add(
      cid: string,
      options: { recursive: true; signal?: AbortSignal },
    ): Promise<{ toString(): string }>;
  };
}

/** Publishing transport only; never used by Engine reads and never starts a daemon. */
export async function createIpfsClient(url: string): Promise<KuboRPCClient> {
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
  return create({ url: endpoint, timeout: 30_000 });
}

/** Import an admitted CAR without asking Kubo to pin or re-import/re-chunk its files. */
export async function writeContentCar(
  bytes: Uint8Array,
  expectedRoot: string,
  client: Pick<IpfsImportClient, "dag">,
  options: ContentCarOptions = {},
): Promise<string> {
  const snapshot = snapshotCar(bytes, options.maxCarBytes, options.signal);
  const { cid } = await validateContentCar(snapshot, expectedRoot, options);
  for await (const result of client.dag.import([snapshot], {
    pinRoots: false,
    ...(options.signal ? { signal: options.signal } : {}),
  })) {
    options.signal?.throwIfAborted();
    if (!CID.parse(cid).equals(result.root.cid))
      throw new Error("IPFS CAR publication returned a different root.");
    if (result.root.pinErrorMsg) throw new Error("IPFS CAR publication failed.");
  }
  options.signal?.throwIfAborted();
  return cid;
}

/** Durable recursive pinning is a separate, explicit caller decision. */
export async function pinContent(
  cid: string,
  client: Pick<IpfsImportClient, "pin">,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  const pinned = await client.pin.add(cid, { recursive: true, ...options });
  options.signal?.throwIfAborted();
  if (!CID.parse(cid).equals(CID.parse(pinned.toString())))
    throw new Error("IPFS publication did not confirm the requested root pin.");
}

/** Convenience composition for existing callers; codec, write and pin remain independent. */
export async function publishContent(
  files: ReadonlyMap<string, Uint8Array>,
  client: IpfsImportClient,
): Promise<string> {
  const { cid, bytes } = await encodeContentCar(files);
  await writeContentCar(bytes, cid, client);
  await pinContent(cid, client);
  return cid;
}
