#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stringify } from "yaml";
import { migrateLegacyObjectiveDocument, type MigrationFormat } from "./migration.js";
import { parseStrictYaml, record } from "./validation.js";

export async function migrateFiles(argv: readonly string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    const help = {
      schemaVersion: 1,
      command: "objective-contract-migrate",
      usage:
        "objective-contract-migrate --format manifest|declarations|portfolio --input <file> --output <new-file> [--context-kind git|non-git] [--subjects-file <reviewed-name-to-expression.json>]",
      safety:
        "Input remains untouched. Output must not exist. Pinned source evidence is never rewritten.",
    };
    process.stdout.write(
      argv.includes("json") ? `${JSON.stringify(help)}\n` : `${help.usage}\n${help.safety}\n`,
    );
    return;
  }
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key ||
      !["--format", "--input", "--output", "--context-kind", "--subjects-file"].includes(key) ||
      value === undefined ||
      value.startsWith("--") ||
      Object.hasOwn(values, key)
    )
      throw new TypeError(
        "Usage: objective-contract-migrate --format manifest|declarations|portfolio --input <file> --output <new-file> [--context-kind git|non-git] [--subjects-file <reviewed-name-to-expression.json>]",
      );
    values[key] = value;
  }
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
  const options: { contextKind?: "git" | "non-git"; subjects?: Record<string, string> } = {};
  if (kind !== undefined) options.contextKind = kind;
  const subjectsFile = values["--subjects-file"];
  if (subjectsFile) {
    const subjects: unknown = JSON.parse(await readFile(subjectsFile, "utf8"));
    if (!record(subjects) || !Object.values(subjects).every((value) => typeof value === "string"))
      throw new TypeError(
        "--subjects-file must map declaration names to explicitly reviewed expressions.",
      );
    options.subjects = subjects as Record<string, string>;
  }
  const result = migrateLegacyObjectiveDocument(
    parseStrictYaml(await readFile(input, "utf8")),
    format as MigrationFormat,
    options,
  );
  const bytes = output.endsWith(".json")
    ? `${JSON.stringify(result, null, 2)}\n`
    : stringify(result);
  await writeFile(output, bytes, { flag: "wx" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrateFiles(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
