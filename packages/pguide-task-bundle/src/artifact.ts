import {
  artifactLimits,
  assertRuntime,
  parseArtifactYaml,
  readArtifactFiles,
} from "@potential-guide/artifact-files";
import { importContent } from "@potential-guide/ipfs-content";
import {
  type JsonObject,
  resolveBundleSchemas,
  validateTaskBundle,
  validateTaskBundleFiles,
} from "@potential-guide/task-protocol";

export async function inspectTaskArtifact(files: ReadonlyMap<string, Buffer>) {
  if (
    files.size > artifactLimits.files ||
    [...files.values()].reduce((total, content) => total + content.length, 0) > artifactLimits.bytes
  )
    throw new Error("Task Bundle exceeds artifact capacity.");
  const declaration = validateTaskBundle(
    parseArtifactYaml(files.get("task.yaml") ?? Buffer.alloc(0)),
  );
  validateTaskBundleFiles(declaration, files.keys());
  if (!files.get("worker.cjs")?.length)
    throw new Error("Task Bundle requires a nonempty worker.cjs.");
  new TextDecoder("utf-8", { fatal: true }).decode(files.get("worker.cjs"));
  assertRuntime(declaration);
  const schemas = [...files].filter(([path]) => path.startsWith("schemas/"));
  const resolved = resolveBundleSchemas(
    declaration,
    schemas.map(
      ([, bytes]) =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as JsonObject,
    ),
    schemas.map(([path]) => path),
  );
  const cid = await importContent(files, async () => {});
  return { declaration, resolved, cid, files: [...files.keys()].sort() };
}

export async function checkTaskArtifact(directory: string) {
  return inspectTaskArtifact(await readArtifactFiles(directory));
}
