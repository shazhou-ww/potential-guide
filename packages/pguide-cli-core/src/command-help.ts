import { readFileSync } from "node:fs";
import { AGENTS_SCHEMA } from "./agents.js";
import { helpMetadata } from "./help.js";
import {
  type CommandHelp,
  commandMain,
  formatCommandHelp,
  type GlobalOptions,
  writeResult,
} from "./index.js";

type Command = "agents" | "objectives" | "regulate" | "continue";
type Handler = Parameters<typeof commandMain>[1];

export const commandDescriptions: Record<Command, string> = {
  agents: "Manage independent user and project Agent resources",
  objectives: "Discover and manage user and directory Objective declarations",

  regulate: "Pilot regulation (execution retired pending Task Bundle migration)",
  continue: "Persisted Regulation (continuation retired pending Task Bundle migration)",
};

export const commandPackages: Record<Command, string> = {
  agents: "@potential-guide/pguide-agents",
  objectives: "@potential-guide/pguide-objectives",

  regulate: "@potential-guide/pguide-regulate",
  continue: "@potential-guide/pguide-regulate",
};

const help: Record<Command, CommandHelp> = {
  agents: {
    description:
      "Manage independent agents.yaml resources with complete project-over-user profile replacement.",
    usage:
      "pguide agents list|show|set|remove|edit|validate|path|migrate [name] [--scope user|project]",
    sections: [
      {
        title: "Options",
        lines: [
          "  --from <file|-> Profile YAML for set",
          "  --legacy-config <file> Same-scope main config for explicit migrate",
        ],
      },
    ],
  },
  objectives: {
    description:
      "List/show declarations without evaluation or remote resolution; set/remove/migrate require explicit scope.",
    usage: "pguide objectives list|show|set|remove|migrate [name] [--scope user|directory]",
    sections: [
      {
        title: "Options",
        lines: [
          "  --from <file> Complete single-entry objectives.yaml for set/migrate",
          "  --legacy-config <file> Explicit legacy config for migrate",
        ],
      },
    ],
  },

  regulate: {
    description:
      "Host-based regulation is retired. Execution rejects before Agent work or state mutation.",
    usage:
      "pguide regulate (--objective <name> | --pilot <directory|Git URI|legacy-alias>) --target <level> [options]",
    sections: [
      {
        title: "Required",
        lines: [
          "  Choose exactly one: --objective <name> OR --pilot <source> (never both).",
          "  --target <level>        initial, business level ID, or terminal (highest-level alias)",
        ],
      },
      {
        title: "Options",
        lines: [
          "  --objective <name>      Select a declaration instead of --pilot",
          "  --pilot <source>        Committed path, Git URI, or legacy source alias",
          "  --scope <scope>         user | directory; disambiguate declaration scope",
          "  --input-file <path|->   Declaration input; only Unit may omit it",
          "  --subject-file <path|-> JSON subject (default: stdin); use - explicitly for stdin",
          "  --agent <profile>       Existing Agent profile (default: agents.defaultAgent)",
          "  --agent-timeout-ms <ms> Per-Agent deadline; includes connection and session startup",
          "  --revision <digest|ref> Pin exact artifact content or legacy Pilot version",
          "  --language <tag>        Select localized references",
          "  --report <path>         Also save the JSON result",
        ],
      },
      {
        title: "Examples",
        lines: [
          "  pguide regulate --pilot .\\objective --subject-file .\\subject.json --target terminal",
          "  pguide regulate --pilot .\\objective --subject-file .\\subject.json --target terminal --agent local --agent-timeout-ms 60000",
          "  Get-Content -Raw .\\subject.json | pguide regulate --pilot health --target terminal",
        ],
      },
      {
        title: "Notes",
        lines: [
          "  Execution returns exit 2 and pilot-error until migrated to Task Bundles.",
          "  Existing records are not pruned, rewritten, converted or replayed.",
          "  Help and command discovery remain available; no Agent is started.",
        ],
      },
    ],
  },
  continue: {
    description:
      "Legacy continuation is retired. Existing records are left unchanged and are not replayed.",
    usage: "pguide continue <regulation-id> [--report <path>]",
    sections: [
      {
        title: "Arguments",
        lines: ["  <regulation-id>         UUID returned by a previous regulate or continue run"],
      },
      { title: "Options", lines: ["  --report <path>         Also save the JSON result"] },
      {
        title: "Examples",
        lines: ["  pguide continue 01234567-89ab-4cde-8fab-0123456789ab --format json"],
      },
      {
        title: "Notes",
        lines: [
          "  Execution returns exit 2 and pilot-error before reading or changing a saved record.",
          "  No implicit conversion to Task Bundles and no automatic replay are provided.",
        ],
      },
    ],
  },
};

const agentOperations = {
  list: {
    arguments: "",
    description: "List effective profiles with scope and file provenance.",
    example: "pguide agents list",
  },
  show: {
    arguments: "<name>",
    description: "Show one effective profile with its name, scope and source; unknown names fail.",
    example: "pguide agents show local",
  },
  set: {
    arguments: "<name> --from <file|-> --scope <scope>",
    description: "Validate and replace a whole profile in the selected scope.",
    example: "pguide agents set local --from .\\profile.yaml --scope project",
  },
  remove: {
    arguments: "<name> --scope <scope>",
    description:
      "Remove only the selected scope's profile; a user profile may become visible again.",
    example: "pguide agents remove local --scope project",
  },
  edit: {
    arguments: "--scope <scope>",
    description:
      "Edit the selected resource using VISUAL or EDITOR; failed edits preserve the original.",
    example: "pguide agents edit --scope project",
  },
  validate: {
    arguments: "",
    description: "Validate both resources without connecting to Agents.",
    example: "pguide agents validate",
  },
  path: {
    arguments: "",
    description: "Show user and project resource locations without loading profiles.",
    example: "pguide agents path",
  },
  migrate: {
    arguments: "--scope <scope> [--legacy-config <file>]",
    description:
      "Move embedded profiles from the same-scope main config, preserving a source backup.",
    example: "pguide agents migrate --scope user",
  },
};

const objectiveOperations = {
  list: {
    arguments: "[--scope <scope>]",
    description:
      "List declarations and legacy aliases with scope and source; no evaluation or remote resolution.",
    example: "pguide objectives list",
  },
  show: {
    arguments: "<name> [--scope <scope>]",
    description: "Show a declaration; use scope to disambiguate same-name declarations.",
    example: "pguide objectives show health --scope directory",
  },
  set: {
    arguments: "<name> --from <file> --scope <scope>",
    description: "Validate and save a complete declaration in an explicit scope.",
    example: "pguide objectives set health --from .\\declaration.yaml --scope directory",
  },
  remove: {
    arguments: "<name> --scope <scope>",
    description: "Remove only the declaration in the selected scope.",
    example: "pguide objectives remove health --scope directory",
  },
  migrate: {
    arguments: "<name> --from <file> --scope <scope> --legacy-config <file>",
    description:
      "Explicitly migrate a legacy source alias using a reviewed declaration; never guess input or subject.",
    example:
      "pguide objectives migrate health --from .\\declaration.yaml --scope user --legacy-config .\\config.yaml",
  },
};

export function getCommandHelp(command: Command, subcommand?: string): CommandHelp {
  if (command !== "agents" && command !== "objectives")
    return {
      ...help[command],
      constraints:
        command === "regulate"
          ? [
              "--objective and --pilot are mutually exclusive; exactly one is required.",
              "--scope and --input-file require --objective.",
              "--input-file cannot combine with --subject-file; --subject-file requires --pilot.",
              "--target is required.",
            ]
          : [],
    };
  const operations = command === "agents" ? agentOperations : objectiveOperations;
  const selected =
    subcommand && Object.hasOwn(operations, subcommand)
      ? operations[subcommand as keyof typeof operations]
      : undefined;
  const scopes = command === "agents" ? "user | project" : "user | directory";
  const names = selected ? [subcommand] : Object.keys(operations);
  return {
    description: selected?.description ?? help[command].description,
    usage: selected
      ? `pguide ${command} ${subcommand} ${selected.arguments}`.trimEnd()
      : help[command].usage,
    constraints: [
      `Writes require explicit --scope (${scopes}); there is no default write scope.`,
      ...(command === "agents"
        ? [
            "Main configuration uses user/project config.jsonc; --config is retired. Agent resources retain two independent scopes.",
            "Project profiles replace entire same-name user profiles; credentials are references, never secrets.",
            "--legacy-config must be the main config beside the selected scope's agents.yaml.",
          ]
        : [
            "Same-name user and directory declarations are ambiguous without --scope.",
            "set and migrate require a complete single-entry declaration with explicit subject; omitted inputSchema is Unit.",
          ]),
    ],
    sections: [
      ...(!selected
        ? [
            {
              title: "Subcommands",
              lines: Object.entries(operations).map(
                ([name, entry]) => `  ${name} ${entry.arguments}\n      ${entry.description}`,
              ),
            },
          ]
        : []),
      {
        title: "Options",
        lines: [
          ...(names.some(
            (name) =>
              name &&
              [
                "set",
                "remove",
                "edit",
                "migrate",
                ...(command === "objectives" ? ["list", "show"] : []),
              ].includes(name),
          )
            ? [`  --scope <scope>         ${scopes}; writes require an explicit scope`]
            : []),
          ...(names.some(
            (name) => name === "set" || (command === "objectives" && name === "migrate"),
          )
            ? [
                `  --from <${command === "agents" ? "file|-" : "file"}>         ${command === "agents" ? "Profile YAML; - reads stdin" : "Complete single-entry objectives.yaml"}`,
              ]
            : []),
          ...(names.includes("migrate")
            ? ["  --legacy-config <file>  Explicit same-scope legacy main configuration"]
            : []),
        ],
      },
      {
        title: "Examples",
        lines: selected
          ? [`  ${selected.example}`]
          : Object.values(operations).map(({ example }) => `  ${example}`),
      },
    ],
  };
}

export function showCommandHelp(
  command: Command,
  globals: GlobalOptions,
  subcommand?: string,
): void {
  const selected = getCommandHelp(command, subcommand);
  const value = {
    schemaVersion: 1,
    command,
    ...(command === "agents"
      ? { subcommands: Object.keys(agentOperations), resourceSchema: AGENTS_SCHEMA }
      : command === "objectives"
        ? { subcommands: Object.keys(objectiveOperations) }
        : {}),
    ...helpMetadata(selected),
  };
  writeResult(value, globals.format, formatCommandHelp(selected));
}

export function launchCommand(command: Command, load: () => Promise<Handler>, manifest: URL): void {
  const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
  void commandMain(
    {
      protocol: "pguide-command-v1",
      command,
      description: commandDescriptions[command],
      version,
    },
    async (argv, globals) => {
      if (globals.help) {
        showCommandHelp(command, globals, argv[0]);
        return;
      }
      const run = await load();
      return (await run(argv, globals)) ?? undefined;
    },
  );
}
