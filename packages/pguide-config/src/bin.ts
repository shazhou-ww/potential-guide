#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  atomicWrite,
  CliError,
  commandMain,
  type GlobalOptions,
  loadConfig,
  markdownCodeBlock,
  markdownInlineCode,
  markdownText,
  type PguideConfig,
  parseConfig,
  redactConfig,
  userConfigPath,
  writeResult,
} from "@potential-guide/cli-core";
import spawn from "cross-spawn";
import { parse, stringify } from "yaml";
import { configHelp, configHelpSpec, configSubcommands } from "./help.js";

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
    writeResult(
      {
        schemaVersion: 1,
        command: "config",
        subcommands: configSubcommands,
        configurationSchemaVersion: 2,
        ...configHelpSpec(subcommand),
        regulationStrategyDefaults: {
          quota: { timeoutMs: 300000, maxAgentRuns: 10, maxStallRuns: 3 },
          probe: { timeoutMs: 30000, retry: { maxRetries: 0, delayMs: 0 } },
        },
      },
      globals.format,
      configHelp(subcommand),
    );
    return;
  }
  if (
    ["list-agents", "show-agent", "add-agent", "update-agent", "remove-agent"].includes(subcommand)
  ) {
    throw new CliError(
      "Agent commands moved to pguide agents list|show|set|remove. Embedded profiles are rejected; run pguide agents migrate --scope user|project explicitly.",
    );
  }
  const loaded = await loadConfig(globals.cwd, globals.config);
  if (subcommand === "show") {
    writeResult(
      { schemaVersion: 1, config: redactConfig(loaded.value), sources: loaded.sources },
      globals.format,
      [
        "# Effective configuration",
        "Values merge user → nearest project → explicit configuration; later layers override earlier ones.",
        markdownCodeBlock(stringify(redactConfig(loaded.value)), "yaml"),
        "## Sources",
        Object.keys(loaded.sources).length === 0
          ? "No configured values have file provenance; defaults apply."
          : Object.entries(loaded.sources)
              .map(([key, source]) => `- ${markdownInlineCode(key)}: ${markdownInlineCode(source)}`)
              .join("\n"),
      ].join("\n\n"),
    );
    return;
  }
  if (subcommand === "path") {
    writeResult(
      { schemaVersion: 1, paths: loaded.paths },
      globals.format,
      `# Configuration paths\n\n${Object.entries(loaded.paths)
        .map(([key, value]) => `- ${key}: ${value ? markdownInlineCode(value) : "not selected"}`)
        .join("\n")}`,
    );
    return;
  }
  if (subcommand === "validate") {
    writeResult(
      { schemaVersion: 1, status: "valid", paths: loaded.paths },
      globals.format,
      `# Configuration valid\n\nConfiguration is valid. Offline validation succeeded; Agent initialization, authentication and repair were not checked.\n\n${Object.entries(
        loaded.paths,
      )
        .map(([key, value]) => `- ${key}: ${value ? markdownInlineCode(value) : "not selected"}`)
        .join("\n")}`,
    );
    return;
  }
  if (subcommand === "list-objectives") {
    const objectives = Object.entries(loaded.value.objectives ?? {}).map(([name, location]) => ({
      name,
      location,
      semantics: "legacy-source-alias",
      source: loaded.sources[`objectives.${name}`],
    }));
    writeResult(
      {
        schemaVersion: 1,
        objectives,
      },
      globals.format,
      `# Legacy Objective source aliases\n\n- Context: ${markdownInlineCode(globals.cwd)}\n- Scope: effective user, nearest project and explicit configuration\n\n${
        objectives.length === 0
          ? "No registered Objectives. No legacy source aliases were found. Use `pguide objectives list` for declarations or `pguide objectives set --help` to add one."
          : objectives
              .map(
                ({ name, location, source }) =>
                  `- Name: ${markdownInlineCode(name)} (legacy source alias)\n  - Location: ${markdownInlineCode(location)}\n  - Source: ${source ? markdownInlineCode(source) : "not recorded"}`,
              )
              .join("\n\n")
      }`,
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
          stdio: globals.format === "json" ? ["inherit", process.stderr, "inherit"] : "inherit",
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
    writeResult(
      { schemaVersion: 1, status: "updated", path },
      globals.format,
      `# Configuration saved\n\n- Action: edit\n- Scope: ${scope}\n- File: ${markdownInlineCode(path)}`,
    );
    return;
  }
  const config = await editable(path);
  if (subcommand === "add-objective" || subcommand === "update-objective") {
    throw new CliError(
      "Legacy source-alias writes are retired. Use pguide objectives set or migrate with an explicit inputSchema and subject. Existing aliases remain readable and removable; no binding is guessed.",
    );
  } else if (subcommand === "remove-objective") {
    const name = argv[1];
    if (
      name === undefined ||
      config.objectives === undefined ||
      !Object.hasOwn(config.objectives, name)
    )
      throw new CliError(`Objective does not exist in this scope: ${name ?? ""}.`);
    delete config.objectives[name];
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
  writeResult(
    { schemaVersion: 1, status: "updated", path },
    globals.format,
    `# Configuration updated\n\n- Action: ${markdownText(subcommand)}\n- ${subcommand === "remove-objective" ? "Name" : "Key"}: ${markdownInlineCode(argv[1] ?? "")}\n- Scope: ${scope}\n- File: ${markdownInlineCode(path)}`,
  );
}

void commandMain(
  {
    protocol: "pguide-command-v1",
    command: "config",
    description: "Manage pguide configuration",
    version: "0.3.0-rc.0",
  },
  run,
);
