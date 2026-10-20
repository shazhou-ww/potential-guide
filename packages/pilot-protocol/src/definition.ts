import { canonicalObjectiveUri, pilotResourceUri, validateReferences } from "./resources.js";
import type {
  CheckResult,
  Envelope,
  LevelRef,
  PilotSpec,
  ReferencePage,
  ResourceResolver,
} from "./types.js";
import {
  fields,
  identifier,
  immutable,
  json,
  ObjectiveConfigurationError,
  ObjectiveOperationError,
  parseManifest,
  record,
} from "./validation.js";

export async function loadPilotSpec(uri: string, resources: ResourceResolver): Promise<PilotSpec> {
  if (!resources.version.trim())
    throw new ObjectiveConfigurationError("A source version is required.");
  async function load(input: string): Promise<PilotSpec> {
    const objectiveId = canonicalObjectiveUri(input);
    let sourceText: string;
    try {
      sourceText = await resources.readText(pilotResourceUri(objectiveId, "objective.yaml"));
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
        throw new ObjectiveConfigurationError(
          "Missing objective.yaml. Legacy pilot.yaml is not read: use objective-contract-migrate --format manifest --input pilot.yaml --output objective.yaml, then commit the migrated source before rebinding.",
          { cause },
        );
      throw cause;
    }
    const manifest = parseManifest(sourceText);
    const version =
      resources.versionFor === undefined
        ? resources.version
        : await resources.versionFor(objectiveId);
    if (!version.trim())
      throw new ObjectiveConfigurationError("An Objective source version is required.");
    const source = pilotResourceUri(objectiveId, "references/");
    const locales = Object.fromEntries(
      [...validateReferences(await resources.readPages(source), source, manifest)].map(
        ([language, locale]) => [language, Object.fromEntries(locale.pages)],
      ),
    );
    return immutable({
      objectiveId,
      version,
      ...(resources.sourceFor === undefined
        ? {}
        : { source: await resources.sourceFor(objectiveId) }),
      manifest,
      locales,
    });
  }
  return load(uri);
}

export function describeLevels(spec: PilotSpec): readonly LevelRef[] {
  return [
    ...spec.manifest.levels.map(({ id }) => ({ objectiveId: spec.objectiveId, levelId: id })),
    {
      objectiveId: spec.objectiveId,
      levelId: "terminal",
    },
  ];
}

export function readPage(
  spec: PilotSpec,
  pageId: string,
  language = spec.manifest.defaultLanguage,
): ReferencePage {
  if (!pageId.trim()) throw new ObjectiveOperationError("Page ID must be nonempty.");
  const pages = spec.locales[language];
  if (pages === undefined)
    throw new ObjectiveConfigurationError(`Unsupported language: ${language}.`);
  const page = pages[pageId] ?? pages["system/404"];
  if (page === undefined) throw new ObjectiveConfigurationError("Missing 404 reference page.");
  return page;
}

export function searchPages(
  spec: PilotSpec,
  query: string,
  language = spec.manifest.defaultLanguage,
) {
  if (typeof query !== "string")
    throw new ObjectiveOperationError("Search query must be a string.");
  const pages = spec.locales[language];
  if (pages === undefined)
    throw new ObjectiveConfigurationError(`Unsupported language: ${language}.`);
  const needle = query.trim().toLocaleLowerCase(language);
  return Object.values(pages)
    .filter(({ title, description, content }) =>
      `${title}\n${description}\n${content}`.toLocaleLowerCase(language).includes(needle),
    )
    .map(({ id, title }) => ({ id, title }));
}

export function parseCheckEnvelope(value: unknown): Envelope<CheckResult> {
  if (
    !record(value) ||
    !Number.isInteger(value.status) ||
    Number(value.status) < 100 ||
    Number(value.status) > 599
  )
    throw new ObjectiveOperationError("Invalid check envelope status.");
  fields(value, ["status", "payload", "message"]);
  if (typeof value.message !== "string")
    throw new ObjectiveOperationError("Envelope message must be a string.");
  if (value.payload === null) {
    if (value.status === 200 || !value.message.trim())
      throw new ObjectiveOperationError("Invalid invocation error envelope.");
    return { status: Number(value.status), payload: null, message: value.message };
  }
  if (value.status !== 200 || !record(value.payload))
    throw new ObjectiveOperationError("Successful check invocation requires status 200.");
  const result = value.payload;
  fields(result, ["ok", "problems"]);
  if (
    typeof result.ok !== "boolean" ||
    !Array.isArray(result.problems) ||
    (result.ok ? result.problems.length !== 0 : result.problems.length === 0)
  ) {
    throw new ObjectiveOperationError("Check result must contain ok and consistent problems.");
  }
  const problems = result.problems.map((entry: unknown) => {
    if (!record(entry)) throw new ObjectiveOperationError("Invalid problem.");
    if (entry.kind === "dependency") return parseDependencyProblem(entry);
    fields(entry, ["kind", "id", "parameters"]);
    if (entry.kind !== "internal") throw new ObjectiveOperationError("Invalid problem kind.");
    if (!identifier(entry.id) || !record(entry.parameters) || !json(entry.parameters))
      throw new ObjectiveOperationError("Invalid problem ID or parameters.");
    return { kind: "internal" as const, id: entry.id, parameters: entry.parameters };
  });
  if (result.ok)
    return { status: 200, payload: { ok: true, problems: [] }, message: value.message };
  const [first, ...remaining] = problems;
  if (first === undefined)
    throw new ObjectiveOperationError("A failed check must report problems.");
  return {
    status: 200,
    payload: { ok: false, problems: [first, ...remaining] },
    message: value.message,
  };
}

export function parseDependencyProblem(value: unknown) {
  if (!record(value)) throw new ObjectiveOperationError("Invalid dependency problem.");
  fields(value, ["kind", "objectiveId", "subject", "expectedLevelId", "currentLevelId"]);
  if (
    value.kind !== "dependency" ||
    typeof value.objectiveId !== "string" ||
    !value.objectiveId.startsWith("git+") ||
    canonicalObjectiveUri(value.objectiveId) !== value.objectiveId ||
    !record(value.subject) ||
    !json(value.subject) ||
    !identifier(value.expectedLevelId) ||
    !identifier(value.currentLevelId)
  )
    throw new ObjectiveOperationError("Invalid dependency identity, subject or levels.");
  return {
    kind: "dependency" as const,
    objectiveId: value.objectiveId,
    subject: value.subject,
    expectedLevelId: value.expectedLevelId,
    currentLevelId: value.currentLevelId,
  };
}
