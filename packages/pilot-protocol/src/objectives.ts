import { compileSubjectProjection } from "./projection.js";
import { canonicalObjectiveUri } from "./resources.js";
import type { JSONSchema } from "json-schema-typed";
import { OBJECTIVES_SCHEMA_URI, validateObjectivesDocument } from "./schemas.js";
import type { JsonObject, JsonValue, PilotSpec, Subject } from "./types.js";
import {
  compileDomain,
  compileInputSchema,
  json,
  ObjectiveOperationError,
  parseStrictYaml,
  record,
  validateSubject,
} from "./validation.js";

export interface ObjectiveDeclaration {
  readonly description: string;
  readonly objective: string;
  readonly inputSchema?: JSONSchema;
  readonly subject: string;
}

export function parseObjectives(source: string): Record<string, ObjectiveDeclaration> {
  const value = parseStrictYaml(source);
  if (
    !record(value) ||
    !validateObjectivesDocument(value) ||
    value.$schema !== OBJECTIVES_SCHEMA_URI ||
    !record(value.objectives) ||
    Object.keys(value).some((key) => !["$schema", "objectives"].includes(key))
  )
    throw new ObjectiveOperationError(
      `objectives.yaml requires $schema: ${OBJECTIVES_SCHEMA_URI} and objectives only. Legacy schemaVersion/pilot fields require explicit objective-contract-migrate migration.`,
    );
  const entries: Record<string, ObjectiveDeclaration> = Object.create(null);
  const text = (entry: unknown): entry is string =>
    typeof entry === "string" && entry.trim() !== "";
  for (const [name, entry] of Object.entries(value.objectives)) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
      !record(entry) ||
      ![3, 4].includes(Object.keys(entry).length) ||
      Object.keys(entry).some(
        (key) => !["description", "objective", "inputSchema", "subject"].includes(key),
      ) ||
      !text(entry.description) ||
      !text(entry.objective) ||
      !text(entry.subject) ||
      (entry.inputSchema !== undefined &&
        !(
          (record(entry.inputSchema) || typeof entry.inputSchema === "boolean") &&
          json(entry.inputSchema)
        ))
    )
      throw new ObjectiveOperationError(
        `Invalid Objective ${name}: requires description, directory objective and JSONata subject; inputSchema is optional. Migrate legacy pilot fields explicitly.`,
      );
    const schema = (entry.inputSchema ?? { const: {} }) as JSONSchema;
    compileInputSchema(schema);
    compileSubjectProjection(entry.subject);
    if (entry.objective.startsWith("git+")) canonicalObjectiveUri(entry.objective);
    else if (
      ["objective.yaml", "pilot.yaml"].includes(
        entry.objective.replace(/\\/g, "/").replace(/\/$/, "").split("/").at(-1) ?? "",
      )
    )
      throw new ObjectiveOperationError(
        `Objective ${name} must reference a Pilot directory, not objective.yaml.`,
      );
    entries[name] = {
      description: entry.description,
      objective: entry.objective,
      inputSchema: schema,
      subject: entry.subject,
    };
  }
  return entries;
}

export function projectObjective(
  entry: ObjectiveDeclaration,
  context: JsonObject,
  input: JsonValue | undefined,
): Subject {
  if (
    Object.keys(context).length !== 2 ||
    !Object.hasOwn(context, "repo") ||
    typeof context.path !== "string" ||
    context.path.length === 0 ||
    (context.repo !== null &&
      (!record(context.repo) ||
        Object.keys(context.repo).length !== 2 ||
        typeof context.repo.rootPath !== "string" ||
        context.repo.rootPath.length === 0 ||
        !(context.repo.origin === null || typeof context.repo.origin === "string")))
  )
    throw new ObjectiveOperationError(
      "Objective context must be exactly {repo: {rootPath, origin: string|null}|null, path: string}. Legacy context requires explicit expression/subject migration.",
    );
  const schema = entry.inputSchema ?? { const: {} };
  const validate = compileInputSchema(schema);
  const empty = (value: unknown) => record(value) && Object.keys(value).length === 0;
  const unit =
    typeof schema === "object" &&
    (empty(schema.const) ||
      (Array.isArray(schema.enum) && schema.enum.length === 1 && empty(schema.enum[0])) ||
      (schema.type === "object" &&
        (schema.maxProperties === 0 ||
          (schema.additionalProperties === false &&
            (schema.properties === undefined || empty(schema.properties)) &&
            (schema.patternProperties === undefined || empty(schema.patternProperties))))));
  if (input === undefined && !(unit && validate({})))
    throw new ObjectiveOperationError(
      "Objective input is required; provide --input-file. Only Unit input may be omitted.",
    );
  const value = input === undefined ? {} : input;
  if (!json(value) || !validate(value))
    throw new ObjectiveOperationError(
      `Invalid Objective input: ${JSON.stringify(validate.errors)}`,
    );
  const subject = compileSubjectProjection(entry.subject, { requireDefined: true })({
    context,
    input: value,
  });
  if (!record(subject) || !json(subject))
    throw new ObjectiveOperationError("Objective projection must return a finite JSON object.");
  return subject;
}

export function bindObjective(
  entry: ObjectiveDeclaration,
  context: JsonObject,
  input: JsonValue | undefined,
  spec: PilotSpec,
): Subject {
  const subject = projectObjective(entry, context, input);
  const issues = validateSubject(subject, compileDomain(spec.manifest.subjectSchema));
  if (issues !== null)
    throw new ObjectiveOperationError(`Invalid projected subject: ${JSON.stringify(issues)}`);
  return subject;
}
