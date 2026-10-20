import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  atomicWrite,
  CliError,
  type GlobalOptions,
  loadConfig,
  option,
  type PguideConfig,
  parseConfig,
  rejectUnknownOptions,
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
    const entries = (await listObjectives(globals.cwd, scope)).filter(
      (entry) => command === "list" || entry.name === name,
    );
    if (command === "show" && entries.length !== 1)
      throw new CliError("show requires one unambiguous name; specify --scope.");
    const config = await loadConfig(globals.cwd, globals.config);
    const legacyAliases = Object.entries(config.value.objectives ?? {}).map(([alias, pilot]) => ({
      name: alias,
      pilot,
      semantics: "legacy-source-alias",
      file: config.sources[`objectives.${alias}`],
    }));
    writeResult(
      { schemaVersion: 1, objectives: entries, legacyAliases },
      globals.format,
      JSON.stringify({ objectives: entries, legacyAliases }, null, 2),
    );
    return;
  }
  if (!["set", "remove", "migrate"].includes(command ?? "") || !text(name) || scope === undefined)
    throw new CliError("Expected set|remove|migrate <name> --scope user|directory; see --help.");
  const file = objectivesPath(scope, globals.cwd);
  const { entries } = await readObjectiveEntries(file);
  let legacy: { path: string; config: PguideConfig } | undefined;
  if (command === "remove") {
    if (!Object.hasOwn(entries, name)) throw new CliError(`Unknown Objective ${name}.`);
    delete entries[name];
  } else {
    const from = option(argv, "--from", { required: true }) as string;
    const candidate = parseObjectives(await readFile(resolve(globals.cwd, from), "utf8"));
    const selected = candidate[name];
    if (Object.keys(candidate).length !== 1 || selected === undefined)
      throw new CliError(
        "--from must declare exactly the selected Objective, with explicit inputSchema and subject.",
      );
    entries[name] = selected;
    if (command === "migrate") {
      if (Object.hasOwn((await readObjectiveEntries(file)).entries, name))
        throw new CliError("Migration destination already exists.");
      const path = resolve(
        globals.cwd,
        option(argv, "--legacy-config", { required: true }) as string,
      );
      const config = parseConfig(await readFile(path, "utf8"));
      if (!config.objectives || !Object.hasOwn(config.objectives, name))
        throw new CliError("No matching legacy source alias in --legacy-config.");
      delete config.objectives[name];
      if (Object.keys(config.objectives).length === 0) delete config.objectives;
      legacy = { path, config };
    }
  }
  const source = `${JSON.stringify({ schemaVersion: 1, objectives: entries }, null, 2)}\n`;
  parseObjectives(source);
  await atomicWrite(file, source);
  if (legacy !== undefined)
    await atomicWrite(legacy.path, `${JSON.stringify(legacy.config, null, 2)}\n`);
  writeResult(
    { schemaVersion: 1, status: command, file, name },
    globals.format,
    `${command}: ${name} (${file})`,
  );
}
