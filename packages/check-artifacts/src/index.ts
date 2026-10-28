import { chmod, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Ajv } from "ajv";
export * from "./contracts.js";
export * from "./contract-result.js";
export * from "./mapping.js";
export { unpackArtifactFiles } from "./archive.js";
import {
  createPrivateDirectory,
  createPrivateFile,
  ensurePrivateDirectory,
  readArtifact,
} from "@potential-guide/check-runtime-files";
import { transportDigest, unpackCheckArchive } from "./archive.js";
import {
  artifactDigestPrefix,
  artifactLimits,
  inspectCheckArtifact,
  type CheckManifest,
} from "./manifest.js";
export { readArtifactFiles, safePath } from "./manifest.js";
export { parseManifest as parseCheckManifest } from "./manifest.js";

export {
  artifactDigestPrefix,
  artifactLimits,
  inspectCheckArtifact,
  type CheckManifest,
} from "./manifest.js";
export { transportDigest } from "./archive.js";
export function validateCheckValue(
  manifest: CheckManifest,
  kind: "subject" | "result",
  value: unknown,
): boolean {
  return (
    new Ajv({ strict: false, validateFormats: false }).compile(
      manifest[kind === "subject" ? "subjectSchema" : "resultSchema"],
    )(value) === true
  );
}
export type CheckArtifactSource =
  | { kind: "directory"; directory: string; digest: string }
  | { kind: "archive"; bytes: Buffer; digest: string }
  | { kind: "https"; url: string; digest: string; transportDigest: string };
export interface PrepareCheckOptions {
  cacheDirectory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface PreparedCheckArtifact {
  digest: string;
  manifest: CheckManifest;
  artifactDirectory: string;
  directory: string;
  revision: string;
}
export interface FetchCheckOptions {
  signal: AbortSignal;
  allowedOrigins: readonly string[];
  maxRedirects?: number;
}
export async function fetchCheckArchive(source: string, options: FetchCheckOptions) {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("Check source requires a valid HTTPS URL.");
  }
  const maximum = options.maxRedirects ?? 4;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 8)
    throw new Error("Invalid redirect bound.");
  for (let hop = 0; ; hop++) {
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !options.allowedOrigins.includes(url.origin)
    )
      throw new Error("Check source is not authorized by HTTPS origin policy.");
    const response = await fetch(url, {
      signal: options.signal,
      redirect: "manual",
      credentials: "omit",
      headers: { "accept-encoding": "identity" },
    }).catch(() => {
      throw new Error("Check archive HTTPS request failed.");
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || hop >= maximum) throw new Error("Check redirect limit or location invalid.");
      try {
        url = new URL(location, url);
      } catch {
        throw new Error("Check redirect location invalid.");
      }
      continue;
    }
    try {
      if (!response.ok || !response.body) throw new Error("Download unavailable.");
      const length = response.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > artifactLimits.archiveBytes))
        throw new Error("Download too large.");
      const encoding = response.headers.get("content-encoding");
      if (encoding && encoding !== "identity") throw new Error("Unsupported encoding.");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        options.signal.throwIfAborted();
        size += chunk.length;
        if (size > artifactLimits.archiveBytes) throw new Error("Download too large.");
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch {
      await response.body?.cancel().catch(() => {});
      throw new Error("Check archive download failed.");
    }
  }
}
export async function inspectCheckArchive(bytes: Buffer, signal?: AbortSignal) {
  return unpackCheckArchive(bytes, signal);
}
async function download(
  source: Extract<CheckArtifactSource, { kind: "https" }>,
  signal: AbortSignal,
) {
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    throw new Error("Check source requires a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("Check source requires HTTPS without embedded credentials or fragments.");
  if (!/^sha256:[a-f0-9]{64}$/.test(source.transportDigest))
    throw new Error("An exact SHA-256 transport digest is required.");
  // No automatic redirects, inherited registry credentials, cookies or lifecycle scripts.
  const response = await fetch(url, { signal, redirect: "error", credentials: "omit" }).catch(
    () => {
      throw new Error("Check archive HTTPS request failed.");
    },
  );
  try {
    if (!response.ok || !response.body) throw new Error("Check archive download failed.");
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > artifactLimits.archiveBytes))
      throw new Error("Check archive exceeds download bounds.");
    if (
      response.headers.get("content-encoding") &&
      response.headers.get("content-encoding") !== "identity"
    )
      throw new Error("Check archive requires identity HTTP content encoding.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > artifactLimits.archiveBytes)
        throw new Error("Check archive exceeds download bounds.");
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (transportDigest(bytes) !== source.transportDigest)
      throw new Error("Check archive transport digest mismatch.");
    return bytes;
  } catch {
    await response.body?.cancel().catch(() => {});
    // Do not leak signed URLs, query strings, credentials or remote diagnostics.
    throw new Error("Check archive download or transport verification failed.");
  }
}
async function materialize(
  root: string,
  files: ReadonlyMap<string, Buffer>,
  manifest: CheckManifest,
  execution: boolean,
) {
  await ensurePrivateDirectory(root).catch((cause) => {
    throw new Error("Cannot secure Check materialization directory.", { cause });
  });
  for (const [name, bytes] of files) {
    if (execution && name !== "worker.cjs" && !name.startsWith("resources/")) continue;
    const path = join(root, ...name.split("/"));
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const mode = manifest.resources.some((item) => item.path === name && item.executable)
      ? 0o500
      : 0o400;
    if (name === "check.json") {
      // Discovery's private writer owns a mutex inode. Keep it outside the delivered tree.
      const metadata = await createPrivateDirectory(dirname(root), "manifest-");
      try {
        await createPrivateFile(metadata, name, bytes.toString("utf8"));
        await rename(join(metadata, name), path);
      } finally {
        await rm(metadata, { recursive: true, force: true });
      }
    } else await writeFile(path, bytes, { flag: "wx", mode });
    await chmod(path, mode);
  }
}
async function verifyCached(target: string, digest: string): Promise<PreparedCheckArtifact> {
  await ensurePrivateDirectory(target).catch((cause) => {
    throw new Error("Cannot verify Check capsule privacy.", { cause });
  });
  if ((await readdir(target)).sort().join(",") !== "artifact,execution")
    throw new Error("Check cache has unexpected content.");
  const artifactDirectory = join(target, "artifact");
  const directory = join(target, "execution");
  await ensurePrivateDirectory(artifactDirectory).catch((cause) => {
    throw new Error("Cannot verify Check artifact privacy.", { cause });
  });
  await ensurePrivateDirectory(directory).catch((cause) => {
    throw new Error("Cannot verify Check execution privacy.", { cause });
  });
  const artifact = await inspectCheckArtifact(artifactDirectory);
  if (artifact.digest !== digest) throw new Error("Check cache content digest mismatch.");
  const execution = await readArtifact(directory);
  const expected = [...artifact.files].filter(
    ([name]) => name === "worker.cjs" || name.startsWith("resources/"),
  );
  if (
    execution.files.size !== expected.length ||
    expected.some(([name, bytes]) => !execution.files.get(name)?.equals(bytes))
  )
    throw new Error("Check cache execution content mismatch.");
  // The Host's platform-specific revision includes physical executable bits.
  if (
    process.platform !== "win32" &&
    expected.some(
      ([name]) =>
        execution.executables.has(name) !==
        artifact.manifest.resources.some((item) => item.path === name && item.executable),
    )
  )
    throw new Error("Check cache execution permissions mismatch.");
  return {
    digest,
    manifest: artifact.manifest,
    artifactDirectory,
    directory,
    revision: execution.revision,
  };
}
/** Explicit preparation only. A cache hit verifies all bytes and does not resolve a source again. */
export async function prepareCheckArtifact(
  source: CheckArtifactSource,
  options: PrepareCheckOptions,
): Promise<PreparedCheckArtifact> {
  if (!new RegExp(`^${artifactDigestPrefix}[a-f0-9]{64}$`).test(source.digest))
    throw new Error("An exact Check artifact digest is required.");
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new Error("Invalid Check preparation timeout.");
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  const cache = resolve(options.cacheDirectory);
  await ensurePrivateDirectory(cache);
  const target = join(cache, source.digest.slice(artifactDigestPrefix.length));
  try {
    await lstat(target);
    const prepared = await verifyCached(target, source.digest);
    signal.throwIfAborted();
    return prepared;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Only absence of the whole capsule is a miss; partial capsules fail closed.
    try {
      await lstat(target);
      throw new Error("Check cache is incomplete.");
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw missing;
    }
  }
  const staging = await createPrivateDirectory(cache, "prepare-");
  try {
    const artifact =
      source.kind === "directory"
        ? await inspectCheckArtifact(resolve(source.directory))
        : await unpackCheckArchive(
            source.kind === "archive" ? source.bytes : await download(source, signal),
            signal,
          );
    signal.throwIfAborted();
    if (artifact.digest !== source.digest)
      throw new Error("Check artifact content digest mismatch.");
    await materialize(join(staging, "artifact"), artifact.files, artifact.manifest, false);
    await materialize(join(staging, "execution"), artifact.files, artifact.manifest, true);
    await verifyCached(staging, source.digest);
    signal.throwIfAborted();
    const lock = `${target}.lock`;
    for (;;) {
      signal.throwIfAborted();
      try {
        await mkdir(lock, { mode: 0o700 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await delay(25, undefined, { signal });
      }
    }
    try {
      let exists = true;
      try {
        await lstat(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        exists = false;
      }
      if (!exists) await rename(staging, target);
      const prepared = await verifyCached(target, source.digest);
      signal.throwIfAborted();
      return prepared;
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
