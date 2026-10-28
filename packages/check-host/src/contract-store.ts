import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ArtifactReference,
  type CheckerManifest,
  type ContractArtifact,
  assertRuntime,
  fetchCheckArchive,
  inspectContractFiles,
  readArtifactFiles,
  transportDigest,
  unpackArtifactFiles,
  validateArtifactReference,
  selectLanguage,
  canonicalJson,
} from "@potential-guide/check-artifacts";
import { ensurePrivateDirectory, readArtifact } from "@potential-guide/check-runtime-files";
import { TaskProtocolError } from "./v2-types.js";
export function selectServiceLanguage(
  supported: readonly string[],
  preferences: readonly string[],
  requested?: string,
) {
  try {
    return selectLanguage(supported, preferences, requested);
  } catch {
    throw new TaskProtocolError(422, {
      code: "unsupported_language",
      stage: "validate",
      message: "Requested or preferred language is unsupported.",
    });
  }
}

export interface RuntimeEvidence {
  type: "node";
  version: string;
  platform: string;
  architecture: string;
  adapter: "node-commonjs-v1";
  configuration: string;
}
export const runtimeEvidence = (
  configuration: Readonly<Record<string, number>> = {},
): RuntimeEvidence => ({
  type: "node",
  version: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
  adapter: "node-commonjs-v1",
  configuration: canonicalJson({ ...configuration }),
});
export interface ContractMetadata {
  digest: string;
  source: string;
  checkedAt: string;
  transportDigest?: string;
  manifest: ContractArtifact["manifest"];
}
export interface ResolvedContract extends ContractArtifact {
  metadata: ContractMetadata;
}
function cloneArtifact(value: ResolvedContract): ResolvedContract {
  return {
    ...structuredClone(value),
    files: new Map([...value.files].map(([path, bytes]) => [path, Buffer.from(bytes)])),
  };
}
export interface ContractRepository {
  authorize(reference: ArtifactReference, scope: string): void;
  resolve(
    reference: ArtifactReference,
    scope: string,
    signal: AbortSignal,
  ): Promise<ResolvedContract>;
  artifact(digest: string, scope: string): Promise<ResolvedContract>;
}
/** Cache ownership is per authorized source AND scope, never just per digest. */
export class ContractStore implements ContractRepository {
  private readonly entries = new Map<string, ResolvedContract>();
  private readonly grants = new Map<string, Map<string, ContractMetadata>>();
  private active = 0;
  private readonly controller = new AbortController();
  constructor(
    readonly allowedOrigins: readonly string[],
    readonly limits = { artifacts: 32, downloads: 4, preparationMs: 30_000 },
    readonly download = fetchCheckArchive,
  ) {}
  authorize(reference: ArtifactReference, _scope: string) {
    try {
      validateArtifactReference(reference);
    } catch {
      throw new TaskProtocolError(400, {
        code: "invalid_source",
        stage: "resolve",
        message: "Expected authorized HTTPS source and optional Git SHA-256 digest.",
      });
    }
    if (!this.allowedOrigins.includes(new URL(reference.url).origin))
      throw new TaskProtocolError(403, {
        code: "source_denied",
        stage: "resolve",
        message: "Artifact source is not authorized.",
      });
  }
  private key(reference: ArtifactReference, scope: string) {
    return `${scope}\0${reference.kind}\0${reference.url}`;
  }
  async resolve(
    reference: ArtifactReference,
    scope: string,
    signal: AbortSignal,
  ): Promise<ResolvedContract> {
    this.authorize(reference, scope);
    signal.throwIfAborted();
    this.controller.signal.throwIfAborted();
    const key = this.key(reference, scope);
    const exact = reference.digest ? this.entries.get(reference.digest) : undefined;
    const granted = reference.digest ? this.grants.get(key)?.get(reference.digest) : undefined;
    if (exact && granted) return cloneArtifact({ ...exact, metadata: granted });
    if (!this.grants.has(key) && this.grants.size >= 256)
      throw new TaskProtocolError(429, {
        code: "source_capacity",
        stage: "resolve",
        message: "Source binding capacity exhausted.",
      });
    if (this.active >= this.limits.downloads)
      throw new TaskProtocolError(429, {
        code: "preparation_capacity",
        stage: "resolve",
        message: "Artifact preparation capacity exhausted.",
      });
    this.active++;
    try {
      const bounded = AbortSignal.any([
        signal,
        this.controller.signal,
        AbortSignal.timeout(this.limits.preparationMs),
      ]);
      const bytes = await this.download(reference.url, {
        signal: bounded,
        allowedOrigins: this.allowedOrigins,
      }).catch(() => {
        throw new TaskProtocolError(502, {
          code: "download_failed",
          stage: "download",
          message: "Artifact download failed.",
        });
      });
      bounded.throwIfAborted();
      let inspected: ContractArtifact;
      try {
        inspected = inspectContractFiles(await unpackArtifactFiles(bytes, bounded));
      } catch {
        throw new TaskProtocolError(422, {
          code: "invalid_artifact",
          stage: "validate",
          message: "Artifact archive or contract is invalid.",
        });
      }
      if (
        ("entry" in inspected.manifest ? "checker" : "objective") !== reference.kind ||
        (reference.digest && reference.digest !== inspected.digest)
      )
        throw new TaskProtocolError(422, {
          code: "digest_mismatch",
          stage: "verify",
          message: "Artifact kind or exact digest mismatch.",
        });
      if (!this.entries.has(inspected.digest) && this.entries.size >= this.limits.artifacts)
        throw new TaskProtocolError(429, {
          code: "artifact_capacity",
          stage: "resolve",
          message: "Artifact cache capacity exhausted.",
        });
      const source = new URL(reference.url);
      const artifact = {
        ...inspected,
        metadata: {
          digest: inspected.digest,
          source: source.href,
          checkedAt: new Date().toISOString(),
          transportDigest: transportDigest(bytes),
          manifest: inspected.manifest,
        },
      };
      this.entries.set(artifact.digest, artifact);
      const grants = this.grants.get(key) ?? new Map();
      grants.set(artifact.digest, artifact.metadata);
      this.grants.set(key, grants);
      return cloneArtifact(artifact);
    } finally {
      this.active--;
    }
  }
  async artifact(digest: string, scope: string) {
    const granted = [...this.grants]
      .find(([key, grants]) => key.startsWith(`${scope}\0`) && grants.has(digest))?.[1]
      .get(digest);
    if (!granted)
      throw new TaskProtocolError(403, {
        code: "artifact_denied",
        stage: "resolve",
        message: "No authorized source binding for artifact.",
      });
    const artifact = this.entries.get(digest);
    if (!artifact)
      throw new TaskProtocolError(404, {
        code: "artifact_unavailable",
        stage: "resolve",
        message: "Artifact is not cached.",
      });
    return cloneArtifact({ ...artifact, metadata: granted });
  }
  close() {
    this.controller.abort();
  }
}
/** A derived worker capsule has its own legacy execution revision, never the tree digest. */
export class CheckerMaterializer {
  private readonly capsules = new Map<string, Promise<{ directory: string; revision: string }>>();
  private readonly owned = new Set<string>();
  constructor(readonly directory: string) {}
  async prepare(artifact: ResolvedContract) {
    if (!("entry" in artifact.manifest)) throw new Error("Expected Checker.");
    assertRuntime(artifact.manifest, runtimeEvidence());
    const existing = this.capsules.get(artifact.digest);
    if (existing) {
      const capsule = await existing;
      if ((await readArtifact(capsule.directory)).revision !== capsule.revision)
        throw new Error("Execution capsule changed.");
      return capsule;
    }
    const operation = this.create(artifact as ResolvedContract & { manifest: CheckerManifest });
    this.capsules.set(artifact.digest, operation);
    try {
      return await operation;
    } catch (error) {
      this.capsules.delete(artifact.digest);
      throw error;
    }
  }
  private async create(artifact: ResolvedContract & { manifest: CheckerManifest }) {
    const verified = inspectContractFiles(artifact.files);
    if (verified.digest !== artifact.digest) throw new Error("Checker content changed.");
    const bytes = artifact.files.get(artifact.manifest.entry);
    if (!bytes) throw new Error("Missing Checker entry.");
    await ensurePrivateDirectory(this.directory);
    const directory = join(this.directory, randomUUID());
    await mkdir(directory, { mode: 0o700 });
    this.owned.add(directory);
    await writeFile(join(directory, "worker.cjs"), bytes, { flag: "wx", mode: 0o400 });
    const capsule = await readArtifact(directory);
    // Verify the tree reader before returning paths to the existing kernel.
    if ((await readArtifactFiles(directory)).size !== 1)
      throw new Error("Unexpected execution capsule.");
    return { directory, revision: capsule.revision };
  }
  async close() {
    await Promise.allSettled(this.capsules.values());
    for (const directory of this.owned) await rm(directory, { recursive: true, force: true });
    this.owned.clear();
  }
}
