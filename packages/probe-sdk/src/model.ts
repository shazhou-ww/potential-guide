import {
  bundleCid,
  validateBundleReference,
} from "@silvermoon-work/task-protocol/bundle-reference";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const identifier = Type.String({ pattern: "^[a-z][a-z0-9-]*$", maxLength: 128 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
export const mappingSchema = Type.String({ minLength: 1, maxLength: 1024 });
const record = <T extends import("@sinclair/typebox").TSchema>(value: T) =>
  Type.Record(identifier, value);
export const levelsSchema = Type.Array(
  Type.Object(
    {
      id: identifier,
      checks: Type.Array(identifier, { uniqueItems: true, maxItems: 128 }),
    },
    { additionalProperties: false },
  ),
  { minItems: 1, maxItems: 128 },
);
export const checksSchema = record(
  Type.Object(
    {
      bundle: identifier,
      inputMapping: mappingSchema,
    },
    { additionalProperties: false },
  ),
);
const referencesSchema = Type.Record(
  Type.String(),
  Type.Object(
    {
      objective: path,
      levels: record(path),
      checks: record(
        Type.Object(
          {
            check: Type.Optional(path),
            problems: record(path),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
);

export const objectiveSchemaUri =
  "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/probe-objective/v1.json";
export const objectiveSchema = Type.Object(
  {
    $schema: Type.Literal(objectiveSchemaUri),
    kind: identifier,
    languages: Type.Array(Type.String(), { minItems: 1, uniqueItems: true, maxItems: 32 }),
    bundles: record(Type.Object({ path, cid: path }, { additionalProperties: false })),
    checks: checksSchema,
    levels: levelsSchema,
    references: referencesSchema,
  },
  { additionalProperties: false },
);
export type ObjectiveDefinition = Static<typeof objectiveSchema>;
export interface ProbeDefinitions {
  languages: readonly string[];
  levels: readonly { id: string; checks: readonly string[] }[];
  problemCodes: Readonly<Record<string, readonly string[]>>;
}
export interface CheckDefinition {
  kind: string;
  languages: string[];
  problemCodes: string[];
  references: Record<string, { check: string; problems: Record<string, string> }>;
}
export function assertLanguages(languages: readonly string[]): void {
  if (!languages.length || new Set(languages).size !== languages.length)
    throw new Error("Invalid languages.");
  for (const language of languages)
    if (Intl.getCanonicalLocales(language)[0] !== language)
      throw new Error(`Noncanonical language: ${language}`);
}
export function parseMapping(mapping: string): string[] {
  if (mapping === "$") return [];
  const parts = mapping.split(".");
  if (
    mapping.length > 1024 ||
    parts.length > 32 ||
    parts.some(
      (part) =>
        !/^(?:[A-Za-z_][A-Za-z0-9_-]*|0|[1-9][0-9]*)$/.test(part) ||
        ["__proto__", "prototype", "constructor"].includes(part),
    )
  )
    throw new Error(`Invalid bounded input mapping: ${mapping}`);
  return parts;
}
export function mapInput(input: unknown, mapping: string): unknown {
  let value = input;
  for (const key of parseMapping(mapping)) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
      throw new Error(`Input mapping not found: ${mapping}`);
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
export function validateComposition(
  config: Pick<ObjectiveDefinition, "languages" | "bundles" | "checks" | "levels">,
): void {
  assertLanguages(config.languages);
  const ids = config.levels.map((level) => level.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => ["initial", "terminal"].includes(id)))
    throw new Error("Duplicate or reserved Level ID.");
  const usedChecks = new Set(config.levels.flatMap((level) => level.checks));
  if (
    [...usedChecks].some((ref) => !Object.hasOwn(config.checks, ref)) ||
    Object.keys(config.checks).some((ref) => !usedChecks.has(ref))
  )
    throw new Error("Unknown or unused Check reference.");
  const usedBundles = new Set(Object.values(config.checks).map((check) => check.bundle));
  if (
    [...usedBundles].some((name) => !Object.hasOwn(config.bundles, name)) ||
    Object.keys(config.bundles).some((name) => !usedBundles.has(name))
  )
    throw new Error("Unknown or unused Bundle binding.");
  for (const check of Object.values(config.checks)) parseMapping(check.inputMapping);
}
export function readObjective(value: unknown): ObjectiveDefinition {
  if (!Value.Check(objectiveSchema, value)) throw new Error("Invalid Probe Objective definition.");
  validateComposition(value);
  for (const [name, bundle] of Object.entries(value.bundles))
    if (
      bundle.path !== `resources/checks/${name}` ||
      bundleCid(validateBundleReference(bundle.cid)) !== bundle.cid
    )
      throw new Error("Invalid Check subtree binding.");
  if (Object.keys(value.references).sort().join() !== [...value.languages].sort().join())
    throw new Error("Objective Reference languages differ.");
  for (const language of value.languages) {
    const refs = value.references[language]!;
    if (
      refs.objective !== `resources/references/${language}/objective.md` ||
      Object.keys(refs.levels).sort().join() !==
        [...value.levels.map((level) => level.id), "terminal"].sort().join()
    )
      throw new Error("Invalid Objective References.");
    for (const [id, path] of Object.entries(refs.levels))
      if (path !== `resources/references/${language}/levels/${id}.md`)
        throw new Error("Invalid Level Reference.");
    for (const [ref, pages] of Object.entries(refs.checks)) {
      if (!Object.hasOwn(value.checks, ref)) throw new Error("Unknown override Check.");
      const base = `resources/references/${language}/checks/${ref}`;
      if (pages.check !== undefined && pages.check !== `${base}/check.md`)
        throw new Error("Invalid Check override.");
      for (const [code, path] of Object.entries(pages.problems))
        if (path !== `${base}/problems/${code}.md`) throw new Error("Invalid Problem override.");
    }
  }
  return value;
}
export function readCheckDefinition(value: unknown): CheckDefinition {
  const schema = Type.Object(
    {
      kind: identifier,
      languages: Type.Array(Type.String(), { minItems: 1, uniqueItems: true }),
      problemCodes: Type.Array(Type.String({ pattern: "^[a-z][a-z0-9-]*$", maxLength: 4096 }), {
        uniqueItems: true,
      }),
      references: Type.Record(
        Type.String(),
        Type.Object(
          {
            check: path,
            problems: Type.Record(Type.String(), path),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  );
  if (!Value.Check(schema, value)) throw new Error("Invalid Check definition.");
  assertLanguages(value.languages);
  if (Object.keys(value.references).sort().join() !== [...value.languages].sort().join())
    throw new Error("Check Reference languages differ.");
  for (const language of value.languages) {
    const refs = value.references[language]!;
    if (
      refs.check !== `resources/references/${language}/check.md` ||
      Object.keys(refs.problems).sort().join() !== [...value.problemCodes].sort().join()
    )
      throw new Error("Invalid Check References.");
    for (const code of value.problemCodes)
      if (refs.problems[code] !== `resources/references/${language}/problems/${code}.md`)
        throw new Error("Invalid Check Problem Reference.");
  }
  return value;
}
