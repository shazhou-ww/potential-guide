import {
  type CheckArtifactSource,
  readArtifactFiles,
  safePath,
} from "@potential-guide/check-artifacts";
import { compileSubjectProjection, type PilotSpec } from "@potential-guide/objective-pilot";
import { parseManifest, validateObjectiveArtifactDocument } from "@potential-guide/pilot-protocol";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const objectiveArtifactSchemaUri =
  "https://shazhou-ww.github.io/potential-guide/schemas/objective-artifact/v1.json";
export const objectiveArtifactDigestPrefix = "sha256-pguide-objective-v1:";
export interface ObjectiveArtifactManifest {
  readonly $schema: typeof objectiveArtifactSchemaUri;
  readonly id: string;
  readonly subjectSchema: PilotSpec["manifest"]["subjectSchema"];
  readonly levels: PilotSpec["manifest"]["levels"];
  readonly defaultLanguage: string;
  readonly languages: PilotSpec["manifest"]["languages"];
  readonly checks: Readonly<
    Record<
      string,
      {
        readonly source: CheckArtifactSource;
        readonly subject: string;
      }
    >
  >;
  readonly dependencies: Readonly<
    Record<string, { readonly directory: string; readonly digest: string }>
  >;
  readonly references: Readonly<
    Record<
      string,
      Readonly<
        Record<
          string,
          {
            readonly path: string;
            readonly title: string;
            readonly description: string;
            readonly references?: readonly string[];
          }
        >
      >
    >
  >;
  readonly resources: readonly string[];
}
function pilotManifest(manifest: ObjectiveArtifactManifest): PilotSpec["manifest"] {
  return parseManifest(
    JSON.stringify({
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
      subjectSchema: manifest.subjectSchema,
      levels: manifest.levels,
      defaultLanguage: manifest.defaultLanguage,
      languages: manifest.languages,
    }),
  );
}
/** Inspect author-owned data without installing packages or executing JavaScript. */
export async function inspectObjectiveArtifact(directory: string) {
  const files = await readArtifactFiles(resolve(directory));
  const bytes = files.get("objective.json");
  if (!bytes || bytes.length > 16 * 1024) throw new Error("Missing or oversized objective.json.");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!validateObjectiveArtifactDocument(value))
    throw new Error(
      `Invalid Objective artifact manifest: ${JSON.stringify(validateObjectiveArtifactDocument.errors)}.`,
    );
  const manifest = value as ObjectiveArtifactManifest;
  pilotManifest(manifest);
  const used = new Set(manifest.levels.flatMap((level) => level.checks.map((check) => check.id)));
  if (
    used.size !== Object.keys(manifest.checks).length ||
    [...used].some((id) => !Object.hasOwn(manifest.checks, id))
  )
    throw new Error("Every Check reference must be declared and used.");
  for (const check of Object.values(manifest.checks))
    compileSubjectProjection(check.subject, { requireDefined: true });
  const declared = new Set(["objective.json"]);
  for (const [id, locales] of Object.entries(manifest.references)) {
    if (
      !/^(?:(?:system|levels|checks|pages)\/[a-z0-9-]+|checks\/[a-z0-9-]+\/problems\/[a-z0-9-]+|levels\/[a-z0-9-]+\/checks\/[a-z0-9-]+(?:\/problems\/[a-z0-9-]+)?)$/.test(
        id,
      ) ||
      Object.keys(locales).some((language) => !manifest.languages.includes(language))
    )
      throw new Error("Invalid Reference identity or locale.");
    for (const page of Object.values(locales)) declared.add(page.path);
  }
  for (const path of manifest.resources) declared.add(path);
  if (
    [...declared].some(
      (path) => !safePath(path) || (path !== "objective.json" && !path.startsWith("references/")),
    ) ||
    files.size !== declared.size ||
    [...declared].some((path) => !files.has(path))
  )
    throw new Error("Objective artifact has unsafe, missing or undeclared files.");
  const hash = createHash("sha256").update("pguide-objective\0v1\0");
  for (const [name, content] of [...files].sort(([a], [b]) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  ))
    hash
      .update(JSON.stringify([name, content.length]))
      .update("\0")
      .update(content);
  return { manifest, files, digest: `${objectiveArtifactDigestPrefix}${hash.digest("hex")}` };
}
/** A declaration-safe address carrying an exact digest, distinct from stable Objective identity. */
export function objectiveArtifactLocation(directory: string, digest: string): string {
  if (!/^sha256-pguide-objective-v1:[a-f0-9]{64}$/.test(digest))
    throw new Error("An exact Objective artifact digest is required.");
  const url = pathToFileURL(resolve(directory));
  url.searchParams.set("digest", digest);
  return url.href.replace(/^file:/, "artifact+file:");
}
export function parseObjectiveArtifactLocation(location: string): {
  directory: string;
  digest: string;
} {
  const url = new URL(location.replace(/^artifact\+file:/, "file:"));
  const digest = url.searchParams.get("digest");
  if (
    !location.startsWith("artifact+file:") ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].join(",") !== "digest" ||
    digest === null ||
    !/^sha256-pguide-objective-v1:[a-f0-9]{64}$/.test(digest)
  )
    throw new Error("Artifact location requires a file URL and one exact digest.");
  url.search = "";
  return { directory: fileURLToPath(url), digest };
}
