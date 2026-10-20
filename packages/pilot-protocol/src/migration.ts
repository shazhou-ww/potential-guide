import jsonata from "jsonata";
import { compileSubjectProjection } from "./projection.js";
import { parseObjectives } from "./objectives.js";
import { OBJECTIVE_SCHEMA_URI, OBJECTIVES_SCHEMA_URI } from "./schemas.js";
import { fields, json, parseManifest, record } from "./validation.js";

export type MigrationFormat = "manifest" | "declarations" | "portfolio";
export interface MigrationOptions {
  readonly contextKind?: "git" | "non-git";
  readonly subjects?: Readonly<Record<string, string>>;
}

function fail(message: string): never {
  throw new TypeError(`Migration refused: ${message} Original input has not been changed.`);
}

export function migrateSubjectExpression(
  expression: string,
  options: MigrationOptions = {},
): string {
  const ast: unknown = JSON.parse(JSON.stringify(jsonata(expression).ast()));
  function emit(node: unknown, pathStep = false): string {
    if (!record(node))
      return fail("Unsupported projection AST; provide an explicit reviewed subject override.");
    if (node.type === "path" && Array.isArray(node.steps)) {
      const names = node.steps.map((step) =>
        record(step) && step.type === "name" ? step.value : undefined,
      );
      const path = names.every((name) => typeof name === "string") ? names.join(".") : undefined;
      if (path === "context")
        return fail(
          "A whole legacy context cannot be safely converted; provide a reviewed subject override.",
        );
      if (path?.startsWith("context.")) {
        if (
          ["context.repository", "context.checkout", "context.directory"].some(
            (old) => path === old || path.startsWith(`${old}.`),
          )
        ) {
          if (!options.contextKind)
            return fail(
              "Legacy context requires --context-kind git|non-git, or an explicit subject override.",
            );
          switch (path) {
            case "context.checkout.rootPath":
              if (options.contextKind === "git") return "context.repo.rootPath";
              break;
            case "context.directory.relativePath":
              if (options.contextKind === "git") return "context.path";
              break;
            case "context.directory.absolutePath":
              return options.contextKind === "git"
                ? "$pathJoin(context.repo.rootPath, context.path)"
                : "context.path";
          }
          return fail(
            `Cannot preserve ${path}; opaque repository/checkout identities and nullable relative paths require an explicit reviewed subject override.`,
          );
        }
      }
      return node.steps.map((step) => emit(step, true)).join(".");
    }
    if (node.type === "name" && typeof node.value === "string") {
      if (!pathStep && node.value === "context")
        return fail(
          "A whole legacy context cannot be safely converted; provide a reviewed subject override and update its target subject contract.",
        );
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.value))
        return fail("Non-simple field names require a reviewed subject override.");
      return node.value;
    }
    if (["string", "number", "value"].includes(String(node.type)))
      return JSON.stringify(node.value);
    if (node.type === "unary" && node.value === "{" && Array.isArray(node.lhs))
      return `{${node.lhs
        .map((pair) => {
          if (!Array.isArray(pair) || pair.length !== 2) return fail("Invalid object projection.");
          return `${emit(pair[0])}:${emit(pair[1])}`;
        })
        .join(",")}}`;
    if (node.type === "unary" && node.value === "[" && Array.isArray(node.expressions))
      return `[${node.expressions.map((child) => emit(child)).join(",")}]`;
    if (node.type === "binary" && ["+", "-", "*", "/", "%", "&"].includes(String(node.value)))
      return `${emit(node.lhs)} ${node.value} ${emit(node.rhs)}`;
    if (node.type === "variable" && node.value === "")
      return fail("Whole evaluation-root projections require a reviewed subject override.");
    if (
      node.type === "function" &&
      record(node.procedure) &&
      node.procedure.value === "pathJoin" &&
      Array.isArray(node.arguments)
    )
      return `$pathJoin(${node.arguments.map((child) => emit(child)).join(",")})`;
    return fail(
      "Projection is outside the supported migration profile; provide a reviewed subject override.",
    );
  }
  const migrated = emit(ast);
  compileSubjectProjection(migrated);
  return migrated;
}

export function migrateLegacyObjectiveDocument(
  value: unknown,
  format: MigrationFormat,
  options: MigrationOptions = {},
): unknown {
  if (!record(value) || !json(value)) return fail("Input must be a finite JSON document.");
  if (Object.hasOwn(value, "$schema"))
    return fail(
      "Input is already schema-identified; no automatic downgrade or overwrite is allowed.",
    );
  if (format === "manifest") {
    fields(value, ["schemaVersion", "domainSchema", "levels", "defaultLanguage", "languages"]);
    if (value.schemaVersion !== 1 || !Array.isArray(value.levels))
      return fail("Expected legacy Manifest schemaVersion: 1.");
    const result = {
      $schema: OBJECTIVE_SCHEMA_URI,
      subjectSchema: value.domainSchema,
      levels: value.levels.map((level) => {
        if (!record(level) || !record(level.advancement)) return fail("Invalid legacy level.");
        fields(level, ["id", "advancement"]);
        fields(level.advancement, ["checks"]);
        return { id: level.id, checks: level.advancement.checks };
      }),
      defaultLanguage: value.defaultLanguage,
      languages: value.languages,
    };
    return parseManifest(JSON.stringify(result));
  }
  if (format === "declarations") {
    fields(value, ["schemaVersion", "objectives"]);
    if (value.schemaVersion !== 1 || !record(value.objectives))
      return fail("Expected legacy declarations schemaVersion: 1.");
    for (const name of Object.keys(options.subjects ?? {}))
      if (!Object.hasOwn(value.objectives, name))
        return fail(`Subject override ${name} has no corresponding declaration.`);
    const objectives: Record<string, unknown> = Object.create(null);
    for (const [name, entry] of Object.entries(value.objectives)) {
      if (!record(entry)) return fail(`Invalid declaration ${name}.`);
      fields(entry, ["description", "pilot", "inputSchema", "subject"]);
      if (typeof entry.subject !== "string") return fail(`Invalid subject for ${name}.`);
      const subject = options.subjects?.[name] ?? migrateSubjectExpression(entry.subject, options);
      compileSubjectProjection(subject);
      objectives[name] = {
        description: entry.description,
        objective: entry.pilot,
        inputSchema: entry.inputSchema,
        subject,
      };
    }
    const result = { $schema: OBJECTIVES_SCHEMA_URI, objectives };
    parseObjectives(JSON.stringify(result));
    return result;
  }
  fields(value, ["schemaVersion", "goals", "resources"]);
  if (value.schemaVersion !== 3 || !Array.isArray(value.goals) || !Array.isArray(value.resources))
    return fail(
      "Only legacy Portfolio schemaVersion: 3 is supported. Recovery/report/queue records containing pinned source evidence must be reobserved from a deliberately migrated and committed Objective; commit/tree evidence is never rewritten or invented.",
    );
  const goals = value.goals.map((goal) => {
    if (!record(goal)) return fail("Invalid Portfolio goal.");
    fields(
      goal,
      ["id", "pilot", "subject", "targetLevel", "priority", "observationIntervalMs"],
      ["revision", "requirements"],
    );
    if (goal.revision !== undefined)
      return fail(
        "Pinned Portfolio revisions cannot be silently rebound. Commit the migrated Objective, then create a new explicit binding; do not replace commit/tree evidence.",
      );
    const { pilot, ...rest } = goal;
    return { ...rest, objective: pilot };
  });
  return { schemaVersion: 3, goals, resources: structuredClone(value.resources) };
}
