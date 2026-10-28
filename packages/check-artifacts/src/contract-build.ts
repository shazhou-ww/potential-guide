import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import * as tar from "tar";
import { transportDigest, unpackArtifactFiles } from "./archive.js";
import { inspectContractFiles, parseCheckerManifest } from "./contracts.js";
import { artifactLimits, readArtifactFiles } from "./manifest.js";

/** Explicit author build only: consumer preparation never runs code or package hooks. */
export async function buildCheckerArtifact(options: {
  manifest: Buffer;
  entry: string;
  references: Readonly<Record<string, string>>;
  outDirectory: string;
}) {
  const manifest = parseCheckerManifest(options.manifest);
  const bundle = await build({
    entryPoints: [resolve(options.entry)],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    write: false,
    metafile: true,
    packages: "bundle",
    logLevel: "silent",
    define: { "import.meta.url": "__artifactURL" },
    banner: { js: 'const __artifactURL = require("node:url").pathToFileURL(__filename).href;' },
  });
  if (
    Object.values(bundle.metafile.outputs).some((output) =>
      output.imports.some((dependency) => dependency.external && !isBuiltin(dependency.path)),
    )
  )
    throw new Error("Unbundled Checker dependency.");
  const entry = bundle.outputFiles[0]?.contents;
  if (!entry || bundle.outputFiles.length !== 1)
    throw new Error("Checker must have one self-contained entry.");
  const files = new Map<string, Buffer>([
    ["checker.yaml", options.manifest],
    [manifest.entry, Buffer.from(entry)],
  ]);
  for (const [path, source] of Object.entries(options.references)) {
    if (!path.startsWith("references/")) throw new Error("Only Reference pages may be copied.");
    files.set(path, await readFile(source));
  }
  return writeContractArtifact(files, options.outDirectory);
}
/** Also supports Objective authoring without a second serialized manifest truth. */
export async function writeContractArtifact(files: ReadonlyMap<string, Buffer>, directory: string) {
  const inspected = inspectContractFiles(files);
  const output = resolve(directory);
  await mkdir(dirname(output), { recursive: true });
  const staging = `${output}.${randomUUID()}`;
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const [path, bytes] of files) {
      const target = join(staging, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    }
    await mkdir(output);
    try {
      for (const path of await readdir(staging))
        await rename(join(staging, path), join(output, path));
    } catch (error) {
      await rm(output, { recursive: true, force: true });
      throw error;
    }
    return { directory: output, digest: inspected.digest, manifest: inspected.manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
export async function packContractArtifact(directory: string, archive: string) {
  const inspected = inspectContractFiles(await readArtifactFiles(resolve(directory)));
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of tar.c(
    { cwd: resolve(directory), gzip: true, portable: true, noMtime: true, noDirRecurse: true },
    [...inspected.files.keys()].sort(),
  )) {
    size += chunk.length;
    if (size > artifactLimits.archiveBytes) throw new Error("Archive exceeds bounds.");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (inspectContractFiles(await unpackArtifactFiles(bytes)).digest !== inspected.digest)
    throw new Error("Artifact changed during packing.");
  await mkdir(dirname(resolve(archive)), { recursive: true });
  await writeFile(archive, bytes, { flag: "wx" });
  return {
    digest: inspected.digest,
    transportDigest: transportDigest(bytes),
    archive: resolve(archive),
  };
}
