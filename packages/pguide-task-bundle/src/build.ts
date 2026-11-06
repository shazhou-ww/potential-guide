import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { computeContentCid, encodeContentCar } from "./car.js";
import {
  type JsonObject,
  isTaskBundlePath as safePath,
  parseTaskBundleYaml,
  resolveBundleSchemas,
  validateTaskBundle,
  normalizeTaskText,
  selectTaskBinary,
} from "@potential-guide/task-protocol";
import { build } from "esbuild";
import { stringify } from "yaml";
import { checkTaskArtifact, inspectTaskArtifact } from "./artifact.js";
import { readTaskArtifactFiles } from "./local-files.js";
import { assertTaskRuntime } from "./runtime.js";

export interface BuildTaskBundleOptions {
  declaration: string | Record<string, unknown>;
  entry: string;
  exportName?: string;
  /** callback preserves the original lazy exported-callback API. */
  entryMode?: "callback" | "explicit";
  outDirectory: string;
  /** Exact author-controlled shared Schema bytes, locked by SHA-256 (not Bundle tree Digest). */
  schemas?: readonly { path: string; digest: string }[];
  schemaDocuments?: readonly JsonObject[];
  resources?: Readonly<Record<string, string>>;
  /** Portable globs matched against final Bundle-relative paths, not source paths. */
  binary?: readonly string[];
  owner?: string;
}
async function regularFile(path: string): Promise<string> {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || (await realpath(absolute)) !== absolute)
    throw new Error("Task build input must be a canonical regular file, without links.");
  return absolute;
}
export async function compileTaskBundle(options: BuildTaskBundleOptions) {
  if (options.entryMode !== undefined && !["callback", "explicit"].includes(options.entryMode))
    throw new Error("Invalid Task entry mode.");
  await regularFile(options.entry);
  const source =
    typeof options.declaration === "string"
      ? parseTaskBundleYaml(await readFile(await regularFile(options.declaration)))
      : options.declaration;
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw new Error("Task build declaration must be an object.");
  const declaration = validateTaskBundle({
    ...source,
    include: ["task.yaml", "worker.cjs"],
    binary: [],
  });
  assertTaskRuntime(declaration);
  const files = new Map<string, Buffer>();
  const schemas: JsonObject[] = [];
  for (const [index, locked] of (options.schemas ?? []).entries()) {
    const bytes = await readFile(await regularFile(locked.path));
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== locked.digest)
      throw new Error("Shared Schema lock mismatch; update the lock explicitly.");
    const schema = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        normalizeTaskText(bytes, `schemas/${index}.json`),
      ),
    ) as JsonObject;
    schemas.push(schema);
    files.set(`schemas/${index}.json`, bytes);
  }
  for (const schema of options.schemaDocuments ?? []) {
    files.set(
      `schemas/${schemas.length}.json`,
      Buffer.from(`${JSON.stringify(schema, null, 2)}\n`),
    );
    schemas.push(schema);
  }
  for (const [path, source] of Object.entries(options.resources ?? {})) {
    if (!safePath(path) || !path.startsWith("resources/"))
      throw new Error("Task resources require safe resources/ paths.");
    files.set(path, await readFile(await regularFile(source)));
  }
  declaration.include = ["task.yaml", "worker.cjs", ...files.keys()].sort();
  declaration.binary = selectTaskBinary(declaration.include, options.binary ?? []);
  const resolved = resolveBundleSchemas(
    declaration,
    schemas,
    [...files.keys()].filter((path) => path.startsWith("schemas/")),
  );
  const exportName = options.exportName ?? "default";
  if (!/^(?:default|[A-Za-z_$][A-Za-z0-9_$]*)$/.test(exportName))
    throw new Error("Invalid callback export name.");
  const runtime = fileURLToPath(import.meta.resolve("@potential-guide/task-sdk"));
  if (options.entryMode === "explicit" && options.exportName !== undefined)
    throw new Error("Explicit Task entries cannot select a callback export.");
  const bindingPath = fileURLToPath(
    new URL("./binding.js", import.meta.resolve("@potential-guide/task-sdk")),
  );
  const bindingPaths = new Set([
    bindingPath,
    bindingPath.replace(/\.js$/, ".ts"),
    resolve(dirname(bindingPath), "..", "dist", "binding.js"),
    resolve(dirname(bindingPath), "..", "src", "binding.ts"),
  ]);
  const bundle = await build({
    ...(options.entryMode === "explicit"
      ? { entryPoints: [resolve(options.entry)] }
      : {
          stdin: {
            contents: `import {runTask} from ${JSON.stringify(runtime)};
runTask(async (input, context) => {
  const {${exportName}: callback} = await import(${JSON.stringify(resolve(options.entry))});
  if (typeof callback !== "function") throw new Error("Task callback export is not a function.");
  return await callback(input, context);
});`,
            resolveDir: dirname(resolve(options.entry)),
            sourcefile: "task-entry.js",
            loader: "js",
          },
        }),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    write: false,
    metafile: true,
    minify: true,
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
    plugins: [
      {
        name: "task-build-locked-contract",
        setup(plugin) {
          plugin.onLoad({ filter: /[\\/]binding\.[jt]s$/ }, async (args) => {
            if (!bindingPaths.has(args.path)) {
              if (!["src", "dist"].includes(basename(dirname(args.path)))) return undefined;
              const manifest = await readFile(
                resolve(dirname(args.path), "..", "package.json"),
                "utf8",
              ).catch((error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
                throw error;
              });
              if (manifest === undefined) return undefined;
              const candidate: unknown = JSON.parse(manifest);
              if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
                throw new Error("Task binding package.json must contain an object.");
              if (!("name" in candidate) || candidate.name !== "@potential-guide/task-sdk")
                return undefined;
            }
            return {
              contents: `export const binding={declaration:JSON.parse(${JSON.stringify(JSON.stringify(resolved))})};`,
              loader: "js",
            };
          });
        },
      },
    ],
  });
  if (
    bundle.outputFiles.length !== 1 ||
    Object.values(bundle.metafile.outputs).some((output) =>
      output.imports.some((dependency) => dependency.external && !isBuiltin(dependency.path)),
    )
  )
    throw new Error("Task Worker must contain all non-builtin code dependencies.");
  files.set("worker.cjs", Buffer.from(bundle.outputFiles[0]!.contents));
  files.set("task.yaml", Buffer.from(stringify(declaration)));
  for (const [path, bytes] of files)
    if (!declaration.binary.includes(path))
      files.set(path, Buffer.from(normalizeTaskText(bytes, path)));
  const checked = await inspectTaskArtifact(files);
  return { ...checked, contents: files, metafile: bundle.metafile };
}

export async function buildTaskBundle(options: BuildTaskBundleOptions) {
  const compiled = await compileTaskBundle(options);
  const output = resolve(options.outDirectory);
  const carOutput = `${output}.car`;
  const owner = resolve(
    options.owner ??
      (typeof options.declaration === "string" ? options.declaration : options.entry),
  );
  for (const input of [
    owner,
    options.entry,
    ...Object.values(options.resources ?? {}),
    ...(options.schemas ?? []).map(({ path }) => path),
  ]) {
    const distance = relative(output, resolve(input));
    if (
      resolve(input) === carOutput ||
      !distance ||
      (!distance.startsWith(`..${sep}`) && distance !== ".." && !distance.includes(":"))
    )
      throw new Error("Task output must not contain author inputs.");
  }
  let ancestor = dirname(output);
  for (;;) {
    const info = await lstat(ancestor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info) {
      if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(ancestor)) !== ancestor)
        throw new Error("Task output parent must be canonical, without links.");
      break;
    }
    ancestor = dirname(ancestor);
  }
  await mkdir(dirname(output), { recursive: true });
  if ((await realpath(dirname(output))) !== dirname(output))
    throw new Error("Task output parent must be canonical, without links.");
  const marker = `${output}.pguide-task-bundle.json`;
  const ownership = `${JSON.stringify({ version: 1, output, owner })}\n`;
  const lock = await open(`${marker}.lock`, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST")
      throw new Error(
        "Task output is locked. If a build crashed, inspect its output and staging/backup siblings before manually recovering the owned lock.",
      );
    throw error;
  });
  const staging = `${output}.${randomUUID()}`;
  const backup = `${output}.previous.${randomUUID()}`;
  const carStaging = `${staging}.car`;
  const carBackup = `${backup}.car`;
  let previous = false;
  let installed = false;
  let previousCar = false;
  let installedCar = false;
  try {
    const markerInfo = await lstat(marker).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    const owned =
      markerInfo?.isFile() &&
      !markerInfo.isSymbolicLink() &&
      (await readFile(marker, "utf8")) === ownership;
    if (markerInfo && !owned)
      throw new Error("Task output ownership marker does not match this build.");
    const exists = await lstat(output).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (exists) {
      if (!exists.isDirectory() || exists.isSymbolicLink())
        throw new Error("Refusing to replace an unmanaged Task output directory.");
      await checkTaskArtifact(output);
    }
    const carExists = await lstat(carOutput).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (carExists) {
      if (!exists || !carExists.isFile() || carExists.isSymbolicLink() || carExists.nlink !== 1)
        throw new Error("Refusing to replace an unmanaged Task CAR output.");
      const previousArtifact = await checkTaskArtifact(output);
      if ((await checkTaskArtifact(carOutput)).cid !== previousArtifact.cid)
        throw new Error("Task CAR output does not match the previous build.");
    }
    await mkdir(staging, { mode: 0o700 });
    for (const [path, bytes] of compiled.contents) {
      const target = join(staging, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    }
    if ((await computeContentCid(await readTaskArtifactFiles(staging))) !== compiled.cid)
      throw new Error("Task Bundle changed during build.");
    const archive = await encodeContentCar(compiled.contents);
    if (archive.cid !== compiled.cid) throw new Error("Task CAR root differs from its file tree.");
    await writeFile(carStaging, archive.bytes, { flag: "wx", mode: 0o600 });
    if (exists) {
      await rename(output, backup);
      previous = true;
    }
    try {
      if (carExists) {
        await rename(carOutput, carBackup);
        previousCar = true;
      }
      await rename(staging, output);
      installed = true;
      await rename(carStaging, carOutput);
      installedCar = true;
    } catch (error) {
      if (installedCar) await rm(carOutput);
      if (previousCar) {
        await rename(carBackup, carOutput);
        previousCar = false;
      }
      if (installed) await rm(output, { recursive: true, force: true });
      if (previous) {
        await rename(backup, output);
        previous = false;
      }
      throw error;
    }
    if (previous) {
      await rm(backup, { recursive: true });
      previous = false;
    }
    if (previousCar) {
      await rm(carBackup);
      previousCar = false;
    }
    if (owned) await rm(marker);
    return {
      directory: output,
      car: carOutput,
      cid: compiled.cid,
      declaration: compiled.declaration,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(carStaging, { force: true });
    await lock.close();
    await rm(`${marker}.lock`);
  }
}
