#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  atomicWrite,
  CliError,
  commandMain,
  type GlobalOptions,
  loadConfig,
  type PguideConfig,
  parseConfig,
  readStdin,
  redactConfig,
  redactSensitive,
  userConfigPath,
  validateAgentProfile,
  writeResult,
} from "@potential-guide/cli-core";
import spawn from "cross-spawn";
import { parse, stringify } from "yaml";

function targetPath(scope: string, globals: GlobalOptions): string {
  if (scope === "user") return userConfigPath();
  if (scope === "project") return join(globals.cwd, ".pguide", "config.yaml");
  if (scope === "explicit" && globals.config !== undefined) return globals.config;
  throw new CliError("--scope must be user, project, or explicit (with --config).");
}

async function editable(path: string): Promise<PguideConfig> {
  try {
    return parseConfig(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 2 };
    throw error;
  }
}

function editorCommand(source: string): { command: string; args: string[] } {
  const parts = source.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (parts.length === 0) throw new CliError("VISUAL or EDITOR is invalid.");
  const unquote = (part: string) =>
    (part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))
      ? part.slice(1, -1)
      : part;
  return { command: unquote(parts[0] as string), args: parts.slice(1).map(unquote) };
}

async function run(argv: string[], globals: GlobalOptions): Promise<void> {
  const subcommand = argv[0];
  if (globals.help || subcommand === undefined) {
    const subcommands = [
      "show",
      "path",
      "validate",
      "edit",
      "get",
      "set",
      "unset",
      "list-agents",
      "show-agent",
      "add-agent",
      "update-agent",
      "remove-agent",
    ];
    writeResult(
      {
        schemaVersion: 1,
        command: "config",
        subcommands,
        configurationSchemaVersion: 2,
        regulationStrategyDefaults: {
          quota: { timeoutMs: 300000, maxAgentRuns: 10, maxStallRuns: 3 },
          probe: { timeoutMs: 30000, retry: { maxRetries: 0, delayMs: 0 } },
        },
      },
      globals.format,
      `Usage: pguide config <${subcommands.join("|")}>\nConfiguration schemaVersion: 2; regulationStrategy configures a single-run quota and probe timeout/retry. Scheduling belongs to supervisor.`,
    );
    return;
  }
  const loaded = await loadConfig(globals.cwd, globals.config);
  if (subcommand === "show") {
    writeResult(
      { schemaVersion: 1, config: redactConfig(loaded.value), sources: loaded.sources },
      globals.format,
      stringify(redactConfig(loaded.value)),
    );
    return;
  }
  if (subcommand === "path") {
    writeResult(
      { schemaVersion: 1, paths: loaded.paths },
      globals.format,
      Object.entries(loaded.paths)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
    );
    return;
  }
  if (subcommand === "validate") {
    writeResult(
      { schemaVersion: 1, status: "valid", paths: loaded.paths },
      globals.format,
      "Configuration is valid.",
    );
    return;
  }
  if (subcommand === "list-agents") {
    const agents = Object.entries(loaded.value.agents ?? {}).map(([name, profile]) => ({
      name,
      source: loaded.sources[`agents.${name}`],
      type: profile.type,
      protocolVersion: profile.connection.protocolVersion,
      transport: profile.transport.type,
    }));
    writeResult(
      { schemaVersion: 1, agents },
      globals.format,
      agents.map(({ name, source }) => `${name}\t${source}`).join("\n"),
    );
    return;
  }
  if (subcommand === "show-agent") {
    const name = argv[1];
    const profile = name === undefined ? undefined : loaded.value.agents?.[name];
    if (profile === undefined) throw new CliError(`Unknown Agent profile: ${name ?? ""}.`);
    const safeProfile = redactSensitive(profile);
    writeResult(
      { schemaVersion: 1, name, profile: safeProfile, source: loaded.sources[`agents.${name}`] },
      globals.format,
      stringify(safeProfile),
    );
    return;
  }
  if (subcommand === "get") {
    const key = argv[1];
    if (key === undefined) throw new CliError("get requires <key>.");
    const value = key
      .split(".")
      .reduce<unknown>(
        (current, part) =>
          current !== null && typeof current === "object"
            ? (current as Record<string, unknown>)[part]
            : undefined,
        loaded.value,
      );
    if (value === undefined) throw new CliError(`Unknown config key: ${key}.`);
    writeResult(
      { schemaVersion: 1, key, value },
      globals.format,
      typeof value === "object" ? stringify(value) : String(value),
    );
    return;
  }
  const scopeIndex = argv.indexOf("--scope");
  const scope = scopeIndex < 0 ? "project" : argv[scopeIndex + 1];
  if (scope === undefined) throw new CliError("--scope requires a value.");
  const path = targetPath(scope, globals);
  if (subcommand === "edit") {
    const editor = process.env.VISUAL ?? process.env.EDITOR;
    if (editor === undefined) throw new CliError("VISUAL or EDITOR is required for config edit.");
    const temporary = join(dirname(path), `.config.${process.pid}.${randomUUID()}.yaml.tmp`);
    const current = await editable(path);
    await atomicWrite(temporary, stringify(current));
    try {
      const parsed = editorCommand(editor);
      await new Promise<void>((resolveEditor, rejectEditor) => {
        const child = spawn(parsed.command, [...parsed.args, temporary], {
          cwd: globals.cwd,
          stdio: "inherit",
          shell: false,
        });
        child.on("error", rejectEditor);
        child.on("close", (code) => {
          if (code === 0) resolveEditor();
          else rejectEditor(new CliError(`Editor exited ${String(code)}.`));
        });
      });
      const validated = parseConfig(await readFile(temporary, "utf8"));
      await atomicWrite(path, stringify(validated));
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return;
  }
  const config = await editable(path);
  if (subcommand === "add-agent" || subcommand === "update-agent") {
    const name = argv[1];
    const sourcePath = argv[2];
    if (name === undefined || sourcePath === undefined)
      throw new CliError(`${subcommand} requires <name> <source>.`);
    const exists = config.agents?.[name] !== undefined;
    if (subcommand === "add-agent" && exists) throw new CliError(`Agent already exists: ${name}.`);
    if (subcommand === "update-agent" && !exists)
      throw new CliError(`Agent does not exist: ${name}.`);
    const source =
      sourcePath === "-"
        ? await readStdin()
        : await readFile(resolve(globals.cwd, sourcePath), "utf8");
    config.agents = { ...config.agents, [name]: validateAgentProfile(parse(source)) };
  } else if (subcommand === "remove-agent") {
    const name = argv[1];
    if (name === undefined || config.agents?.[name] === undefined)
      throw new CliError(`Agent does not exist: ${name ?? ""}.`);
    const agents = { ...config.agents };
    delete agents[name];
    config.agents = agents;
  } else if (subcommand === "set") {
    const key = argv[1];
    const source = argv[2];
    if (key === undefined || source === undefined || key.includes("."))
      throw new CliError("set requires a top-level <key> <value>.");
    (config as unknown as Record<string, unknown>)[key] = parse(source);
  } else if (subcommand === "unset") {
    const key = argv[1];
    if (key === undefined || key === "schemaVersion" || key.includes("."))
      throw new CliError("unset requires a removable top-level <key>.");
    delete (config as unknown as Record<string, unknown>)[key];
  } else {
    throw new CliError(`Unknown config subcommand: ${subcommand}.`);
  }
  await atomicWrite(path, stringify(parseConfig(stringify(config))));
  writeResult({ schemaVersion: 1, status: "updated", path }, globals.format, `Updated ${path}.`);
}

void commandMain(
  {
    protocol: "pguide-command-v1",
    command: "config",
    description: "Manage pguide configuration",
    version: "0.2.0-rc.0",
  },
  run,
);
