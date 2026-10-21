import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  atomicWrite,
  CliError,
  type GlobalOptions,
  type LegacyPguideConfig,
  loadConfig,
  markdownCodeBlock,
  markdownInlineCode,
  markdownText,
  option,
  parseLegacyConfig,
  rejectUnknownOptions,
  setting,
  writeResult,
} from "@potential-guide/cli-core";
import {
  listObjectives,
  objectivesPath,
  parseObjectives,
  readObjectiveEntries,
} from "@potential-guide/objective-declarations";

const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
export async function runObjectives(argv: string[], globals: GlobalOptions): Promise<void> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "objectives" },
      globals.format,
      "pguide objectives list|show <name> [--scope user|directory]\npguide objectives set|remove|migrate <name> --scope user|directory [--from <declaration.yaml>] [--legacy-config <config.yaml>]\nRead-only discovery never binds Pilots, evaluates subject or resolves remote versions. Writes require an explicit scope; --from contains one complete objectives.yaml entry with the selected name.",
    );
    return;
  }
  rejectUnknownOptions(
    argv,
    { "--scope": "value", "--from": "value", "--legacy-config": "value" },
    2,
  );
  const command = argv[0];
  const name = argv[1];
  const scope = option(argv, "--scope") as string | undefined;
  if (command === "list" || command === "show") {
    if (command === "show" && !text(name))
      throw new CliError(
        "show requires an Objective name. Run pguide objectives list to find declarations.",
      );
    const entries = (await listObjectives(globals.cwd, scope)).filter(
      (entry) => command === "list" || entry.name === name,
    );
    if (command === "show" && entries.length === 0)
      throw new CliError(
        `Objective ${name} was not found in ${scope ?? "user and directory"} scope. Run pguide objectives list${scope ? ` --scope ${scope}` : ""} to find declarations; legacy source aliases are not declarations.`,
      );
    if (command === "show" && entries.length > 1)
      throw new CliError(
        `Objective ${name} is ambiguous: ${entries.map((entry) => `${entry.scope} (${entry.file})`).join("; ")}. Select one with pguide objectives show ${name} --scope user|directory.`,
      );
    const config = await loadConfig(globals.cwd, ["objectives"]);
    const legacyAliases = Object.entries(
      setting<Record<string, string>>(config.value, "objectives.aliases") ?? {},
    ).map(([alias, objective]) => ({
      name: alias,
      objective,
      semantics: "legacy-source-alias",
      file: config.sources["objectives.aliases"],
    }));
    writeResult(
      {
        schemaVersion: 1,
        objectives: entries,
        legacyAliases,
      },
      globals.format,
      [
        command === "show" ? `# Objective ${markdownInlineCode(name ?? "")}` : "# Objectives",
        `- Scope: ${markdownText(scope ?? "user and directory")}\n- Context: ${markdownInlineCode(globals.cwd)}`,
        ...(entries.length === 0
          ? [
              "No Objective declarations found. Use `pguide objectives set <name> --scope user|directory --from <file>` to add a declaration.",
            ]
          : entries.map((entry) =>
              [
                ...(command === "list" ? [`## ${markdownInlineCode(entry.name)}`] : []),
                ...(entry.description ? [`- Description: ${markdownText(entry.description)}`] : []),
                `- Scope: ${entry.scope}\n- Source: ${markdownInlineCode(entry.file)}`,
                ...(command === "show"
                  ? [
                      `- Objective source: ${markdownInlineCode(entry.objective)}`,
                      `- Revision: ${markdownInlineCode(entry.revision)}`,
                      `## Input schema\n\n${markdownCodeBlock(JSON.stringify(entry.inputSchema, null, 2), "json")}`,
                      `## Subject\n\n${markdownCodeBlock(entry.subject, "text")}`,
                    ]
                  : []),
              ].join("\n\n"),
            )),
        ...(legacyAliases.length > 0
          ? [
              "## Legacy source aliases",
              "These aliases are not Objective declarations and are not selected by `objectives show`.",
              ...legacyAliases.map(
                (alias) =>
                  `- Name: ${markdownInlineCode(alias.name)}; semantics: legacy-source-alias\n  - Location: ${markdownInlineCode(alias.objective)}\n  - Source: ${alias.file ? markdownInlineCode(alias.file) : "not recorded"}`,
              ),
            ]
          : []),
      ].join("\n\n"),
    );
    return;
  }
  if (!["set", "remove", "migrate"].includes(command ?? "") || !text(name) || scope === undefined)
    throw new CliError("Expected set|remove|migrate <name> --scope user|directory; see --help.");
  const file = objectivesPath(scope, globals.cwd);
  const { entries } = await readObjectiveEntries(file);
  let legacy: { path: string; config: LegacyPguideConfig } | undefined;
  if (command === "remove") {
    if (!Object.hasOwn(entries, name))
      throw new CliError(
        `Objective ${name} was not found in ${scope} scope (${file}). Run pguide objectives list --scope ${scope} to find declarations.`,
      );
    delete entries[name];
  } else {
    const from = option(argv, "--from", { required: true }) as string;
    const candidate = parseObjectives(await readFile(resolve(globals.cwd, from), "utf8"));
    const selected = candidate[name];
    if (Object.keys(candidate).length !== 1 || selected === undefined)
      throw new CliError(
        "--from must declare exactly the selected Objective with subject; omitted inputSchema defaults to Unit.",
      );
    entries[name] = selected;
    if (command === "migrate") {
      if (Object.hasOwn((await readObjectiveEntries(file)).entries, name))
        throw new CliError("Migration destination already exists.");
      const path = resolve(
        globals.cwd,
        option(argv, "--legacy-config", { required: true }) as string,
      );
      const config = parseLegacyConfig(await readFile(path, "utf8"));
      if (!config.objectives || !Object.hasOwn(config.objectives, name))
        throw new CliError("No matching legacy source alias in --legacy-config.");
      delete config.objectives[name];
      if (Object.keys(config.objectives).length === 0) delete config.objectives;
      legacy = { path, config };
    }
  }
  const source = `${JSON.stringify({ $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json", objectives: entries }, null, 2)}\n`;
  parseObjectives(source);
  await atomicWrite(file, source);
  if (legacy !== undefined)
    await atomicWrite(legacy.path, `${JSON.stringify(legacy.config, null, 2)}\n`);
  writeResult(
    { schemaVersion: 1, status: command, file, name },
    globals.format,
    `# Objective ${command === "remove" ? "removed" : command === "migrate" ? "migrated" : "saved"}\n\n- Name: ${markdownInlineCode(name)}\n- Scope: ${scope}\n- File: ${markdownInlineCode(file)}${legacy ? `\n- Legacy source updated: ${markdownInlineCode(legacy.path)}` : ""}`,
  );
}
