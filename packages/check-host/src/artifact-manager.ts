import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  artifactDigestPrefix,
  fetchCheckArchive,
  inspectCheckArchive,
  prepareCheckArtifact,
  readArtifactFiles,
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
  metadata(digest: string) {
    const entry = this.entries.get(digest);
    if (!entry)
      throw new TaskProtocolError(404, {
        code: "artifact_unavailable",
        stage: "resolve",
        message: "Accurate artifact is not prepared.",
      });
    return structuredClone(entry.metadata);
  }
  async reference(digest: string, id: string) {
    const entry = this.entries.get(digest);
    if (!entry) {
      this.metadata(digest);
      throw new Error("Unreachable artifact lookup.");
    }
    const reference =
      id === "check"
        ? entry.metadata.manifest.references.check
        : id.startsWith("problems/")
          ? entry.metadata.manifest.references.problems[id.slice(9)]
          : entry.metadata.manifest.references.supporting?.find((path) => path === id);
    if (!reference)
      throw new TaskProtocolError(404, {
        code: "reference_unavailable",
        stage: "resolve",
        message: "Unknown Reference.",
      });
    const files = await readArtifactFiles(entry.prepared.artifactDirectory);
    const bytes = files.get(reference);
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
  }
  async resolve(source: string, digest?: string): Promise<ManagedArtifact> {
    const url = this.authorize(source);
    if (digest && !new RegExp(`^${artifactDigestPrefix}[a-f0-9]{64}$`).test(digest))
      throw new TaskProtocolError(400, {
        code: "invalid_digest",
        stage: "verify",
        message: "Invalid logical digest.",
      });
    if (digest) {
      const cached = this.entries.get(digest);
      if (cached) {
        const prepared = await prepareCheckArtifact(
          { kind: "directory", directory: cached.prepared.artifactDirectory, digest },
          { cacheDirectory: this.directory },
        );
        return {
          prepared,
          metadata: { ...cached.metadata, source: `${url.origin}${url.pathname}` },
        };
      }
      const pending = this.pinned.get(digest);
      if (pending) return pending;
    }
    if (this.active >= this.limits.preparations)
      throw new TaskProtocolError(429, {
        code: "preparation_capacity",
        stage: "resolve",
        message: "Preparation capacity exhausted.",
      });
    this.active++;
    const operation = this.acquire(url, digest);
    if (digest) this.pinned.set(digest, operation);
    try {
      return await operation;
    } finally {
      this.active--;
      if (digest) this.pinned.delete(digest);
    }
  }
  private async acquire(url: URL, digest?: string): Promise<ManagedArtifact> {
    const signal = AbortSignal.timeout(this.limits.preparationMs);
    let stage = "download";
    try {
      const bytes = await fetchCheckArchive(url.href, {
        signal,
        allowedOrigins: this.allowedOrigins,
      });
      stage = "verify";
      const artifact = await inspectCheckArchive(bytes, signal);
      if (digest && artifact.digest !== digest) throw new Error("Digest mismatch.");
      if (!this.entries.has(artifact.digest) && this.entries.size >= this.limits.artifacts) {
        const unused = [...this.entries.keys()].find((key) => !this.refs.has(key));
        if (!unused)
          throw new TaskProtocolError(429, {
            code: "artifact_capacity",
            stage,
            message: "All artifacts are referenced.",
          });
        this.entries.delete(unused);
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
        source: `${url.origin}${url.pathname}`,
        checkedAt: new Date().toISOString(),
        transportDigest: transportDigest(bytes),
      };
      const entry = { prepared, metadata };
      this.entries.set(artifact.digest, entry);
      return entry;
    } catch (error) {
      if (error instanceof TaskProtocolError) throw error;
      throw new TaskProtocolError(502, {
        code: "artifact_preparation_failed",
        stage,
        message: "Check source preparation failed.",
      });
    }
  }
}
