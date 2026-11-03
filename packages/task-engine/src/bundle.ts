import { randomUUID } from "node:crypto";
import { createReadStream, type Dir } from "node:fs";
import { chmod, lstat, mkdir, opendir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ArchiveLimits,
  ArchiveCapacityError,
  artifactLimits,
  assertRuntime,
  gitTreeDigest,
  parseArtifactYaml,
  readArtifactFiles,
  safePath,
  unpackArtifactFiles,
} from "@potential-guide/check-artifacts/files";
import {
  type BundleReference,
  type BundleCacheDetail,
  type BundleCachePage,
  type JsonObject,
  type ResolvedTaskBundle,
  resolveBundleSchemas,
  type TaskBundleDeclaration,
  TaskError,
  validateBundleReference,
  validateTaskBundle,
} from "@potential-guide/task-protocol";

export type BundleLimits = ArchiveLimits;
export const defaultBundleLimits: Readonly<BundleLimits> = Object.freeze({
  ...artifactLimits,
  fileBytes: 64 * 1024 * 1024,
});
export interface VerifiedBundle {
  digest: string;
  declaration: TaskBundleDeclaration;
  resolved: ResolvedTaskBundle;
  directory: string;
  bytes: number;
  files: number;
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
    throw new TaskError(
      "invalid_bundle",
      "Bundle requires task.yaml and a nonempty worker.cjs at its logical root.",
    );
  let declaration: TaskBundleDeclaration;
  let schemas: JsonObject[];
  try {
    declaration = validateTaskBundle(parseArtifactYaml(yaml));
    schemas = [...files]
      .filter(([path]) => path.startsWith("schemas/"))
      .map(
        ([, content]) =>
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)) as JsonObject,
      );
  } catch (error) {
    if (error instanceof TaskError) throw error;
    throw new TaskError("invalid_bundle", "Invalid Bundle declaration or shared Schema JSON.");
  }
  try {
    assertRuntime(declaration);
  } catch {
    throw new TaskError("unsupported_runtime", "Bundle Node runtime is unsupported.");
  }
  return {
    declaration,
    resolved: resolveBundleSchemas(declaration, schemas),
    digest: gitTreeDigest(files),
    bytes,
    files: files.size,
  };
}
export interface BundleCacheOptions {
  directory: string;
  concurrency?: number;
  limits?: Partial<BundleLimits>;
  fetch?: typeof globalThis.fetch;
}

/** Content cache only: it is not a registry, type directory or admission-result cache. */
export class BundleCache {
  readonly limits: BundleLimits;
  private readonly root: string;
  private readonly fetching = new Map<string, Promise<VerifiedBundle>>();
  private readonly pins = new Map<string, number>();
  private readonly removing = new Map<string, Promise<void>>();
  private readonly lifetime = new AbortController();
  private readonly concurrency: number;
  private occupied = 0;
  private readonly waiting: { enter(): void; reject(error: unknown): void }[] = [];
  constructor(private readonly options: BundleCacheOptions) {
    if (!options.directory)
      throw new TaskError("invalid_config", "Bundle cache directory is required.");
    this.root = resolve(options.directory);
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency <= 0)
      throw new TaskError("invalid_config", "Invalid Bundle preparation concurrency.");
    this.limits = { ...defaultBundleLimits, ...options.limits };
    for (const [key, value] of Object.entries(this.limits))
      if (!Object.hasOwn(defaultBundleLimits, key) || !Number.isSafeInteger(value) || value <= 0)
        throw new TaskError("invalid_config", "Invalid Bundle capacity.");
  }
  private target(digest: string): string {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest))
      throw new TaskError("invalid_request", "Invalid Bundle Digest.");
    return join(this.root, digest.slice("sha256:".length));
  }
  private async cached(digest: string): Promise<VerifiedBundle | undefined> {
    const directory = this.target(digest);
    try {
      await lstat(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let files: ReadonlyMap<string, Buffer>;
    try {
      files = await readArtifactFiles(directory, this.limits);
    } catch (error) {
      if ((error as { status?: number }).status === 413)
        throw new TaskError("capacity_exceeded", "Cached Bundle exceeds current host capacity.");
      throw new TaskError("invalid_bundle", "Cached Bundle cannot be verified.");
    }
    const inspected = inspectTaskBundle(files, this.limits);
    if (inspected.digest !== digest)
      throw new TaskError(
        "bundle_digest_mismatch",
        "Cached Bundle content differs from its Digest.",
      );
    return { ...inspected, directory };
  }
  async available(digest: string): Promise<boolean> {
    try {
      return (await lstat(this.target(digest))).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
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
    const signal = this.lifetime.signal;
    const ref = validateBundleReference(reference);
    const removing = this.removing.get(ref.digest);
    if (removing) await removing;
    signal.throwIfAborted();
    this.pins.set(ref.digest, (this.pins.get(ref.digest) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const count = this.pins.get(ref.digest)! - 1;
      if (count) this.pins.set(ref.digest, count);
      else this.pins.delete(ref.digest);
    };
    let operation = this.fetching.get(ref.digest);
    if (!operation) {
      operation = this.inSlot(() => this.prepare(ref, signal));
      this.fetching.set(ref.digest, operation);
      void operation
        .finally(() => {
          if (this.fetching.get(ref.digest) === operation) this.fetching.delete(ref.digest);
        })
        .catch(() => {});
    }
    try {
      const prepared = await operation;
      signal.throwIfAborted();
      return { ...prepared, release };
    } catch (error) {
      release();
      throw error;
    }
  }
  private async prepare(reference: BundleReference, signal: AbortSignal): Promise<VerifiedBundle> {
    const cached = await this.cached(reference.digest);
    if (cached) return cached;
    const files = await this.download(reference.url, signal);
    const inspected = inspectTaskBundle(files, this.limits);
    if (inspected.digest !== reference.digest)
      throw new TaskError(
        "bundle_digest_mismatch",
        "Downloaded Bundle does not match the requested Digest.",
      );
    signal.throwIfAborted();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stage = join(this.root, `.staging-${randomUUID()}`);
    const directory = this.target(reference.digest);
    await mkdir(stage, { mode: 0o700 });
    try {
      for (const [path, content] of files) {
        const target = join(stage, ...path.split("/"));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, content, { flag: "wx", mode: 0o400 });
        await chmod(target, 0o400);
      }
      signal.throwIfAborted();
      try {
        await rename(stage, directory);
      } catch (error) {
        if (!(await this.cached(reference.digest))) throw error;
      }
      const verified = await this.cached(reference.digest);
      if (!verified)
        throw new TaskError("invalid_bundle", "Verified Bundle disappeared while caching.");
      return verified;
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  private async download(urlText: string, signal: AbortSignal): Promise<Map<string, Buffer>> {
    const url = new URL(urlText);
    let body: AsyncIterable<Uint8Array>;
    let response: Response | undefined;
    let extracting = false;
    try {
      if (url.protocol === "file:") {
        const file = fileURLToPath(url);
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink())
          throw new TaskError("invalid_bundle", "Bundle URL must identify a regular archive file.");
        if (info.size > this.limits.archiveBytes)
          throw new TaskError("capacity_exceeded", "Bundle download capacity exceeded.");
        body = createReadStream(file, { signal });
      } else {
        response = await (this.options.fetch ?? globalThis.fetch)(url, {
          signal,
          redirect: "error",
          credentials: "omit",
          headers: { "Accept-Encoding": "identity" },
        });
        if (!response.ok || !response.body)
          throw new TaskError("bundle_fetch_failed", "Bundle download failed.");
        const length = response.headers.get("content-length");
        if (length && (!/^\d+$/.test(length) || Number(length) > this.limits.archiveBytes))
          throw new TaskError("capacity_exceeded", "Bundle download capacity exceeded.");
        const encoding = response.headers.get("content-encoding");
        if (encoding && encoding !== "identity")
          throw new TaskError("invalid_bundle", "Bundle requires identity HTTP content encoding.");
        body = response.body;
      }
      extracting = true;
      return await unpackArtifactFiles(body, signal, this.limits);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof TaskError) throw error;
      if (error instanceof ArchiveCapacityError)
        throw new TaskError("capacity_exceeded", "Bundle acquisition exceeds host capacity.");
      const code =
        (error as { code?: string; cause?: { code?: string } }).code ??
        (error as { cause?: { code?: string } }).cause?.code;
      throw new TaskError(
        !extracting || code?.startsWith("E") ? "bundle_fetch_failed" : "invalid_bundle",
        "Bundle acquisition or archive validation failed.",
      );
    } finally {
      await response?.body?.cancel().catch(() => {});
    }
  }
  /** Host-directed eviction cannot invalidate an in-flight preparation or active Run lease. */
  async evict(digest: string): Promise<boolean> {
    const target = this.target(digest);
    if (this.fetching.has(digest) || this.pins.has(digest) || this.removing.has(digest))
      return false;
    const operation = rm(target, { recursive: true, force: true });
    this.removing.set(digest, operation);
    try {
      await operation;
      return true;
    } finally {
      this.removing.delete(digest);
    }
  }
  async detail(digest: string): Promise<BundleCacheDetail> {
    this.target(digest);
    const removing = this.removing.get(digest);
    if (removing) await removing;
    this.lifetime.signal.throwIfAborted();
    const leases = this.pins.get(digest) ?? 0;
    this.pins.set(digest, leases + 1);
    try {
      const prepared = await this.cached(digest);
      if (!prepared && !this.fetching.has(digest))
        throw new TaskError("not_found", "Bundle is not cached.");
      return {
        digest,
        cached: !!prepared,
        preparing: this.fetching.has(digest),
        leases: this.pins.get(digest)! - 1,
        ...(prepared
          ? {
              name: prepared.declaration.name,
              bytes: prepared.bytes,
              files: prepared.files,
              declaration: prepared.declaration,
              resolved: prepared.resolved,
            }
          : {}),
      };
    } finally {
      const count = this.pins.get(digest)! - 1;
      if (count) this.pins.set(digest, count);
      else this.pins.delete(digest);
    }
  }
  async list(page: { after?: string; limit?: number }): Promise<BundleCachePage> {
    const limit = page.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new TaskError("invalid_request", "Cache page limit must be between 1 and 100.");
    if (page.after !== undefined) this.target(page.after);
    this.lifetime.signal.throwIfAborted();
    const digests = new Set(this.fetching.keys());
    let directory: Dir | undefined;
    try {
      directory = await opendir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (directory) {
      let scanned = 0;
      for await (const entry of directory) {
        if (++scanned > 10_000)
          throw new TaskError("capacity_exceeded", "Cache directory enumeration budget exceeded.");
        if (/^[a-f0-9]{64}$/.test(entry.name)) {
          if (!entry.isDirectory() || entry.isSymbolicLink())
            throw new TaskError("invalid_bundle", "Cache entry is not a regular directory.");
          digests.add(`sha256:${entry.name}`);
        }
      }
    }
    const candidates = [...digests].filter((digest) => !page.after || digest > page.after).sort();
    const items: BundleCachePage["items"] = [];
    for (const digest of candidates.slice(0, limit)) {
      try {
        const {
          declaration: _declaration,
          resolved: _resolved,
          ...entry
        } = await this.detail(digest);
        items.push(entry);
      } catch (error) {
        if (!(error instanceof TaskError) || error.code !== "not_found") throw error;
      }
    }
    return {
      items,
      observedAt: new Date().toISOString(),
      ...(candidates.length > limit ? { next: candidates[limit - 1] } : {}),
    };
  }
  async close(): Promise<void> {
    this.lifetime.abort(new TaskError("engine_closed", "Bundle cache is closing."));
    for (const waiting of this.waiting.splice(0)) waiting.reject(this.lifetime.signal.reason);
    await Promise.allSettled([...this.fetching.values()]);
  }
}
