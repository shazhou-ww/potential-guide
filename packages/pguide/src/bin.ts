#!/usr/bin/env node
import { readdir, realpath, stat } from "node:fs/promises";
import { delimiter, extname, join, resolve } from "node:path";
import {
  AcpClient,
  CliError,
  type CommandMetadata,
  expectedCliError,
  extractGlobals,
  formatCommandHelp,
  type GlobalOptions,
  inspectAhp,
  loadConfig,
  option,
  writeResult,
} from "@potential-guide/cli-core";
import spawn from "cross-spawn";
import { commandDescriptions } from "./command-help.js";
import { sameDirectory } from "./path.js";

const VERSION = "0.4.0-rc.0";
const reserved = new Set(["diagnose", "complete"]);
const commandPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

interface Candidate {
  command: string;
  path: string;
  source: "configured" | "PATH";
  metadata?: CommandMetadata;
}

function executableName(name: string): string | undefined {
  const extension = extname(name).toLowerCase();
  if (process.platform === "win32" && ![".cmd", ".exe", ".bat", ".com"].includes(extension)) {
    return undefined;
  }
  const base =
    process.platform === "win32" && [".cmd", ".exe", ".bat", ".com"].includes(extension)
      ? name.slice(0, -extension.length)
      : name;
  if (!base.startsWith("pguide-")) return undefined;
  const command = base.slice("pguide-".length);
  return commandPattern.test(command) ? command : undefined;
}

async function directoryCandidates(
  directory: string,
  source: Candidate["source"],
): Promise<Candidate[]> {
  const result: Candidate[] = [];
  try {
    for (const name of await readdir(directory)) {
      const command = executableName(name);
      if (command === undefined || reserved.has(command)) continue;
      const path = join(directory, name);
      if (!(await stat(path)).isFile()) continue;
      result.push({ command, path: await realpath(path), source });
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && !(source === "PATH" && (code === "EACCES" || code === "EPERM")))
      throw error;
  }
  return result;
}

async function discover(
  globals: GlobalOptions,
): Promise<{ commands: Candidate[]; conflicts: Record<string, string[]> }> {
  const config = await loadConfig(globals.cwd, globals.config);
  const configured = (
    await Promise.all(
      (config.value.commandDirectories ?? []).map((path) =>
        directoryCandidates(resolve(globals.cwd, path), "configured"),
      ),
    )
  ).flat();
  const pathDirectories: string[] = [];
  for (const path of (process.env.PATH ?? "").split(delimiter)) {
    if (path !== "" && !(await sameDirectory(path, globals.cwd))) pathDirectories.push(path);
  }
  const fromPath = (
    await Promise.all(pathDirectories.map((path) => directoryCandidates(path, "PATH")))
  ).flat();
  const commands: Candidate[] = [];
  const conflicts: Record<string, string[]> = {};
  for (const command of new Set([...configured, ...fromPath].map(({ command }) => command))) {
    const tier = configured.filter((entry) => entry.command === command);
    const selected = tier.length > 0 ? tier : fromPath.filter((entry) => entry.command === command);
    const unique = [
      ...new Map(
        selected.map((entry) => [
          process.platform === "win32" ? entry.path.toLowerCase() : entry.path,
          entry,
        ]),
      ).values(),
    ];
    if (unique.length === 1) commands.push(unique[0] as Candidate);
    else if (unique.length > 1) conflicts[command] = unique.map(({ path }) => path);
  }
  return { commands: commands.sort((a, b) => a.command.localeCompare(b.command)), conflicts };
}

async function runCapture(
  path: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(path, args, { windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ code: code ?? 70, stdout, stderr }));
  });
}

async function metadata(candidate: Candidate): Promise<CommandMetadata | undefined> {
  const result = await runCapture(candidate.path, ["--pguide-command-metadata"]);
  if (result.code !== 0) return undefined;
  try {
    const value = JSON.parse(result.stdout) as CommandMetadata;
    return value.protocol === "pguide-command-v1" && value.command === candidate.command
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function globalArguments(globals: GlobalOptions): string[] {
  return [
    "--cwd",
    globals.cwd,
    ...(globals.config ? ["--config", globals.config] : []),
    "--format",
    globals.format,
    "--color",
    globals.color,
    "--log-level",
    globals.logLevel,
    ...(globals.help ? ["--help"] : []),
    ...(globals.version ? ["--version"] : []),
  ];
}

async function dispatch(
  candidate: Candidate,
  args: string[],
  globals: GlobalOptions,
): Promise<number> {
  if ((await metadata(candidate)) === undefined)
    throw new CliError(
      `Command ${candidate.command} does not implement pguide-command-v1.`,
      2,
      "protocol-error",
    );
  const separator = args.indexOf("--");
  const childArguments =
    separator < 0
      ? [...args, ...globalArguments(globals)]
      : [...args.slice(0, separator), ...globalArguments(globals), ...args.slice(separator)];
  return new Promise((resolveChild, reject) => {
    const child = spawn(candidate.path, childArguments, {
      cwd: globals.cwd,
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    process.once("SIGINT", forward);
    process.once("SIGTERM", forward);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      process.removeListener("SIGINT", forward);
      process.removeListener("SIGTERM", forward);
      resolveChild(code ?? (signal ? 5 : 70));
    });
  });
}

async function help(globals: GlobalOptions): Promise<void> {
  const found = await discover(globals);
  if (globals.format === "markdown") {
    const commands = [
      "  complete     Generate shell completion",
      "  diagnose     Diagnose configuration and commands",
      ...found.commands.map(
        ({ command }) =>
          `  ${command.padEnd(12)} ${command === "config" ? "Manage user/project configuration and Agent profiles" : Object.hasOwn(commandDescriptions, command) ? commandDescriptions[command as keyof typeof commandDescriptions] : "External command"}`,
      ),
    ];
    const conflicts = Object.keys(found.conflicts);
    process.stdout.write(
      `${formatCommandHelp({
        description: `pguide ${VERSION} - Observe Objectives, repair gaps, and supervise portfolios.`,
        usage: "pguide [global options] <command> [arguments]",
        sections: [
          { title: "Commands", lines: commands },
          {
            title: "Examples",
            lines: [
              "  pguide config path",
              "  pguide validate pilot .\\objective\\pilot.yaml",
              "  pguide probe --pilot .\\objective --subject-file .\\subject.json --format json",
            ],
          },
          {
            title: "Help",
            lines: [
              "  pguide <command> --help     Detailed command usage and examples",
              "  pguide --help --format json  Verify discovered command compatibility",
              "  Text help lists commands without starting them.",
              ...(conflicts.length === 0
                ? []
                : [`  Conflicting commands: ${conflicts.join(", ")}`]),
            ],
          },
        ],
      })}\n`,
    );
    return;
  }
  const commands: {
    command: string;
    description: string;
    builtIn: boolean;
    path: string | null;
    compatible: boolean;
    source: "built-in" | "configured" | "PATH";
    protocol: "built-in" | "pguide-command-v1" | null;
  }[] = [
    {
      command: "complete",
      description: "Generate shell completion",
      builtIn: true,
      path: null,
      compatible: true,
      source: "built-in",
      protocol: "built-in",
    },
    {
      command: "diagnose",
      description: "Diagnose configuration and commands",
      builtIn: true,
      path: null,
      compatible: true,
      source: "built-in",
      protocol: "built-in",
    },
  ];
  for (const candidate of found.commands) {
    const details = await metadata(candidate);
    if (details !== undefined) candidate.metadata = details;
    commands.push({
      command: candidate.command,
      description: candidate.metadata?.description ?? "Incompatible external command",
      builtIn: false,
      path: candidate.path,
      compatible: candidate.metadata !== undefined,
      source: candidate.source,
      protocol: candidate.metadata?.protocol ?? null,
    });
  }
  const value = {
    schemaVersion: 1,
    name: "pguide",
    version: VERSION,
    commands,
    conflicts: found.conflicts,
  };
  writeResult(
    value,
    globals.format,
    `pguide ${VERSION}\n\nUsage: pguide [global options] <command> [arguments]\n\nCommands:\n${commands.map(({ command, description }) => `  ${command.padEnd(12)} ${description}`).join("\n")}`,
  );
}

async function diagnose(argv: string[], globals: GlobalOptions): Promise<number> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "diagnose" },
      globals.format,
      formatCommandHelp({
        description:
          "Inspect effective configuration paths, discovered commands and optional Agent readiness.",
        usage: "pguide diagnose [agent <profile>]",
        sections: [
          {
            title: "Arguments",
            lines: ["  agent <profile>         Also initialize an existing ACP or AHP Agent"],
          },
          {
            title: "Examples",
            lines: [
              "  pguide diagnose --format json",
              "  pguide diagnose agent local --format json",
            ],
          },
          {
            title: "Notes",
            lines: [
              "  Without agent, no Agent process is started. Does not repair configuration.",
              "  Agent initialization is not a complete self-check or a file-repair proof.",
            ],
          },
        ],
      }),
    );
    return 0;
  }
  const config = await loadConfig(globals.cwd, globals.config);
  const found = await discover(globals);
  const agentIndex = argv.indexOf("agent");
  let agent: Record<string, unknown> | undefined;
  if (agentIndex >= 0) {
    const name = argv[agentIndex + 1];
    const profile = name === undefined ? undefined : config.value.agents?.[name];
    if (profile === undefined) throw new CliError(`Unknown Agent profile: ${name ?? ""}.`);
    if (profile.type === "ahp") {
      agent = {
        name,
        type: profile.type,
        initialize: await inspectAhp(
          profile,
          AbortSignal.timeout(config.value.agentExecutionLimits?.timeoutMs ?? 30_000),
        ),
      };
    } else {
      const client = new AcpClient(profile);
      try {
        agent = {
          name,
          type: profile.type,
          initialize: await client.initialize(profile.connection.protocolVersion),
        };
      } finally {
        client.close();
      }
    }
  }
  const value = {
    schemaVersion: 1,
    status: Object.keys(found.conflicts).length === 0 ? "ok" : "conflicts",
    node: process.version,
    config: config.paths,
    commands: found.commands,
    conflicts: found.conflicts,
    ...(agent ? { agent } : {}),
  };
  writeResult(
    value,
    globals.format,
    `pguide diagnosis: ${value.status}\nNode: ${process.version}\nCommands: ${found.commands.length}`,
  );
  return value.status === "ok" ? 0 : 2;
}

function complete(argv: string[], globals: GlobalOptions): void {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "complete" },
      globals.format,
      formatCommandHelp({
        description:
          "Print a shell completion script; does not install it or change your shell profile.",
        usage: "pguide complete [--shell <shell>]",
        sections: [
          {
            title: "Options",
            lines: ["  --shell <shell>         bash | zsh | fish | powershell (default: bash)"],
          },
          {
            title: "Examples",
            lines: [
              "  pguide complete --shell powershell",
              "  pguide complete --shell bash --format json",
            ],
          },
          {
            title: "Notes",
            lines: ["  Review and load the emitted script in your shell or profile."],
          },
        ],
      }),
    );
    return;
  }
  const shell = (option(argv, "--shell") as string | undefined) ?? "bash";
  const scripts: Record<string, string> = {
    bash: 'complete -W "probe regulate continue supervise scaffold validate config diagnose complete" pguide',
    zsh: '#compdef pguide\n_arguments "1:command:(probe regulate continue supervise scaffold validate config diagnose complete)"',
    fish: "complete -c pguide -f -a 'probe regulate continue supervise scaffold validate config diagnose complete'",
    powershell:
      "Register-ArgumentCompleter -Native -CommandName pguide -ScriptBlock { param($wordToComplete) 'probe','regulate','continue','supervise','scaffold','validate','config','diagnose','complete' | Where-Object { $_ -like \"$wordToComplete*\" } }",
  };
  const script = scripts[shell];
  if (script === undefined) throw new CliError("Unsupported shell.");
  writeResult({ schemaVersion: 1, shell, script }, globals.format, script);
}

function topLevelFlag(argv: string[], flag: "--help" | "--version"): boolean {
  const optionsWithValues = new Set(["--cwd", "--config", "--format", "--color", "--log-level"]);
  let commandIndex = Number.POSITIVE_INFINITY;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === "--") break;
    if (optionsWithValues.has(argument)) {
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "--version") continue;
    commandIndex = index;
    break;
  }
  const flagIndex = argv.indexOf(flag);
  return flagIndex >= 0 && flagIndex < commandIndex;
}

async function main(): Promise<number> {
  try {
    const argv = process.argv.slice(2);
    const { options: globals, rest } = extractGlobals(argv);
    const command = rest[0];
    if (topLevelFlag(argv, "--version")) {
      writeResult(
        { schemaVersion: 1, name: "pguide", version: VERSION },
        globals.format,
        `pguide ${VERSION}`,
      );
      return 0;
    }
    if (command === undefined || topLevelFlag(argv, "--help")) {
      await help(globals);
      return 0;
    }
    if (command === "diagnose") return diagnose(rest.slice(1), globals);
    if (command === "complete") {
      complete(rest.slice(1), globals);
      return 0;
    }
    if (!commandPattern.test(command)) throw new CliError(`Invalid command name: ${command}.`);
    const found = await discover(globals);
    const conflict = found.conflicts[command];
    if (conflict !== undefined)
      throw new CliError(`Ambiguous command ${command}: ${conflict.join(", ")}.`);
    const candidate = found.commands.find((entry) => entry.command === command);
    if (candidate === undefined) throw new CliError(`Unknown command: ${command}.`);
    return dispatch(candidate, rest.slice(1), globals);
  } catch (error) {
    const failure = expectedCliError(error);
    const format =
      process.argv.includes("--format") &&
      process.argv[process.argv.indexOf("--format") + 1] === "json"
        ? "json"
        : "markdown";
    writeResult(
      { schemaVersion: 1, status: failure.status, error: failure.message },
      format,
      `Error: ${failure.message}`,
    );
    return failure.exitCode;
  }
}

process.exitCode = await main();
