import { compileSubjectProjection } from "./projection.js";
import { canonicalObjectiveUri } from "./resources.js";
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
  readonly pilot: string;
  readonly inputSchema: JsonObject;
  readonly subject: string;
}

export function parseObjectives(source: string): Record<string, ObjectiveDeclaration> {
  const value = parseStrictYaml(source);
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !record(value.objectives) ||
    Object.keys(value).some((key) => !["schemaVersion", "objectives"].includes(key))
  )
    throw new ObjectiveOperationError(
      "objectives.yaml requires schemaVersion: 1 and objectives only.",
    );
  const entries: Record<string, ObjectiveDeclaration> = Object.create(null);
  const text = (entry: unknown): entry is string =>
    typeof entry === "string" && entry.trim() !== "";
  for (const [name, entry] of Object.entries(value.objectives)) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
      !record(entry) ||
      Object.keys(entry).length !== 4 ||
      Object.keys(entry).some(
        (key) => !["description", "pilot", "inputSchema", "subject"].includes(key),
      ) ||
      !text(entry.description) ||
      !text(entry.pilot) ||
      !text(entry.subject) ||
      !record(entry.inputSchema) ||
      !json(entry.inputSchema)
    )
      throw new ObjectiveOperationError(
        `Invalid Objective ${name}: requires description, directory pilot, inputSchema and JSONata subject; target is not a declaration field.`,
      );
    compileInputSchema(entry.inputSchema);
    compileSubjectProjection(entry.subject);
    if (entry.pilot.startsWith("git+")) canonicalObjectiveUri(entry.pilot);
    else if (entry.pilot.replace(/\\/g, "/").replace(/\/$/, "").split("/").at(-1) === "pilot.yaml")
      throw new ObjectiveOperationError(
        `Objective ${name} must reference a Pilot directory, not pilot.yaml.`,
      );
    entries[name] = {
      description: entry.description,
      pilot: entry.pilot,
      inputSchema: entry.inputSchema,
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
  const validate = compileInputSchema(entry.inputSchema);
  const schema = entry.inputSchema;
  const empty = (value: unknown) => record(value) && Object.keys(value).length === 0;
  const unit =
    empty(schema.const) ||
    (Array.isArray(schema.enum) && schema.enum.length === 1 && empty(schema.enum[0])) ||
    (schema.type === "object" &&
      (schema.maxProperties === 0 ||
        (schema.additionalProperties === false &&
          (schema.properties === undefined || empty(schema.properties)) &&
          (schema.patternProperties === undefined || empty(schema.patternProperties)))));
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
  const issues = validateSubject(subject, compileDomain(spec.manifest.domainSchema));
  if (issues !== null)
    throw new ObjectiveOperationError(`Invalid projected subject: ${JSON.stringify(issues)}`);
  return subject;
}
