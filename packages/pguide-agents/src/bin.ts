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
  markdownCodeBlock,
  markdownInlineCode,
  markdownText,
  migrateAgents,
  option,
  parseAgents,
  readStdin,
  redactAgentValue,
  resourceText,
  showCommandHelp,
  validateAgentName,
  withResourceLocks,
  writeAgents,
  writeResult,
} from "@potential-guide/cli-core";
import spawn from "cross-spawn";
import { parseDocument, stringify } from "yaml";

async function run(argv: string[], globals: GlobalOptions): Promise<void> {
  const command = argv[0];
  if (globals.help || command === undefined) {
    showCommandHelp("agents", globals, argv[0]);
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
    writeResult(
      { schemaVersion: 1, paths },
      globals.format,
      `# Agent resource paths\n\n${Object.entries(paths)
        .map(([scope, path]) => `- ${scope}: ${markdownInlineCode(path)}`)
        .join("\n")}`,
    );
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
        throw new CliError(
          `Agent profile ${name ?? ""} was not found in user or project resources. Run pguide agents list to find effective profiles.`,
        );
      writeResult(
        { schemaVersion: 1, name, ...agents[name] },
        globals.format,
        `# Agent ${markdownInlineCode(name)}\n\n- Type: ${loaded.agents[name]?.type}\n- Scope: ${loaded.sources[name]?.scope}\n- Source: ${markdownInlineCode(loaded.sources[name]?.path ?? "")}\n\n## Profile (redacted)\n\n${markdownCodeBlock(stringify(agents[name]?.profile), "yaml")}`,
      );
    } else
      writeResult(
        { schemaVersion: 1, status: "valid", agents, paths: loaded.paths },
        globals.format,
        [
          command === "validate" ? "# Agent resources valid" : "# Agents",
          `- Context: ${markdownInlineCode(globals.cwd)}\n- Scopes: user and project (project profiles replace same-name user profiles)\n${Object.entries(
            loaded.paths,
          )
            .map(([scope, path]) => `- ${scope} file: ${markdownInlineCode(path)}`)
            .join("\n")}`,
          ...(Object.keys(agents).length === 0
            ? [
                "No Agent profiles found. Use `pguide agents set <name> --from <profile.yaml> --scope user|project` to add a profile.",
              ]
            : Object.entries(loaded.agents).map(
                ([name, profile]) =>
                  `- Name: ${markdownInlineCode(name)}\n  - Type: ${markdownText(profile.type)}\n  - Scope: ${loaded.sources[name]?.scope}\n  - Source: ${markdownInlineCode(loaded.sources[name]?.path ?? "")}`,
              )),
          ...(command === "validate"
            ? [
                "Offline resource validation succeeded. Agent initialization, authentication and repair were not checked.",
              ]
            : []),
        ].join("\n\n"),
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
    writeResult(
      { schemaVersion: 1, ...result },
      globals.format,
      `# Agent profiles migrated\n\n- Names: ${result.names.map(markdownInlineCode).join(", ")}\n- Scope: ${scope}\n- Source: ${markdownInlineCode(result.source)}\n- Destination: ${markdownInlineCode(result.destination)}\n- Backup: ${markdownInlineCode(result.backup)}`,
    );
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
            stdio: globals.format === "json" ? ["inherit", process.stderr, "inherit"] : "inherit",
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
          throw new CliError(
            `Agent ${name} was not found in ${scope} scope (${path}). Run pguide agents list to inspect effective profiles; remove only affects the selected scope.`,
          );
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
    `# Agent ${command === "remove" ? "removed" : "saved"}\n\n- Action: ${command}\n- ${command === "edit" ? "Target: resource file" : `Name: ${markdownInlineCode(positional[0] ?? "")}`}\n- Scope: ${scope}\n- File: ${markdownInlineCode(path)}`,
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
