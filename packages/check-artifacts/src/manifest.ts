import { createHash } from "node:crypto";
import {
  type ArtifactTreeLimits,
  readArtifactTree as readTree,
} from "@potential-guide/check-runtime-files";
import { Ajv, type AnySchema } from "ajv";
import { artifactLimits, safePath } from "./paths.js";

export { artifactLimits, safeComponent, safePath } from "./paths.js";

export const artifactDigestPrefix = "sha256-pguide-check-v1:";
export interface CheckManifest {
  format: "pguide-check-v1";
  id: string;
  version?: string;
  worker: "worker.cjs";
  protocol: "pguide-check-host-v1";
  subjectSchema: AnySchema;
  resultSchema: AnySchema;
  resources: { path: string; executable: boolean }[];
  references: { check: string; problems: Record<string, string>; supporting?: string[] };
}
const ajv = new Ajv({ strict: false, validateFormats: false });
const validate = ajv.compile<CheckManifest>({
  type: "object",
  additionalProperties: false,
  required: [
    "format",
    "id",
    "worker",
    "protocol",
    "subjectSchema",
    "resultSchema",
    "resources",
    "references",
  ],
  properties: {
    format: { const: "pguide-check-v1" },
    id: { type: "string", pattern: "^[a-z][a-z0-9]*(?:[./-][a-z0-9]+)*$" },
    version: { type: "string", minLength: 1, maxLength: 128 },
    worker: { const: "worker.cjs" },
    protocol: { const: "pguide-check-host-v1" },
    subjectSchema: { type: ["object", "boolean"] },
    resultSchema: { type: ["object", "boolean"] },
    resources: {
      type: "array",
      maxItems: 254,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "executable"],
        properties: { path: { type: "string" }, executable: { type: "boolean" } },
      },
    },
    references: {
      type: "object",
      additionalProperties: false,
      required: ["check", "problems"],
      properties: {
        check: { type: "string" },
        problems: {
          type: "object",
          propertyNames: { pattern: "^[a-z][a-z0-9]*(?:[./-][a-z0-9]+)*$" },
          additionalProperties: { type: "string" },
        },
        supporting: { type: "array", uniqueItems: true, items: { type: "string" } },
      },
    },
  },
});
export function parseManifest(bytes: Buffer): CheckManifest {
  if (bytes.length > 16 * 1024) throw new Error("Check manifest exceeds its size limit.");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!validate(value))
    throw new Error(`Invalid Check manifest: ${ajv.errorsText(validate.errors)}`);
  for (const schema of [value.subjectSchema, value.resultSchema]) {
    // Compilation is synchronous: remote schema loading and custom keywords are not enabled.
    const validator = new Ajv({ strict: false, validateFormats: false });
    validator.compile(schema);
  }
  const declared = new Set(["check.json", "worker.cjs"]);
  for (const { path } of value.resources) {
    if (!safePath(path) || !path.startsWith("resources/") || declared.has(path))
      throw new Error("Resources require unique explicit resources/ paths.");
    declared.add(path);
  }
  for (const path of [
    value.references.check,
    ...Object.values(value.references.problems),
    ...(value.references.supporting ?? []),
  ]) {
    if (!safePath(path) || !path.startsWith("references/"))
      throw new Error("References require references/ paths.");
  }
  return value;
}
export function declaredFiles(manifest: CheckManifest): Set<string> {
  return new Set([
    "check.json",
    "worker.cjs",
    ...manifest.resources.map(({ path }) => path),
    manifest.references.check,
    ...Object.values(manifest.references.problems),
    ...(manifest.references.supporting ?? []),
  ]);
}
export function inspectFiles(files: ReadonlyMap<string, Buffer>) {
  const manifestBytes = files.get("check.json");
  if (!manifestBytes) throw new Error("Missing check.json.");
  const manifest = parseManifest(manifestBytes);
  const declared = declaredFiles(manifest);
  if (files.size !== declared.size || [...declared].some((name) => !files.has(name)))
    throw new Error("Check artifact has missing or undeclared content.");
  for (const path of [manifest.references.check, ...Object.values(manifest.references.problems)])
    if (!files.get(path)?.length) throw new Error("References must not be empty.");
  const hash = createHash("sha256").update("pguide-check\0v1\0");
  for (const [name, bytes] of [...files].sort(([a], [b]) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  ))
    hash
      .update(JSON.stringify([name, bytes.length]))
      .update("\0")
      .update(bytes);
  return { manifest, digest: `${artifactDigestPrefix}${hash.digest("hex")}`, files };
}
function checkFileError(error: unknown): never {
  if (error instanceof Error) {
    error.message = error.message
      .replace(/^Artifact root /, "Check root ")
      .replace(/^Artifact /, "Check artifact ");
  }
  throw error;
}
async function readPortableTree(
  directory: string,
  configuration: Partial<ArtifactTreeLimits> = {},
) {
  try {
    const tree = await readTree(directory, {
      bytes: artifactLimits.bytes,
      fileBytes: artifactLimits.bytes,
      files: artifactLimits.files,
      paths: artifactLimits.paths,
      ...configuration,
    });
    const seen = new Set<string>();
    for (const path of [...tree.directories, ...tree.files.keys()]) {
      if (!safePath(path) || seen.has(path.toLowerCase()))
        throw new Error("Check artifact contains an unsafe or ambiguous path.");
      seen.add(path.toLowerCase());
    }
    return tree;
  } catch (error) {
    checkFileError(error);
  }
}
function rejectEmptyDirectories(
  files: ReadonlyMap<string, Buffer>,
  directories: readonly string[],
) {
  if (directories.some((name) => ![...files.keys()].some((file) => file.startsWith(`${name}/`))))
    throw new Error("Check artifact contains an undeclared empty directory.");
}
export async function readArtifactFiles(
  directory: string,
  configuration: Partial<ArtifactTreeLimits> = {},
): Promise<ReadonlyMap<string, Buffer>> {
  const { files, directories } = await readPortableTree(directory, configuration);
  rejectEmptyDirectories(files, directories);
  return files;
}
export async function inspectCheckArtifact(directory: string) {
  const { files, directories } = await readPortableTree(directory);
  const inspected = inspectFiles(files);
  rejectEmptyDirectories(files, directories);
  return inspected;
}
