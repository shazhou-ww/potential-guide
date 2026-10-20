import { types } from "node:util";
import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";
import type { JsonObject, JsonValue, PilotManifest, ValidationIssues } from "./types.js";

export class ObjectiveConfigurationError extends TypeError {}
export class ObjectiveOperationError extends TypeError {}

export function parseStrictYaml(source: string): unknown {
  const document = parseDocument(source, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    const cause = document.errors[0];
    throw new ObjectiveConfigurationError(`Invalid YAML: ${cause?.message ?? "unknown error"}.`, {
      cause,
    });
  }
  if (document.warnings.length > 0) {
    const cause = document.warnings[0];
    throw new ObjectiveConfigurationError(
      `Unsupported YAML: ${cause?.message ?? "unknown warning"}.`,
      { cause },
    );
  }
  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch (caught) {
    throw new ObjectiveConfigurationError("Invalid or aliased YAML.", { cause: caught });
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !types.isProxy(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
export function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
export function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
export function json(value: unknown, ancestors = new Set<unknown>()): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (types.isProxy(value)) return false;
  if ((!Array.isArray(value) && !record(value)) || ancestors.has(value)) return false;
  if (
    Array.isArray(value) &&
    (Object.getPrototypeOf(value) !== Array.prototype ||
      Object.keys(value).length !== value.length ||
      Object.keys(value).some((key, index) => key !== String(index)))
  )
    return false;
  if (
    Object.getOwnPropertySymbols(value).length > 0 ||
    Object.entries(Object.getOwnPropertyDescriptors(value)).some(
      ([name, descriptor]) =>
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        (!descriptor.enumerable && !(Array.isArray(value) && name === "length")),
    )
  )
    return false;
  ancestors.add(value);
  const result = Object.values(value).every((child) => json(child, ancestors));
  ancestors.delete(value);
  return result;
}
export function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
export function fields(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw new ObjectiveConfigurationError(
      `Expected fields: ${[...required, ...optional].join(", ")}.`,
    );
  }
}
function canonicalLanguage(language: string) {
  try {
    return Intl.getCanonicalLocales(language)[0] === language;
  } catch (caught) {
    if (!(caught instanceof RangeError)) throw caught;
    return false;
  }
}
export function parseManifest(source: string): PilotManifest {
  const value: unknown = parseStrictYaml(source);
  if (!record(value))
    throw new ObjectiveConfigurationError("Objective Manifest must be an object.");
  fields(value, ["schemaVersion", "domainSchema", "levels", "defaultLanguage", "languages"]);
  if (
    value.schemaVersion !== 1 ||
    !record(value.domainSchema) ||
    !json(value.domainSchema) ||
    !Array.isArray(value.levels) ||
    value.levels.length === 0 ||
    !text(value.defaultLanguage) ||
    !canonicalLanguage(value.defaultLanguage) ||
    !Array.isArray(value.languages) ||
    value.languages.length === 0 ||
    !value.languages.every((language) => text(language) && canonicalLanguage(language)) ||
    !value.languages.includes(value.defaultLanguage) ||
    new Set(value.languages).size !== value.languages.length
  ) {
    throw new ObjectiveConfigurationError("Invalid Manifest schema, levels or languages.");
  }
  const levels = value.levels.map((entry: unknown) => {
    if (!record(entry)) throw new ObjectiveConfigurationError("Invalid level.");
    fields(entry, ["id", "advancement"]);
    if (!identifier(entry.id) || entry.id === "terminal" || !record(entry.advancement)) {
      throw new ObjectiveConfigurationError("Levels require a non-reserved ID and advancement.");
    }
    fields(entry.advancement, ["checks"]);
    if (!Array.isArray(entry.advancement.checks)) {
      throw new ObjectiveConfigurationError("Advancement checks must be check nodes.");
    }
    const checks = entry.advancement.checks.map((check: unknown) => {
      if (!record(check)) throw new ObjectiveConfigurationError("Invalid check.");
      fields(check, ["id", "problems"]);
      if (
        !identifier(check.id) ||
        !Array.isArray(check.problems) ||
        !check.problems.every(identifier)
      ) {
        throw new ObjectiveConfigurationError("Checks require an ID and ProblemIds.");
      }
      if (new Set(check.problems).size !== check.problems.length) {
        throw new ObjectiveConfigurationError(`Duplicate Problem ID in check: ${check.id}.`);
      }
      return { id: check.id, problems: check.problems.map(String) };
    });
    return { id: entry.id, advancement: { checks } };
  });
  const first = levels[0];
  if (first === undefined)
    throw new ObjectiveConfigurationError("Manifest must contain at least one level.");
  if (new Set(levels.map(({ id }) => id)).size !== levels.length) {
    throw new ObjectiveConfigurationError("Duplicate level ID.");
  }
  for (const level of levels) {
    const checks = level.advancement.checks;
    if (new Set(checks.map(({ id }) => id)).size !== checks.length) {
      throw new ObjectiveConfigurationError("Duplicate check ID within a level.");
    }
  }
  return immutable({
    schemaVersion: 1,
    domainSchema: value.domainSchema,
    levels: [first, ...levels.slice(1)],
    defaultLanguage: value.defaultLanguage,
    languages: [value.languages[0], ...value.languages.slice(1)],
  });
}
export function compileDomain(schema: JsonObject): ValidateFunction {
  if (schema.type !== "object")
    throw new ObjectiveConfigurationError("Domain must be a Draft 2020-12 root object schema.");
  return compileInputSchema(schema);
}
export function compileInputSchema(schema: JsonObject): ValidateFunction {
  if (
    schema.$schema !== undefined &&
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema"
  ) {
    throw new ObjectiveConfigurationError("Expected a Draft 2020-12 schema.");
  }
  function inspect(value: unknown) {
    if (Array.isArray(value)) {
      for (const child of value) inspect(child);
      return;
    }
    if (!record(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && (typeof child !== "string" || !child.startsWith("#/$defs/"))) {
        throw new ObjectiveConfigurationError("Only local #/$defs schema references are allowed.");
      }
      inspect(child);
    }
  }
  inspect(schema);
  try {
    return new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  } catch (caught) {
    throw new ObjectiveConfigurationError("Invalid Objective domain schema.", { cause: caught });
  }
}
export function validateSubject(
  subject: unknown,
  validate: ValidateFunction,
): ValidationIssues | null {
  if (!record(subject) || !json(subject) || !validate(subject)) {
    const [
      first = { instancePath: "", keyword: "type", message: "Subject must be a JSON object." },
      ...remaining
    ] = (validate.errors ?? []).map(
      ({ instancePath = "", keyword, message = "Validation failed." }) => ({
        instancePath,
        keyword,
        message,
      }),
    );
    return [first, ...remaining];
  }
  return null;
}
