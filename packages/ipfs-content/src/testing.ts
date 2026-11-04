import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { type IpfsClient, importContent } from "./index.js";

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
  async import(files: ReadonlyMap<string, Uint8Array>): Promise<string> {
    return importContent(files, async (cid, bytes) => {
      this.blocks.set(cid, Uint8Array.from(bytes));
    });
  }
}
