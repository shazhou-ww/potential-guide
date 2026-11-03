import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRuntime,
  parseArtifactYaml,
  readArtifactFiles,
  safePath,
} from "@potential-guide/check-artifacts/files";
import {
  createIpfsClient,
  type IpfsImportClient,
  importContent,
  publishContent,
} from "@potential-guide/ipfs-content";
import {
  type JsonObject,
  resolveBundleSchemas,
  validateTaskBundle,
} from "@potential-guide/task-protocol";
import { build } from "esbuild";

export interface BuildTaskBundleOptions {
  declaration: string;
  entry: string;
  exportName?: string;
  outDirectory: string;
  /** Exact author-controlled shared Schema bytes, locked by SHA-256 (not Bundle tree Digest). */
  schemas?: readonly { path: string; digest: string }[];
  resources?: Readonly<Record<string, string>>;
}
export async function buildTaskBundle(options: BuildTaskBundleOptions) {
  const manifestBytes = await readFile(options.declaration);
  const declaration = validateTaskBundle(parseArtifactYaml(manifestBytes));
  assertRuntime(declaration);
  const files = new Map<string, Buffer>([["task.yaml", manifestBytes]]);
  const schemas: JsonObject[] = [];
  for (const [index, locked] of (options.schemas ?? []).entries()) {
    const bytes = await readFile(locked.path);
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== locked.digest)
      throw new Error("Shared Schema lock mismatch; update the lock explicitly.");
    const schema = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as JsonObject;
    schemas.push(schema);
    files.set(`schemas/${index}.json`, bytes);
  }
  const resolved = resolveBundleSchemas(declaration, schemas);
  for (const [path, source] of Object.entries(options.resources ?? {})) {
    if (!safePath(path) || !path.startsWith("resources/"))
      throw new Error("Task resources require safe resources/ paths.");
    files.set(path, await readFile(source));
  }
  const exportName = options.exportName ?? "default";
  if (!/^(?:default|[A-Za-z_$][A-Za-z0-9_$]*)$/.test(exportName))
    throw new Error("Invalid callback export name.");
  const runtime = fileURLToPath(new URL("./index.js", import.meta.url));
  const bundle = await build({
    stdin: {
      contents: `import {runTask} from ${JSON.stringify(runtime)};
runTask(async (input, context) => {
  const {${exportName}: callback} = await import(${JSON.stringify(resolve(options.entry))});
  if (typeof callback !== "function") throw new Error("Task callback export is not a function.");
  return await callback(input, context);
},${JSON.stringify(resolved)});`,
      resolveDir: dirname(resolve(options.entry)),
      sourcefile: "task-entry.js",
      loader: "js",
    },
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
    logOverride: {
      "unsupported-dynamic-import": "error",
      "unsupported-require-call": "error",
      "empty-import-meta": "error",
    },
  });
  if (
    bundle.outputFiles.length !== 1 ||
    Object.values(bundle.metafile.outputs).some((output) =>
      output.imports.some((dependency) => dependency.external && !isBuiltin(dependency.path)),
    )
  )
    throw new Error("Task Worker must contain all non-builtin code dependencies.");
  files.set("worker.cjs", Buffer.from(bundle.outputFiles[0]!.contents));
  const cid = await importContent(files, async () => {});
  const output = resolve(options.outDirectory);
  const staging = `${output}.${randomUUID()}`;
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    for (const [path, bytes] of files) {
      const target = join(staging, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    }
    if ((await importContent(await readArtifactFiles(staging), async () => {})) !== cid)
      throw new Error("Task Bundle changed during build.");
    await mkdir(output);
    try {
      for (const name of await readdir(staging))
        await rename(join(staging, name), join(output, name));
    } catch (error) {
      await rm(output, { recursive: true, force: true });
      throw error;
    }
    return { directory: output, cid, declaration };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
export async function importTaskBundle(directory: string, ipfsClient: IpfsImportClient) {
  const files = await readArtifactFiles(directory);
  const declaration = validateTaskBundle(
    parseArtifactYaml(files.get("task.yaml") ?? Buffer.alloc(0)),
  );
  if (
    !files.has("worker.cjs") ||
    [...files.keys()].some(
      (path) =>
        !["task.yaml", "worker.cjs"].includes(path) &&
        !path.startsWith("schemas/") &&
        !path.startsWith("resources/"),
    )
  )
    throw new Error("Invalid Task Bundle tree.");
  resolveBundleSchemas(
    declaration,
    [...files]
      .filter(([path]) => path.startsWith("schemas/"))
      .map(
        ([, bytes]) =>
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as JsonObject,
      ),
  );
  const cid = await publishContent(files, ipfsClient);
  return { cid };
}
export { createIpfsClient };
