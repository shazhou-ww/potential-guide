import {
  type ArchiveLimits,
  artifactLimits,
  assertRuntime,
  parseArtifactYaml,
  safePath,
} from "@potential-guide/check-artifacts/files";
import { type IpfsClient, openContent, retainContent } from "@potential-guide/ipfs-content/read";
import {
  type BundleReference,
  bundleCid,
  type JsonObject,
  type ResolvedTaskBundle,
  resolveBundleSchemas,
  type TaskBundleDeclaration,
  TaskError,
  validateBundleReference,
  validateTaskBundle,
  validateTaskBundleFiles,
} from "@potential-guide/task-protocol";

export type BundleLimits = Pick<ArchiveLimits, "bytes" | "files" | "paths" | "fileBytes"> & {
  hints: number;
  retainedBytes: number;
  blocks: number;
};
export const defaultBundleLimits: Readonly<BundleLimits> = Object.freeze({
  bytes: artifactLimits.bytes,
  files: artifactLimits.files,
  paths: artifactLimits.paths,
  fileBytes: 64 * 1024 * 1024,
  hints: 16,
  retainedBytes: 256 * 1024 * 1024,
  blocks: 16_384,
});
export interface VerifiedBundle {
  cid: string;
  declaration: TaskBundleDeclaration;
  resolved: ResolvedTaskBundle;
  source: string;
  bytes: number;
  files: number;
  retainedBytes: number;
  read(path: string, signal: AbortSignal): Promise<AsyncIterator<Uint8Array>>;
}
export function inspectTaskBundle(
  files: ReadonlyMap<string, Buffer>,
  limits: BundleLimits = defaultBundleLimits,
) {
  const seen = new Set<string>();
  const spellings = new Map<string, string>();
  let bytes = 0;
  if (files.size > limits.files)
    throw new TaskError("capacity_exceeded", "Bundle file capacity exceeded.");
  for (const [path, content] of files) {
    if (
      !safePath(path) ||
      seen.has(path.toLowerCase()) ||
      (!["task.yaml", "worker.cjs"].includes(path) &&
        !path.startsWith("schemas/") &&
        !path.startsWith("resources/"))
    )
      throw new TaskError("invalid_bundle", "Unsafe, duplicate or unsupported Bundle path.");
    seen.add(path.toLowerCase());
    let prefix = "";
    for (const part of path.split("/")) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const folded = prefix.toLowerCase();
      if (spellings.has(folded) && spellings.get(folded) !== prefix)
        throw new TaskError("invalid_bundle", "Ambiguous Bundle path casing.");
      spellings.set(folded, prefix);
    }
    bytes += content.length;
    if (content.length > limits.fileBytes || bytes > limits.bytes || spellings.size > limits.paths)
      throw new TaskError("capacity_exceeded", "Bundle tree capacity exceeded.");
  }
  for (const path of files.keys()) {
    const parts = path.split("/");
    parts.pop();
    while (parts.length) {
      if (files.has(parts.join("/")))
        throw new TaskError("invalid_bundle", "Bundle file is also a parent.");
      parts.pop();
    }
  }
  const yaml = files.get("task.yaml");
  if (!yaml || !files.get("worker.cjs")?.length)
    throw new TaskError("invalid_bundle", "Bundle requires task.yaml and nonempty worker.cjs.");
  let declaration: TaskBundleDeclaration;
  let schemas: JsonObject[];
  const schemaFiles = [...files].filter(([path]) => path.startsWith("schemas/"));
  try {
    declaration = validateTaskBundle(parseArtifactYaml(yaml));
    validateTaskBundleFiles(declaration, files.keys());
    schemas = schemaFiles.map(
      ([, content]) =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)) as JsonObject,
    );
    new TextDecoder("utf-8", { fatal: true }).decode(files.get("worker.cjs"));
  } catch (error) {
    if (error instanceof TaskError) throw error;
    throw new TaskError("invalid_bundle", "Invalid Bundle declaration, Worker or Schema JSON.");
  }
  try {
    assertRuntime(declaration);
  } catch {
    throw new TaskError("unsupported_runtime", "Bundle Node runtime is unsupported.");
  }
  return {
    declaration,
    resolved: resolveBundleSchemas(
      declaration,
      schemas,
      schemaFiles.map(([path]) => path),
    ),
    bytes,
    files: files.size,
  };
}
export interface BundleCacheOptions {
  ipfsClient: IpfsClient;
  concurrency?: number;
  limits?: Partial<BundleLimits>;
  allowGateway?: (url: URL) => boolean;
  fetch?: typeof globalThis.fetch;
}

/** Bounded verified load results and leases, never a distribution service or owner of shared pins. */
export class BundleCache {
  readonly limits: BundleLimits;
  private readonly fetching = new Map<string, Promise<VerifiedBundle>>();
  private readonly prepared = new Map<string, VerifiedBundle>();
  private readonly leases = new Map<string, number>();
  private readonly lifetime = new AbortController();
  private readonly retentionBudget = { bytes: 0, limit: 0 };
  private readonly concurrency: number;
  private occupied = 0;
  private readonly waiting: { enter(): void; reject(error: unknown): void }[] = [];
  constructor(private readonly options: BundleCacheOptions) {
    if (typeof options.ipfsClient?.block?.get !== "function")
      throw new TaskError("invalid_config", "A caller-owned IPFS content client is required.");
    if (
      (options.allowGateway !== undefined && typeof options.allowGateway !== "function") ||
      (options.fetch !== undefined && typeof options.fetch !== "function")
    )
      throw new TaskError("invalid_config", "Invalid IPFS gateway access policy or transport.");
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency <= 0)
      throw new TaskError("invalid_config", "Invalid Bundle preparation concurrency.");
    this.limits = { ...defaultBundleLimits, ...options.limits };
    this.retentionBudget.limit = this.limits.retainedBytes;
    for (const [key, value] of Object.entries(this.limits))
      if (!Object.hasOwn(defaultBundleLimits, key) || !Number.isSafeInteger(value) || value <= 0)
        throw new TaskError("invalid_config", "Invalid Bundle capacity.");
  }
  async available(cid: string): Promise<boolean> {
    cid = bundleCid(validateBundleReference(cid));
    return this.prepared.has(cid);
  }
  source(cid: string): string {
    const prepared = this.prepared.get(cid);
    if (!prepared) throw new TaskError("bundle_fetch_failed", "Bundle is not retained.");
    return prepared.source;
  }
  read(cid: string, path: string, signal: AbortSignal): Promise<AsyncIterator<Uint8Array>> {
    const prepared = this.prepared.get(cid);
    if (!prepared)
      return Promise.reject(new TaskError("bundle_fetch_failed", "Bundle is not retained."));
    return prepared.read(path, signal);
  }
  private async inSlot<T>(action: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      const enter = () => {
        this.occupied++;
        resolve();
      };
      if (this.occupied < this.concurrency) enter();
      else this.waiting.push({ enter, reject });
    });
    try {
      this.lifetime.signal.throwIfAborted();
      return await action();
    } finally {
      this.occupied--;
      this.waiting.shift()?.enter();
    }
  }
  async acquire(reference: BundleReference): Promise<VerifiedBundle & { release(): void }> {
    const ref = validateBundleReference(reference, this.limits.hints);
    const cid = bundleCid(ref);
    this.lifetime.signal.throwIfAborted();
    this.leases.set(cid, (this.leases.get(cid) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const count = (this.leases.get(cid) ?? 1) - 1;
      if (count) this.leases.set(cid, count);
      else this.leases.delete(cid);
    };
    let operation = this.fetching.get(cid);
    if (!operation) {
      operation = this.inSlot(() => this.prepare(ref));
      this.fetching.set(cid, operation);
      void operation
        .finally(() => {
          if (this.fetching.get(cid) === operation) this.fetching.delete(cid);
        })
        .catch(() => {});
    }
    try {
      const prepared = this.prepared.get(cid) ?? (await operation);
      this.lifetime.signal.throwIfAborted();
      this.prepared.set(cid, prepared);
      return { ...prepared, release };
    } catch (error) {
      release();
      throw error;
    }
  }
  private async prepare(reference: BundleReference): Promise<VerifiedBundle> {
    const cid = bundleCid(reference);
    const cached = this.prepared.get(cid);
    if (cached) return cached;
    const retainedBlocks = new Map<string, Uint8Array>();
    const gateways =
      typeof reference === "string"
        ? []
        : typeof reference.hint === "string"
          ? [reference.hint]
          : reference.hint;
    const access = (signal: AbortSignal) => ({
      signal: AbortSignal.any([signal, this.lifetime.signal]),
      gateways,
      ...(this.options.allowGateway ? { allowGateway: this.options.allowGateway } : {}),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      maxBlockBytes: Math.min(this.limits.bytes, 2 * 1024 * 1024),
      retainedBlocks,
      maxRetainedBytes: this.limits.bytes * 2,
      retentionBudget: this.retentionBudget,
      maxDagBlocks: this.limits.blocks,
      maxFileBytes: this.limits.fileBytes,
      inspectNode: (entry: Awaited<ReturnType<typeof openContent>>) => {
        if (entry.type === "file" && !["file", "raw"].includes(entry.unixfs.type))
          throw new TaskError(
            "invalid_bundle",
            "Bundle requires regular files, not UnixFS symlink or metadata nodes.",
          );
      },
    });
    const files = new Map<string, Buffer>();
    const logicalPaths = new Set<string>();
    let total = 0;
    let paths = 0;
    const walk = async (
      entry: Awaited<ReturnType<typeof openContent>>,
      path: string,
    ): Promise<void> => {
      if (path && ++paths > this.limits.paths)
        throw new TaskError("capacity_exceeded", "Bundle path capacity exceeded.");
      if (path && !safePath(path)) throw new TaskError("invalid_bundle", "Unsafe Bundle path.");
      if (path) {
        const folded = path.toLowerCase();
        if (logicalPaths.has(folded))
          throw new TaskError("invalid_bundle", "Duplicate or ambiguous Bundle path.");
        logicalPaths.add(folded);
      }
      if (entry.type === "directory") {
        let entries = 0;
        if (path && !["resources", "schemas"].includes(path.split("/")[0]!))
          throw new TaskError("invalid_bundle", "Unsupported Bundle directory.");
        for await (const child of entry.entries({ signal: this.lifetime.signal })) {
          entries++;
          if (!child.name || child.name.includes("/") || child.name.includes("\\"))
            throw new TaskError("invalid_bundle", "Unsafe IPFS directory name.");
          await walk(
            await openContent(
              this.options.ipfsClient,
              child.cid.toString(),
              access(this.lifetime.signal),
            ),
            path ? `${path}/${child.name}` : child.name,
          );
        }
        if (path && !entries)
          throw new TaskError("invalid_bundle", "Empty Bundle directories are not supported.");
      } else if (entry.type === "file" || entry.type === "raw") {
        if (!path || files.size >= this.limits.files)
          throw new TaskError("capacity_exceeded", "Bundle file capacity exceeded.");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of entry.content({ signal: this.lifetime.signal })) {
          size += chunk.byteLength;
          total += chunk.byteLength;
          if (size > this.limits.fileBytes || total > this.limits.bytes)
            throw new TaskError("capacity_exceeded", "Bundle byte capacity exceeded.");
          chunks.push(Buffer.from(chunk));
        }
        if (files.has(path)) throw new TaskError("invalid_bundle", "Duplicate Bundle path.");
        files.set(path, Buffer.concat(chunks));
      } else
        throw new TaskError("invalid_bundle", "Bundle requires regular UnixFS files/directories.");
    };
    try {
      await retainContent(this.options.ipfsClient, cid, access(this.lifetime.signal));
      const root = await openContent(this.options.ipfsClient, cid, access(this.lifetime.signal));
      if (root.type !== "directory")
        throw new TaskError("invalid_bundle", "Bundle CID must identify a directory.");
      await walk(root, "");
      const inspected = inspectTaskBundle(files, this.limits);
      const allowed = new Set(files.keys());
      return {
        ...inspected,
        cid,
        source: files.get("worker.cjs")!.toString("utf8"),
        retainedBytes: [...retainedBlocks.values()].reduce((sum, block) => sum + block.length, 0),
        read: async (path, signal) => {
          if (!safePath(path) || !allowed.has(path))
            throw new TaskError("invalid_bundle", "Bundle path is absent or outside its root.");
          const entry = await openContent(
            this.options.ipfsClient,
            `${cid}/${path}`,
            access(signal),
          );
          if (entry.type !== "file" && entry.type !== "raw")
            throw new TaskError("invalid_bundle", "Bundle path is not a regular file.");
          const combined = access(signal).signal;
          return (async function* () {
            combined.throwIfAborted();
            for await (const chunk of entry.content({ signal: combined })) {
              combined.throwIfAborted();
              yield chunk;
            }
            combined.throwIfAborted();
          })()[Symbol.asyncIterator]();
        },
      };
    } catch (error) {
      this.retentionBudget.bytes -= [...retainedBlocks.values()].reduce(
        (sum, block) => sum + block.length,
        0,
      );
      retainedBlocks.clear();
      if (this.lifetime.signal.aborted) throw this.lifetime.signal.reason;
      if (error instanceof TaskError) throw error;
      if (error instanceof Error && /^IPFS .*capacity exceeded\.$/.test(error.message))
        throw new TaskError("capacity_exceeded", "IPFS acquisition exceeds host capacity.");
      throw new TaskError("bundle_fetch_failed", "IPFS acquisition or CID verification failed.");
    }
  }
  async evict(cid: string): Promise<boolean> {
    cid = bundleCid(validateBundleReference(cid));
    if (this.fetching.has(cid) || this.leases.has(cid)) return false;
    this.retentionBudget.bytes -= this.prepared.get(cid)?.retainedBytes ?? 0;
    this.prepared.delete(cid);
    return true;
  }
  async close(): Promise<void> {
    this.lifetime.abort(new TaskError("engine_closed", "Bundle reads are closing."));
    for (const waiting of this.waiting.splice(0)) waiting.reject(this.lifetime.signal.reason);
    await Promise.allSettled([...this.fetching.values()]);
    this.prepared.clear();
    this.retentionBudget.bytes = 0;
  }
}
