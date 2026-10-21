#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  atomicWrite,
  CliError,
  commandMain,
  editConfig,
  type GlobalOptions,
  inspectSettings,
  loadConfig,
  loadSettingsCatalog,
  markdownCodeBlock,
  markdownInlineCode,
  markdownText,
  parseConfig,
  parseJsonc,
  redactConfig,
  registerSettingsPackage,
  rejectLegacyConfig,
  requireSettings,
  setting,
  settingsPackagesPath,
  unregisterSettingsPackage,
  userConfigPath,
  writeResult,
} from "@potential-guide/cli-core";
import spawn from "cross-spawn";
import { configHelp, configHelpSpec, configSubcommands } from "./help.js";

function targetPath(scope: string, globals: GlobalOptions): string {
  if (scope === "user") return userConfigPath();
  if (scope === "project") return join(globals.cwd, ".pguide", "config.jsonc");
  throw new CliError(
    "--scope must be user or project. The explicit scope and --config are retired.",
  );
}

async function editable(path: string): Promise<string> {
  await rejectLegacyConfig(path);
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "{}\n";
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
  const separator = argv.indexOf("--");
  const options = separator < 0 ? argv : argv.slice(0, separator);
  if (
    options.includes("--scope=explicit") ||
    options.some((entry, index) => entry === "--scope" && options[index + 1] === "explicit")
  )
    throw new CliError(
      "--scope explicit is retired. Use --scope user|project and config.jsonc discovery.",
    );
  if (globals.help || subcommand === undefined) {
    writeResult(
      {
        schemaVersion: 1,
        command: "config",
        subcommands: configSubcommands,
        configurationFormat: "jsonc",
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
  if (subcommand === "packages") {
    const action = argv[1];
    const root = argv[2];
    if (action === "path") {
      writeResult(
        { schemaVersion: 1, path: settingsPackagesPath() },
        globals.format,
        settingsPackagesPath(),
      );
      return;
    }
    if (!root || !["register", "unregister"].includes(action ?? ""))
      throw new CliError(
        "Use config packages register|unregister <package-root>, or config packages path. Registration does not install or execute a package.",
      );
    if (action === "register") await registerSettingsPackage(resolve(globals.cwd, root));
    else await unregisterSettingsPackage(resolve(globals.cwd, root));
    writeResult(
      { schemaVersion: 1, status: action, path: settingsPackagesPath() },
      globals.format,
      `# Settings package ${action === "register" ? "registered" : "unregistered"}\n\n${markdownInlineCode(root)}`,
    );
    return;
  }
  const loaded = await loadConfig(globals.cwd, []);
  if (subcommand === "show") {
    writeResult(
      {
        schemaVersion: 1,
        config: redactConfig(loaded.value),
        sources: loaded.sources,
        files: loaded.files,
        issues: loaded.issues,
        unverified: loaded.unverified,
      },
      globals.format,
      [
        "# Effective configuration",
        "Values merge user → nearest project by complete ID; objects and arrays replace as a whole. Static defaults apply only to missing settings.",
        markdownCodeBlock(JSON.stringify(redactConfig(loaded.value), null, 2), "json"),
        ...loaded.issues.map(
          (issue) =>
            `- Invalid ${markdownInlineCode(issue.id)} (${markdownInlineCode(issue.source)}): ${markdownText(issue.message)}`,
        ),
        ...loaded.unverified.map(
          (issue) =>
            `- Unverified ${markdownInlineCode(issue.id)} (${markdownInlineCode(issue.source)})`,
        ),
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
    requireSettings(loaded);
    const unverified = loaded.unverified.length > 0;
    writeResult(
      {
        schemaVersion: 1,
        status: unverified ? "unverified" : "valid",
        paths: loaded.paths,
        unverified: loaded.unverified,
      },
      globals.format,
      `# Configuration ${unverified ? "partially unverified" : "valid"}\n\nKnown settings passed offline validation; ${unverified ? "unknown namespaces remain unverified. " : ""}Agent initialization, authentication and repair were not checked.\n\n${Object.entries(
        loaded.paths,
      )
        .map(([key, value]) => `- ${key}: ${value ? markdownInlineCode(value) : "not selected"}`)
        .join("\n")}`,
    );
    return;
  }
  if (subcommand === "list-objectives") {
    requireSettings(loaded, ["objectives"]);
    const objectives = Object.entries(
      setting<Record<string, string>>(loaded.value, "objectives.aliases") ?? {},
    ).map(([name, location]) => ({
      name,
      location,
      semantics: "legacy-source-alias",
      source: loaded.sources["objectives.aliases"],
    }));
    writeResult(
      {
        schemaVersion: 1,
        objectives,
      },
      globals.format,
      `# Legacy Objective source aliases\n\n- Context: ${markdownInlineCode(globals.cwd)}\n- Scope: effective user and nearest project configuration\n\n${
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
    requireSettings(loaded, [key.split(".")[0] as string]);
    const value = loaded.value[key];
    if (value === undefined) throw new CliError(`Unknown config key: ${key}.`);
    writeResult(
      { schemaVersion: 1, key, value },
      globals.format,
      typeof value === "object" ? JSON.stringify(value, null, 2) : String(value),
    );
    return;
  }
  const scopeIndex = argv.indexOf("--scope");
  const scope = scopeIndex < 0 ? "project" : argv[scopeIndex + 1];
  if (scope === undefined) throw new CliError("--scope requires a value.");
  const path = targetPath(scope, globals);
  const catalog = await loadSettingsCatalog();
  const validateWrite = (source: string) => {
    const result = inspectSettings(parseConfig(source), path, catalog);
    const issues = [...loaded.issues.filter((issue) => issue.source !== path), ...result.issues];
    if (issues.length)
      throw new CliError("Invalid configuration; original file was not changed.", 2, "invalid", {
        issues,
      });
    for (const issue of result.unverified)
      process.stderr.write(`Warning: unverified setting ${issue.id} (${issue.source}).\n`);
  };
  if (subcommand === "edit") {
    const editor = process.env.VISUAL ?? process.env.EDITOR;
    if (editor === undefined) throw new CliError("VISUAL or EDITOR is required for config edit.");
    const temporary = join(dirname(path), `.config.${process.pid}.${randomUUID()}.jsonc`);
    const current = await editable(path);
    await atomicWrite(temporary, current);
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
      const validated = await readFile(temporary, "utf8");
      validateWrite(validated);
      await atomicWrite(path, validated);
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
  const sourceText = await editable(path);
  const config = parseConfig(sourceText);
  let next: string;
  if (subcommand === "add-objective" || subcommand === "update-objective") {
    throw new CliError(
      "Legacy source-alias writes are retired. Use pguide objectives set or migrate with an explicit inputSchema and subject. Existing aliases remain readable and removable; no binding is guessed.",
    );
  } else if (subcommand === "remove-objective") {
    const name = argv[1];
    if (
      name === undefined ||
      config["objectives.aliases"] === undefined ||
      !Object.hasOwn(config["objectives.aliases"] as object, name)
    )
      throw new CliError(`Objective does not exist in this scope: ${name ?? ""}.`);
    const aliases = { ...(config["objectives.aliases"] as Record<string, string>) };
    delete aliases[name];
    next = editConfig(sourceText, "objectives.aliases", aliases);
  } else if (subcommand === "set") {
    const key = argv[1];
    const source = argv[2];
    if (key === undefined || source === undefined)
      throw new CliError("set requires a complete <namespace.setting> <JSONC-value>.");
    next = editConfig(sourceText, key, parseJsonc(source));
  } else if (subcommand === "unset") {
    const key = argv[1];
    if (key === undefined || !key.includes("."))
      throw new CliError("unset requires a complete <namespace.setting>.");
    next = editConfig(sourceText, key, undefined);
  } else {
    throw new CliError(`Unknown config subcommand: ${subcommand}.`);
  }
  validateWrite(next);
  await atomicWrite(path, next);
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
