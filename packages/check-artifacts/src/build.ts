import { isBuiltin } from "node:module";
export * from "./contract-build.js";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import * as tar from "tar";
import { transportDigest, unpackCheckArchive } from "./archive.js";
import {
  artifactLimits,
  declaredFiles,
  inspectCheckArtifact,
  parseManifest,
  type CheckManifest,
} from "./manifest.js";

export interface BuildCheckOptions {
  entry: string;
  manifest: CheckManifest;
  /** Exactly the declared resources and References, mapped to author-owned source files. */
  files: Readonly<Record<string, string>>;
  outDirectory: string;
}
/** Author-triggered bundle. Never called by preparation or the Host. Output must not exist. */
export async function buildCheckArtifact(options: BuildCheckOptions) {
  const manifest = parseManifest(Buffer.from(JSON.stringify(options.manifest)));
  const declared = declaredFiles(manifest);
  declared.delete("check.json");
  declared.delete("worker.cjs");
  if (
    declared.size !== Object.keys(options.files).length ||
    [...declared].some((name) => !Object.hasOwn(options.files, name))
  )
    throw new Error("Build files must exactly match declared resources and References.");
  const output = resolve(options.outDirectory);
  await mkdir(dirname(output), { recursive: true });
  const staging = `${output}.${randomUUID()}`;
  await mkdir(staging, { mode: 0o700 });
  try {
    const bundle = await build({
      entryPoints: [resolve(options.entry)],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      write: false,
      metafile: true,
      packages: "bundle",
      legalComments: "eof",
      define: { "import.meta.url": "__artifactURL" },
      banner: { js: 'const __artifactURL = require("node:url").pathToFileURL(__filename).href;' },
      logLevel: "silent",
    });
    if (
      Object.values(bundle.metafile.outputs).some((item) =>
        item.imports.some((dependency) => dependency.external && !isBuiltin(dependency.path)),
      )
    )
      throw new Error("Check worker has an unbundled code dependency.");
    await writeFile(join(staging, "check.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
    const bytes = bundle.outputFiles[0]?.contents;
    if (!bytes) throw new Error("Check build produced no worker.");
    await writeFile(join(staging, "worker.cjs"), bytes, { flag: "wx" });
    for (const [name, source] of Object.entries(options.files)) {
      const target = join(staging, ...name.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(source), { flag: "wx" });
      await chmod(
        target,
        manifest.resources.some((item) => item.path === name && item.executable) ? 0o700 : 0o600,
      );
    }
    const result = await inspectCheckArtifact(staging);
    // mkdir is an exclusive reservation: never replace an existing author output.
    await mkdir(output);
    try {
      for (const name of await readdir(staging))
        await rename(join(staging, name), join(output, name));
    } catch (error) {
      await rm(output, { recursive: true, force: true });
      throw error;
    }
    return { directory: output, digest: result.digest, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
/** Packs the already-built, verified tree using node-tar; no install or build hooks. */
export async function packCheckArtifact(directory: string, archive: string) {
  const artifact = await inspectCheckArtifact(resolve(directory));
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of tar.c(
    {
      cwd: resolve(directory),
      gzip: true,
      portable: true,
      noMtime: true,
      noDirRecurse: true,
    },
    [...artifact.files.keys()].sort(),
  )) {
    size += chunk.length;
    if (size > artifactLimits.archiveBytes) throw new Error("Check archive exceeds bounds.");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  const verified = await unpackCheckArchive(bytes);
  if (verified.digest !== artifact.digest) throw new Error("Check changed while packing.");
  await mkdir(dirname(resolve(archive)), { recursive: true });
  await writeFile(archive, bytes, { flag: "wx" });
  return {
    digest: artifact.digest,
    transportDigest: transportDigest(bytes),
    archive: resolve(archive),
  };
}
