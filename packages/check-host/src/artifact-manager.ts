import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { ensurePrivateDirectory } from "@potential-guide/check-runtime-files";
import {
  artifactDigestPrefix,
  fetchCheckArchive,
  inspectCheckArchive,
  prepareCheckArtifact,
  inspectCheckArtifact,
  transportDigest,
  type PreparedCheckArtifact,
} from "@potential-guide/check-artifacts";
import { TaskProtocolError, type ArtifactMetadata, v2Limits } from "./v2-types.js";

export interface ManagedArtifact {
  metadata: ArtifactMetadata;
  prepared: PreparedCheckArtifact;
}
export class ArtifactManager {
  private readonly entries = new Map<string, ManagedArtifact>();
  private readonly pinned = new Map<string, Promise<ManagedArtifact>>();
  private active = 0;
  private publication: Promise<unknown> = Promise.resolve();
  private initialized: Promise<void> | undefined;
  private readonly known = new Set<string>();
  private readonly closing = new AbortController();
  private readonly operations = new Set<Promise<ManagedArtifact>>();
  private readonly refs = new Map<string, number>();
  constructor(
    readonly directory: string,
    readonly allowedOrigins: readonly string[] = [
      "https://github.com",
      "https://release-assets.githubusercontent.com",
      "https://objects.githubusercontent.com",
    ],
    readonly limits = v2Limits,
  ) {}
  authorize(source: string) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new TaskProtocolError(400, {
        code: "invalid_source",
        stage: "resolve",
        message: "Invalid HTTPS source.",
      });
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !this.allowedOrigins.includes(url.origin)
    )
      throw new TaskProtocolError(403, {
        code: "source_denied",
        stage: "resolve",
        message: "Source origin is not authorized.",
      });
    return url;
  }
  retain(digest: string) {
    this.refs.set(digest, (this.refs.get(digest) ?? 0) + 1);
  }
  release(digest: string) {
    const count = this.refs.get(digest) ?? 0;
    if (count > 1) this.refs.set(digest, count - 1);
    else this.refs.delete(digest);
  }
  private initialize() {
    this.initialized ??= (async () => {
      await ensurePrivateDirectory(this.directory);
      for (const entry of await readdir(this.directory))
        if (/^[a-f0-9]{64}$/.test(entry)) this.known.add(`${artifactDigestPrefix}${entry}`);
      if (this.known.size > this.limits.artifacts)
        throw new TaskProtocolError(503, {
          code: "cache_capacity",
          stage: "verify",
          message: "Existing cache exceeds configured capacity.",
        });
    })();
    return this.initialized;
  }
  private async exact(digest: string): Promise<ManagedArtifact> {
    if (!new RegExp(`^${artifactDigestPrefix}[a-f0-9]{64}$`).test(digest))
      throw new TaskProtocolError(400, {
        code: "invalid_digest",
        stage: "verify",
        message: "Invalid logical digest.",
      });
    await this.initialize();
    const cached = this.entries.get(digest);
    if (cached) return this.verify(cached);
    const target = join(this.directory, digest.slice(artifactDigestPrefix.length));
    try {
      await lstat(target);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        throw new TaskProtocolError(404, {
          code: "artifact_unavailable",
          stage: "resolve",
          message: "Accurate artifact is not prepared.",
        });
      throw error;
    }
    this.retain(digest);
    try {
      const prepared = await prepareCheckArtifact(
        { kind: "directory", directory: join(target, "artifact"), digest },
        { cacheDirectory: this.directory },
      );
      const entry = {
        prepared,
        metadata: {
          digest,
          revision: prepared.revision,
          manifest: prepared.manifest,
          source: "retained-cache",
          checkedAt: new Date().toISOString(),
        },
      };
      this.entries.set(digest, entry);
      this.protect(entry);
      return entry;
    } catch {
      throw new TaskProtocolError(503, {
        code: "cache_invalid",
        stage: "verify",
        message: "Exact cached capsule failed verification.",
      });
    } finally {
      this.release(digest);
    }
  }
  async metadata(digest: string) {
    const entry = await this.exact(digest);
    return structuredClone(entry.metadata);
  }
  async reference(digest: string, id: string) {
    const entry = await this.exact(digest);
    const reference =
      id === "check"
        ? entry.metadata.manifest.references.check
        : id.startsWith("problems/")
          ? entry.metadata.manifest.references.problems[id.slice(9)]
          : [
              entry.metadata.manifest.references.check,
              ...Object.values(entry.metadata.manifest.references.problems),
              ...(entry.metadata.manifest.references.supporting ?? []),
            ].find((path) => path === id);
    if (!reference)
      throw new TaskProtocolError(404, {
        code: "reference_unavailable",
        stage: "resolve",
        message: "Unknown Reference.",
      });
    this.retain(digest);
    try {
      const inspected = await inspectCheckArtifact(entry.prepared.artifactDirectory);
      if (inspected.digest !== digest)
        throw new TaskProtocolError(503, {
          code: "cache_invalid",
          stage: "verify",
          message: "Reference capsule digest mismatch.",
        });
      const bytes = inspected.files.get(reference);
      if (!bytes)
        throw new TaskProtocolError(503, {
          code: "cache_invalid",
          stage: "verify",
          message: "Reference content unavailable.",
        });
      // Re-verify the complete capsule before returning raw data.
      await prepareCheckArtifact(
        { kind: "directory", directory: entry.prepared.artifactDirectory, digest },
        { cacheDirectory: this.directory },
      );
      return bytes;
    } finally {
      this.release(digest);
    }
  }
  async resolve(source: string, digest?: string): Promise<ManagedArtifact> {
    if (this.closing.signal.aborted)
      throw new TaskProtocolError(503, { code: "host_closing", stage: "resolve", message: "Artifact Manager is closing." });
    const url = this.authorize(source);
    if (digest && !new RegExp(`^${artifactDigestPrefix}[a-f0-9]{64}$`).test(digest))
      throw new TaskProtocolError(400, {
        code: "invalid_digest",
        stage: "verify",
        message: "Invalid logical digest.",
      });
    if (digest) {
      const pending = this.pinned.get(digest);
      if (pending) return this.borrow(await pending, url);
    }
    if (this.active >= this.limits.preparations)
      throw new TaskProtocolError(429, {
        code: "preparation_capacity",
        stage: "resolve",
        message: "Preparation capacity exhausted.",
      });
    this.active++;
    const operation = digest
      ? this.exact(digest).catch((error) => {
          if (!(error instanceof TaskProtocolError && error.status === 404)) throw error;
          return this.acquire(url, digest);
        })
      : this.acquire(url);
    this.operations.add(operation);
    if (digest) this.pinned.set(digest, operation);
    try {
      return this.borrow(await operation, url);
    } finally {
      this.active--;
      this.operations.delete(operation);
      if (digest) this.pinned.delete(digest);
    }
  }
  private protect(entry: ManagedArtifact) {
    this.retain(entry.metadata.digest);
    // Keep an IO-to-arbitration handoff alive until callers have synchronously bound their refs.
    setImmediate(() => this.release(entry.metadata.digest));
  }
  private borrow(entry: ManagedArtifact, url: URL) {
    this.protect(entry);
    return {
      prepared: entry.prepared,
      metadata: { ...structuredClone(entry.metadata), source: url.origin },
    };
  }
  private async verify(cached: ManagedArtifact) {
    const digest = cached.metadata.digest;
    this.retain(digest);
    try {
      const prepared = await prepareCheckArtifact(
        { kind: "directory", directory: cached.prepared.artifactDirectory, digest },
        { cacheDirectory: this.directory },
      );
      this.protect(cached);
      return { metadata: cached.metadata, prepared };
    } finally {
      this.release(digest);
    }
  }
  private async acquire(url: URL, digest?: string): Promise<ManagedArtifact> {
    const signal = AbortSignal.any([AbortSignal.timeout(this.limits.preparationMs), this.closing.signal]);
    let stage = "download";
    try {
      const bytes = await fetchCheckArchive(url.href, {
        signal,
        allowedOrigins: this.allowedOrigins,
      });
      stage = "verify";
      const artifact = await inspectCheckArchive(bytes, signal);
      if (digest && artifact.digest !== digest) throw new Error("Digest mismatch.");
      await this.initialize();
      const publish = this.publication.then(async () => {
        if (!this.known.has(artifact.digest) && this.known.size >= this.limits.artifacts) {
          const unused = [...this.known].find((key) => !this.refs.has(key));
          if (!unused)
            throw new TaskProtocolError(429, {
              code: "artifact_capacity",
              stage,
              message: "All artifacts are referenced.",
            });
          this.entries.delete(unused);
          this.known.delete(unused);
          await rm(join(this.directory, unused.slice(artifactDigestPrefix.length)), {
            recursive: true,
            force: true,
          });
        }
        const prepared = await prepareCheckArtifact(
          { kind: "archive", bytes, digest: artifact.digest },
          { cacheDirectory: this.directory, signal },
        );
        const metadata: ArtifactMetadata = {
          digest: artifact.digest,
          revision: prepared.revision,
          manifest: prepared.manifest,
          source: url.origin,
          checkedAt: new Date().toISOString(),
          transportDigest: transportDigest(bytes),
        };
        const entry = { prepared, metadata };
        this.entries.set(artifact.digest, entry);
        this.known.add(artifact.digest);
        this.protect(entry);
        return entry;
      });
      this.publication = publish.catch(() => {});
      return await publish;
    } catch (error) {
      if (error instanceof TaskProtocolError) throw error;
      throw new TaskProtocolError(502, {
        code: "artifact_preparation_failed",
        stage,
        message: "Check source preparation failed.",
      });
    }
    async close() {
      this.closing.abort();
      await Promise.allSettled([...this.operations]);
    }
  }
}
