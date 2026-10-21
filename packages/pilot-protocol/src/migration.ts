import jsonata from "jsonata";
import { compileSubjectProjection } from "./projection.js";
import { parseObjectives } from "./objectives.js";
import { OBJECTIVE_SCHEMA_URI, OBJECTIVES_SCHEMA_URI } from "./schemas.js";
import { fields, json, parseManifest, record } from "./validation.js";

export type MigrationFormat = "manifest" | "declarations" | "portfolio";
export interface MigrationOptions {
  readonly contextKind?: "git" | "non-git";
  readonly subjects?: Readonly<Record<string, string>>;
  /** Reviewed attained IDs, in the order of the old exit-check groups. */
  readonly attainmentLevels?: readonly string[];
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
  const legacyV1 =
    value.$schema === "https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json";
  if (Object.hasOwn(value, "$schema") && !(format === "manifest" && legacyV1))
    return fail(
      "Input is already schema-identified; no automatic downgrade or overwrite is allowed.",
    );
  if (format === "manifest") {
    fields(
      value,
      legacyV1
        ? ["$schema", "subjectSchema", "levels", "defaultLanguage", "languages"]
        : ["schemaVersion", "domainSchema", "levels", "defaultLanguage", "languages"],
    );
    if ((!legacyV1 && value.schemaVersion !== 1) || !Array.isArray(value.levels))
      return fail("Expected legacy Manifest schemaVersion: 1.");
    if (!options.attainmentLevels || options.attainmentLevels.length !== value.levels.length)
      return fail(
        "Provide explicitly reviewed --attainment-levels (one attained ID per old exit-check group). Review old targets separately and reobserve all pinned evidence.",
      );
    const result = {
      $schema: OBJECTIVE_SCHEMA_URI,
      subjectSchema: legacyV1 ? value.subjectSchema : value.domainSchema,
      levels: value.levels.map((level, index) => {
        if (!record(level)) return fail("Invalid legacy level.");
        fields(level, legacyV1 ? ["id", "checks"] : ["id", "advancement"]);
        if (!legacyV1 && !record(level.advancement)) return fail("Invalid legacy advancement.");
        const advancement = legacyV1 ? level : level.advancement;
        if (!record(advancement)) return fail("Invalid legacy advancement.");
        if (!legacyV1) fields(advancement, ["checks"]);
        return { id: options.attainmentLevels?.[index], checks: advancement.checks };
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
  return fail(
    "Portfolio targets require explicit review against each committed v2 Objective. Create a schemaVersion: 4 Portfolio with reviewed targets and new bindings; pinned source evidence must be reobserved, never rewritten or invented.",
  );
}
