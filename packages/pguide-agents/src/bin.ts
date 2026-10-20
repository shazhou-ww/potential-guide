#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  AGENTS_SCHEMA,
  agentsPaths,
  atomicWrite,
  CliError,
  commandMain,
  emptyAgents,
  type GlobalOptions,
  loadAgents,
  migrateAgents,
  option,
  parseAgents,
  readStdin,
  redactAgentValue,
  resourceText,
  validateAgentName,
  withResourceLocks,
  writeAgents,
  writeResult,
} from "@potential-guide/cli-core";
import spawn from "cross-spawn";
import { parseDocument, stringify } from "yaml";

const help = `Usage: pguide agents list|show|set|remove|edit|validate|path|migrate [name]

  list / show <name>       Effective profiles with scope and file provenance
  set <name> --from <file|->  Validate and replace a whole profile
  remove <name>            Remove only from the selected scope
  edit                     Edit a validated draft; failed edits preserve the original
  validate / path          Validate resources / show their locations
  migrate                  Move embedded profiles, preserving a source backup

Writes require --scope user|project. migrate accepts --legacy-config <file>
only for the main config beside that scope's agents.yaml. --config selects a
main configuration, never a third agents scope. Project profiles replace entire
same-name user profiles. Profiles contain credential references, never secrets.

Examples:
  pguide agents set local --from profile.yaml --scope project
  pguide agents migrate --scope user

Global options:
  --cwd <directory> Configuration and resource discovery context
  --config <path> Main config overlay only; never an Agent scope
  --format markdown|json
  --color auto|always|never
  --log-level error|warn|info|debug
  --help
  --version`;

async function run(argv: string[], globals: GlobalOptions): Promise<void> {
  const command = argv[0];
  if (globals.help || command === undefined) {
    writeResult(
      {
        schemaVersion: 1,
        command: "agents",
        subcommands: ["list", "show", "set", "remove", "edit", "validate", "path", "migrate"],
        resourceSchema: AGENTS_SCHEMA,
      },
      globals.format,
      help,
    );
    return;
  }
  const allowed = new Set(
    command === "set"
      ? ["--scope", "--from"]
      : command === "migrate"
        ? ["--scope", "--legacy-config"]
        : command === "remove" || command === "edit"
          ? ["--scope"]
          : [],
  );
  const seen = new Set<string>();
  const positional: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument.startsWith("--")) {
      if (!allowed.has(argument) || seen.has(argument))
        throw new CliError(`Unexpected or repeated option: ${argument}.`);
      seen.add(argument);
      const value = argv[++index];
      if (value === undefined || value.startsWith("--"))
        throw new CliError(`${argument} requires a value.`);
    } else positional.push(argument);
  }
  const expected = ["show", "set", "remove"].includes(command) ? 1 : 0;
  if (positional.length !== expected)
    throw new CliError(
      `${command} requires ${expected === 1 ? "exactly one Agent name" : "no positional arguments"}.`,
    );
  if (command === "path") {
    const paths = await agentsPaths(globals.cwd);
    writeResult({ schemaVersion: 1, paths }, globals.format, stringify(paths));
    return;
  }
  if (["list", "show", "validate"].includes(command)) {
    const loaded = await loadAgents(globals.cwd);
    const agents = Object.fromEntries(
      Object.entries(loaded.agents).map(([name, profile]) => [
        name,
        { profile: redactAgentValue(profile, profile), source: loaded.sources[name] },
      ]),
    );
    if (command === "show") {
      const name = positional[0];
      if (name === undefined || !Object.hasOwn(agents, name))
        throw new CliError(`Unknown Agent profile: ${name ?? ""}.`);
      writeResult(
        { schemaVersion: 1, name, ...agents[name] },
        globals.format,
        stringify(agents[name]),
      );
    } else
      writeResult(
        { schemaVersion: 1, status: "valid", agents, paths: loaded.paths },
        globals.format,
        command === "validate" ? "Agents resources are valid." : stringify(agents),
      );
    return;
  }
  if (!["set", "remove", "edit", "migrate"].includes(command))
    throw new CliError(`Unknown agents command: ${command}.`);
  const scope = option(argv, "--scope");
  if (scope !== "user" && scope !== "project")
    throw new CliError("Writes require --scope user|project.");
  if (command === "migrate") {
    const source = option(argv, "--legacy-config");
    const result = await migrateAgents(
      globals.cwd,
      scope,
      typeof source === "string" ? resolve(globals.cwd, source) : undefined,
    );
    writeResult({ schemaVersion: 1, ...result }, globals.format, stringify(result));
    return;
  }
  const path = (await agentsPaths(globals.cwd))[scope];
  await withResourceLocks([path], async () => {
    const before = await resourceText(path);
    let file = before === undefined ? emptyAgents() : parseAgents(before);
    if (command === "edit") {
      const editor = process.env.VISUAL ?? process.env.EDITOR;
      if (!editor) throw new CliError("VISUAL or EDITOR is required for agents edit.");
      const parts = editor.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
      const unquote = (part: string) => part.replace(/^(["'])(.*)\1$/, "$2");
      const executable = parts.shift();
      if (!executable) throw new CliError("Invalid editor.");
      const draft = join(dirname(path), `.agents.${randomUUID()}.yaml`);
      await atomicWrite(draft, before ?? stringify(file));
      try {
        await new Promise<void>((done, fail) => {
          const child = spawn(unquote(executable), [...parts.map(unquote), draft], {
            cwd: globals.cwd,
            stdio: "inherit",
            shell: false,
          });
          child.on("error", fail);
          child.on("close", (code) =>
            code === 0 ? done() : fail(new CliError(`Editor exited ${String(code)}.`)),
          );
        });
        file = parseAgents(await readFile(draft, "utf8"));
      } finally {
        await unlink(draft);
      }
    } else {
      const name = positional[0];
      if (!name) throw new CliError(`${command} requires a name.`);
      validateAgentName(name);
      if (command === "remove") {
        if (!Object.hasOwn(file.agents, name))
          throw new CliError(`Agent not found in ${scope} scope: ${name}.`);
        delete file.agents[name];
      } else {
        const from = option(argv, "--from");
        if (typeof from !== "string") throw new CliError("set requires --from <profile.yaml|->.");
        const source =
          from === "-" ? await readStdin() : await readFile(resolve(globals.cwd, from), "utf8");
        const document = parseDocument(source, { uniqueKeys: true });
        if (document.errors.length) throw new CliError("Invalid profile YAML.");
        const profiles = parseAgents(
          stringify({
            $schema: AGENTS_SCHEMA,
            agents: { [name]: document.toJS({ maxAliasCount: 100 }) },
          }),
        ).agents;
        file.agents = { ...file.agents, ...profiles };
      }
    }
    await writeAgents(path, file, before);
  });
  writeResult(
    { schemaVersion: 1, status: "written", path, scope },
    globals.format,
    `${scope}: ${path}`,
  );
}
await commandMain(
  {
    protocol: "pguide-command-v1",
    command: "agents",
    description: "Manage independent user and project Agent resources",
    version: "0.1.0",
  },
  run,
);
