import {
  fetchCheckArchive,
  unpackArtifactFiles,
  type FetchCheckOptions,
} from "@potential-guide/check-artifacts";
import {
  type ArtifactReference,
  type ContractArtifact,
  inspectContractFiles,
  validateArtifactReference,
} from "@potential-guide/check-artifacts/contracts";
import { positive, TaskError } from "@potential-guide/task-protocol";

export interface ArtifactSource {
  authorize(reference: ArtifactReference, scope: string): void | Promise<void>;
  resolve(
    reference: ArtifactReference,
    scope: string,
    signal: AbortSignal,
  ): Promise<ContractArtifact>;
}
export interface ArtifactSourceOptions {
  allowedOrigins: readonly string[];
  authorize(reference: ArtifactReference, scope: string): void | Promise<void>;
  maxArtifacts?: number;
  maxDownloads?: number;
  timeoutMs?: number;
  download?: (source: string, options: FetchCheckOptions) => Promise<Buffer>;
}

/** Explicit preparation IO. Cache hits never replace source/scope authorization. */
export function createArtifactSource(
  options: ArtifactSourceOptions,
): ArtifactSource & { close(): Promise<void> } {
  const maximum = positive(options.maxArtifacts ?? 32, "maxArtifacts");
  const downloads = positive(options.maxDownloads ?? 4, "maxDownloads");
  const timeout = positive(options.timeoutMs ?? 30_000, "timeoutMs");
  const controller = new AbortController();
  const cache = new Map<string, ContractArtifact>();
  const active = new Set<Promise<ContractArtifact>>();
  const authorize = async (reference: ArtifactReference, scope: string) => {
    validateArtifactReference(reference);
    if (!options.allowedOrigins.includes(new URL(reference.url).origin))
      throw new TaskError("artifact_source_denied", "Artifact origin is not authorized.");
    await options.authorize(reference, scope);
    controller.signal.throwIfAborted();
  };
  const clone = (value: ContractArtifact) => ({
    ...structuredClone(value),
    files: new Map([...value.files].map(([path, bytes]) => [path, Buffer.from(bytes)])),
  });
  return {
    authorize,
    async resolve(reference, scope, signal) {
      await authorize(reference, scope);
      signal.throwIfAborted();
      const key = `${scope}\0${reference.kind}\0${reference.url}\0${reference.digest ?? ""}`;
      const cached = reference.digest ? cache.get(key) : undefined;
      if (cached) return clone(cached);
      if (active.size >= downloads)
        throw new TaskError("artifact_capacity", "Artifact preparation capacity exhausted.");
      const operation = (async () => {
        const bounded = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(timeout)]);
        let bytes: Buffer;
        try {
          bytes = await (options.download ?? fetchCheckArchive)(reference.url, {
            signal: bounded,
            allowedOrigins: options.allowedOrigins,
          });
        } catch {
          throw new TaskError("artifact_download_failed", "Artifact download failed.");
        }
        bounded.throwIfAborted();
        let artifact: ContractArtifact;
        try {
          artifact = inspectContractFiles(await unpackArtifactFiles(bytes, bounded));
        } catch {
          throw new TaskError("artifact_invalid", "Artifact file set or contract is invalid.");
        }
        if (
          ("entry" in artifact.manifest ? "checker" : "objective") !== reference.kind ||
          (reference.digest && artifact.digest !== reference.digest)
        )
          throw new TaskError(
            "artifact_digest_mismatch",
            "Selected artifact kind or exact digest differs.",
          );
        bounded.throwIfAborted();
        const exactKey = `${scope}\0${reference.kind}\0${reference.url}\0${artifact.digest}`;
        if (!cache.has(exactKey) && cache.size >= maximum)
          throw new TaskError("artifact_capacity", "Artifact cache capacity exhausted.");
        cache.set(exactKey, artifact);
        return clone(artifact);
      })();
      active.add(operation);
      try {
        return await operation;
      } finally {
        active.delete(operation);
      }
    },
    async close() {
      controller.abort();
      await Promise.allSettled([...active]);
      cache.clear();
    },
  };
}
