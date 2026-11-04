import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CliError } from "@potential-guide/cli-core";
import { taskBuildSchemaUri } from "./authoring.js";

const typebox = "@sinclair/typebox";
const typeboxVersion = "0.34.52";
const sdk = "@potential-guide/task-sdk";
const sdkVersion = "0.1.0-rc.0";
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const templates = {
  ".gitignore": "node_modules/\ndist/\ndist.car\n",
  "task.build.yaml": `$schema: ${taskBuildSchemaUri}
name: Echo
runtime:
  minVersion: "22.13.0"
source:
  entry: src/main.ts
  contract: src/contract.ts
  mode: explicit
outDirectory: dist
`,
  "src/contract.ts": `import { Type } from "@sinclair/typebox";

export default {
  input: Type.Object({ text: Type.String() }),
  result: Type.Object({ text: Type.String() }),
  message: Type.Never(),
};
`,
  "src/main.ts": `import type { Static } from "@sinclair/typebox";
import { runTask } from "@potential-guide/task-sdk";
import type contract from "./contract.js";

runTask(async function echo(
  input: Static<typeof contract.input>,
): Promise<Static<typeof contract.result>> {
  return { text: input.text };
});
`,
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function inspect(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}
async function directory(path: string) {
  const info = await inspect(path);
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new CliError(`Task initialization needs a regular directory, not a link: ${path}`);
}
async function nearestPackage(root: string) {
  for (let current = root; ; current = dirname(current)) {
    await directory(current);
    const file = join(current, "package.json");
    const info = await inspect(file);
    if (info) {
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
        throw new CliError(`package.json must be a regular, unlinked file: ${file}`);
      const source = await readFile(file, "utf8");
      let manifest: unknown;
      try {
        manifest = JSON.parse(source);
      } catch (error) {
        throw new CliError(`Cannot parse ${file}: ${String(error)}`);
      }
      if (!object(manifest)) throw new CliError(`package.json must contain an object: ${file}`);
      return { file, source, manifest, mode: info.mode & 0o777 };
    }
    if (dirname(current) === current) return undefined;
  }
}
async function replaceManifest(file: string, before: string, after: string, mode: number) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, after, { flag: "wx", mode });
    await chmod(temporary, mode);
    if ((await readFile(file, "utf8")) !== before)
      throw new CliError(`package.json changed during initialization; retry: ${file}`);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function initTaskBundle(target: string) {
  const root = resolve(target);
  const existing = await nearestPackage(root);
  const packageFile = existing?.file ?? join(root, "package.json");
  const manifest: Record<string, unknown> = existing?.manifest ?? {
    name: "task-bundle",
    private: true,
    type: "module",
    engines: { node: ">=22.13.0" },
  };
  const missing = new Map([
    [typebox, typeboxVersion],
    [sdk, sdkVersion],
  ]);
  for (const field of dependencyFields) {
    const dependencies = manifest[field];
    if (dependencies === undefined) continue;
    if (
      !object(dependencies) ||
      Object.values(dependencies).some((value) => typeof value !== "string" || !value.trim())
    )
      throw new CliError(
        `Invalid ${field} in ${packageFile}; expected dependency version strings.`,
      );
    for (const name of missing.keys()) if (Object.hasOwn(dependencies, name)) missing.delete(name);
  }
  const dependencyAdded = missing.size > 0;
  if (dependencyAdded) {
    const dependencies = manifest.dependencies;
    manifest.dependencies = {
      ...(object(dependencies) ? dependencies : {}),
      ...Object.fromEntries(missing),
    };
  }
  const scripts = manifest.scripts;
  if (
    scripts !== undefined &&
    (!object(scripts) || Object.values(scripts).some((value) => typeof value !== "string"))
  )
    throw new CliError(`Invalid scripts in ${packageFile}; expected command strings.`);
  const ownsPackage = dirname(packageFile) === root;
  const buildScriptAdded = ownsPackage && (!object(scripts) || !Object.hasOwn(scripts, "build"));
  const cleanScriptAdded = ownsPackage && (!object(scripts) || !Object.hasOwn(scripts, "clean"));
  if (buildScriptAdded || cleanScriptAdded) {
    manifest.scripts = {
      ...(object(scripts) ? scripts : {}),
      ...(buildScriptAdded ? { build: "pguide task-bundle build task.build.yaml" } : {}),
      ...(cleanScriptAdded
        ? {
            clean: `node -e "for (const path of ['dist', 'dist.car']) require('node:fs').rmSync(path, { recursive: true, force: true })"`,
          }
        : {}),
    };
  }
  await directory(join(root, "src"));
  const ignoreFile = join(root, ".gitignore");
  const ignoreInfo = await inspect(ignoreFile);
  if (ignoreInfo && (!ignoreInfo.isFile() || ignoreInfo.isSymbolicLink() || ignoreInfo.nlink !== 1))
    throw new CliError(`.gitignore must be a regular, unlinked file: ${ignoreFile}`);
  const files = Object.entries(templates)
    .filter(([name]) => name !== ".gitignore" || !ignoreInfo)
    .map(([name, content]) => ({
      path: join(root, name),
      content,
    }));
  for (const { path } of files)
    if (await inspect(path))
      throw new CliError(`Refusing to overwrite ${path}; use init <another-directory>.`);

  const created: string[] = [];
  async function create(path: string, content: string) {
    const handle = await open(path, "wx");
    created.push(path);
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
  }
  try {
    await mkdir(join(root, "src"), { recursive: true });
    for (const { path, content } of files) await create(path, content);
    const content = `${JSON.stringify(manifest, null, 2)}\n`;
    if (!existing) await create(packageFile, content);
    else if (dependencyAdded || buildScriptAdded || cleanScriptAdded)
      await replaceManifest(packageFile, existing.source, content, existing.mode);
  } catch (error) {
    const failures: unknown[] = [error];
    for (const path of created.reverse()) {
      try {
        await rm(path, { force: true });
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(failures, "Task initialization failed; some created files remain.");
    throw error;
  }
  return {
    directory: root,
    buildFile: join(root, "task.build.yaml"),
    packageDirectory: dirname(packageFile),
    packageFile,
    packageCreated: !existing,
    dependencyAdded,
    buildScriptAdded,
    cleanScriptAdded,
    files: [
      ...files.map(({ path }) => path),
      ...(!existing || dependencyAdded || buildScriptAdded || cleanScriptAdded
        ? [packageFile]
        : []),
    ],
    nextSteps: [
      "Run your package manager's install command in packageDirectory.",
      buildScriptAdded
        ? "Run your package manager's run build command in packageDirectory."
        : "Run pguide task-bundle build task.build.yaml in directory; package scripts are unchanged.",
      cleanScriptAdded
        ? "Run your package manager's run clean command in packageDirectory to remove this task's dist."
        : "No clean script added; package scripts are unchanged.",
    ],
  };
}
