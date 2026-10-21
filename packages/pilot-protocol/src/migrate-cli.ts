#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stringify } from "yaml";
import { type MigrationFormat, migrateLegacyObjectiveDocument } from "./migration.js";
import { parseStrictYaml, record } from "./validation.js";

const usage =
  "objective-contract-migrate --format manifest|declarations|portfolio --input <file> --output <new-file> [--context-kind git|non-git] [--subjects-file <reviewed-name-to-expression.json>] [--output-format markdown|json]";
const safety =
  "Input remains untouched. Output must not exist. Pinned source evidence is never rewritten.";
const options = [
  {
    name: "--format",
    argument: "<kind>",
    values: ["manifest", "declarations", "portfolio"],
    required: true,
    description: "Legacy document kind, NOT result or artifact encoding",
  },
  {
    name: "--input",
    argument: "<file>",
    required: true,
    description: "Legacy JSON or YAML input; never modified",
  },
  {
    name: "--output",
    argument: "<new-file>",
    required: true,
    description:
      "New artifact; .json selects JSON, every other extension selects YAML; never overwrite",
  },
  {
    name: "--context-kind",
    argument: "<kind>",
    values: ["git", "non-git"],
    description: "Explicit legacy context interpretation when required by a projection",
  },
  {
    name: "--subjects-file",
    argument: "<file>",
    description: "JSON mapping of declaration names to explicitly reviewed subject expressions",
  },
  {
    name: "--output-format",
    argument: "<format>",
    values: ["markdown", "json"],
    default: "markdown",
    description: "Result receipt and help display only; does not change artifact content",
  },
  { name: "--help", description: "Show help without reading or writing migration files" },
] as const;
const notes = [
  safety,
  "--format chooses the legacy document kind; --output-format chooses result/help display.",
  "Artifact encoding depends only on the --output extension: .json means JSON, otherwise YAML.",
  "Legacy help-only compatibility: --help --format json. For execution use --format manifest|declarations|portfolio --output-format json.",
  "Default failures retain exit 1 and stderr. JSON failures use one stdout object and exit 1.",
];
const examples = [
  "objective-contract-migrate --format manifest --input legacy.json --output objective.yaml",
  "objective-contract-migrate --format declarations --input legacy.yaml --output objectives.json --output-format json",
  "objective-contract-migrate --format portfolio --input portfolio.yaml --output migrated.yaml",
  "objective-contract-migrate --help --output-format json",
];

function outputFormat(argv: readonly string[]): string | undefined {
  const index = argv.indexOf("--output-format");
  return index < 0 ? undefined : argv[index + 1];
}

export async function migrateFiles(argv: readonly string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    const help = {
      schemaVersion: 1,
      command: "objective-contract-migrate",
      description: "Explicit, non-overwriting migration of legacy Objective documents.",
      usage,
      safety,
      options,
      optionDetails: options,
      constraints: notes,
      examples,
    };
    const display = outputFormat(argv);
    if (display !== undefined && display !== "json" && display !== "markdown")
      throw new TypeError("--output-format must be markdown or json.");
    const formatIndex = argv.indexOf("--format");
    const legacyJson = formatIndex >= 0 && argv[formatIndex + 1] === "json";
    process.stdout.write(
      display === "json" || (display === undefined && legacyJson)
        ? `${JSON.stringify(help)}\n`
        : `${help.description}\n\nUsage: ${usage}\n\nOptions:\n${options.map((option) => `  ${option.name}${"argument" in option ? ` ${option.argument}` : ""}  ${option.description}${"default" in option ? ` (default: ${option.default})` : ""}${"values" in option ? ` [${option.values.join(" | ")}]` : ""}${"required" in option ? " (required)" : ""}`).join("\n")}\n\nNotes:\n${notes.map((note) => `  ${note}`).join("\n")}\n\nExamples:\n${examples.map((example) => `  ${example}`).join("\n")}\n`,
    );
    return;
  }
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key ||
      ![
        "--format",
        "--input",
        "--output",
        "--context-kind",
        "--subjects-file",
        "--output-format",
      ].includes(key) ||
      value === undefined ||
      value.startsWith("--") ||
      Object.hasOwn(values, key)
    )
      throw new TypeError(`Usage: ${usage}`);
    values[key] = value;
  }
  if (
    values["--output-format"] !== undefined &&
    !["markdown", "json"].includes(values["--output-format"] as string)
  )
    throw new TypeError("--output-format must be markdown or json.");
  const format = values["--format"];
  const input = values["--input"];
  const output = values["--output"];
  if (!format || !["manifest", "declarations", "portfolio"].includes(format) || !input || !output)
    throw new TypeError("Explicit --format, --input and --output are required.");
  if (resolve(input) === resolve(output))
    throw new TypeError("Input and output must be different files; migration never overwrites.");
  const kind = values["--context-kind"];
  if (kind !== undefined && kind !== "git" && kind !== "non-git")
    throw new TypeError("--context-kind must be git or non-git.");
  const migrationOptions: { contextKind?: "git" | "non-git"; subjects?: Record<string, string> } =
    {};
  if (kind !== undefined) migrationOptions.contextKind = kind;
  const subjectsFile = values["--subjects-file"];
  if (subjectsFile) {
    const subjects: unknown = JSON.parse(await readFile(subjectsFile, "utf8"));
    if (!record(subjects) || !Object.values(subjects).every((value) => typeof value === "string"))
      throw new TypeError(
        "--subjects-file must map declaration names to explicitly reviewed expressions.",
      );
    migrationOptions.subjects = subjects as Record<string, string>;
  }
  const result = migrateLegacyObjectiveDocument(
    parseStrictYaml(await readFile(input, "utf8")),
    format as MigrationFormat,
    migrationOptions,
  );
  const bytes = output.endsWith(".json")
    ? `${JSON.stringify(result, null, 2)}\n`
    : stringify(result);
  await writeFile(output, bytes, { flag: "wx" });
  const receipt = {
    schemaVersion: 1,
    status: "migrated",
    format,
    input: resolve(input),
    output: resolve(output),
    artifactFormat: output.endsWith(".json") ? "json" : "yaml",
    inputUnchanged: true,
    overwritten: false,
  };
  process.stdout.write(
    values["--output-format"] === "json"
      ? `${JSON.stringify(receipt)}\n`
      : `Migration completed.\nKind: ${format}\nInput: ${receipt.input} (unchanged)\nOutput: ${receipt.output}\nArtifact format: ${receipt.artifactFormat}\nExisting files were not overwritten; pinned source evidence was not rewritten.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrateFiles(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (outputFormat(process.argv.slice(2)) === "json")
      process.stdout.write(
        `${JSON.stringify({ schemaVersion: 1, status: "error", error: { message } })}\n`,
      );
    else console.error(message);
    process.exitCode = 1;
  });
}
