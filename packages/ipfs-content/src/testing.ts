import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { collectBytes } from "./blocks.js";
import type { IpfsClient } from "./read.js";

/** Private/offline fixtures using the same standard UnixFS import as publication. */
export class MemoryIpfsClient implements IpfsClient {
  readonly blocks = new Map<string, Uint8Array>();
  readonly pins = new Set<string>();
  readonly block = {
    put: async (bytes: Uint8Array, options: { format: string }) => {
      const cid = CID.createV1(options.format === "raw" ? 0x55 : 0x70, await sha256.digest(bytes));
      this.blocks.set(cid.toString(), Uint8Array.from(bytes));
      return cid;
    },
    get: async (cid: string, options?: { signal?: AbortSignal }): Promise<Uint8Array> => {
      options?.signal?.throwIfAborted();
      const bytes = this.blocks.get(cid);
      if (!bytes) throw new Error("IPFS block is unavailable.");
      return Uint8Array.from(bytes);
    },
  };
  readonly pin = {
    add: async (cid: string) => {
      if (!this.blocks.has(cid)) throw new Error("Cannot pin missing root.");
      this.pins.add(cid);
      return CID.parse(cid);
    },
  };
  readonly dag: Pick<KuboRPCClient["dag"], "import"> = {
    import: this.importCar.bind(this),
  };
  private async *importCar(
    sources: Parameters<KuboRPCClient["dag"]["import"]>[0],
    options?: { pinRoots?: boolean; signal?: AbortSignal },
  ) {
    const [{ CarReader }, { validateContentCar }] = await Promise.all([
      import("@ipld/car"),
      import("./codec.js"),
    ]);
    if (sources instanceof ReadableStream)
      throw new Error("Memory fixture expects iterable CAR input.");
    const bytes = await collectBytes(
      sources as Iterable<Uint8Array>,
      256 * 1024 * 1024,
      options?.signal,
    );
    const { cid } = await validateContentCar(
      bytes,
      undefined,
      options?.signal ? { signal: options.signal } : {},
    );
    const reader = await CarReader.fromBytes(bytes);
    for await (const block of reader.blocks())
      this.blocks.set(block.cid.toString(), Uint8Array.from(block.bytes));
    if (options?.pinRoots) this.pins.add(cid);
    yield { root: { cid: CID.parse(cid) } };
  }
  async import(files: ReadonlyMap<string, Uint8Array>): Promise<string> {
    const { importContent } = await import("./codec.js");
    return importContent(files, async (cid, bytes) => {
      this.blocks.set(cid, Uint8Array.from(bytes));
    });
  }
}
import type { KuboRPCClient } from "kubo-rpc-client";
