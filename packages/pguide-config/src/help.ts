import { type CommandHelp, formatCommandHelp, helpMetadata } from "@potential-guide/cli-core";

const commands = {
  show: {
    arguments: "",
    description: "Show the merged configuration with sensitive values redacted.",
    example: "pguide config show --format json",
  },
  path: {
    arguments: "",
    description: "Show user and nearest discovered project configuration paths.",
    example: "pguide config path",
  },
  validate: {
    arguments: "",
    description:
      "Validate every selected layer and registered setting; unknown namespaces remain unverified. Does not connect to Agents.",
    example: "pguide config validate --cwd .",
  },
  edit: {
    arguments: "[--scope <scope>]",
    description: "Edit via VISUAL or EDITOR, then validate and atomically save the selected file.",
    example: "pguide config edit --scope user",
  },
  get: {
    arguments: "<key>",
    description: "Read a complete setting ID; dots are literal, not nested paths.",
    example: "pguide config get pilot.probe",
  },
  set: {
    arguments: "<key> <value> [--scope <scope>]",
    description: "Set a complete ID using a JSONC value, retaining other keys and comments.",
    example: "pguide config set agents.defaultAgent '\"local\"' --scope user",
  },
  unset: {
    arguments: "<key> [--scope <scope>]",
    description: "Remove a complete ID from the selected file; static defaults are never written.",
    example: "pguide config unset agents.defaultAgent --scope project",
  },
  packages: {
    arguments: "register|unregister <package-root> | path",
    description:
      "Explicitly register local static package settings, remove a registration, or locate the registry for recovery. Never installs or executes packages.",
    example: "pguide config packages register .\\installed-package",
  },
  "list-agents": {
    arguments: "",
    description: "Retired: use pguide agents list; embedded profiles require explicit migrate.",
    example: "pguide agents list --format json",
  },
  "show-agent": {
    arguments: "<name>",
    description: "Retired: use pguide agents show <name>.",
    example: "pguide agents show local",
  },
  "add-agent": {
    arguments: "<name> <source|-> [--scope <scope>]",
    description: "Retired: use pguide agents set <name> --from <file|-> --scope user|project.",
    example: "pguide agents set local --from .\\agent.yaml --scope user",
  },
  "update-agent": {
    arguments: "<name> <source|-> [--scope <scope>]",
    description: "Retired: use pguide agents set <name> --from <file|-> --scope user|project.",
    example: "pguide agents set local --from .\\agent.yaml --scope user",
  },
  "remove-agent": {
    arguments: "<name> [--scope <scope>]",
    description: "Retired: use pguide agents remove <name> --scope user|project.",
    example: "pguide agents remove local --scope user",
  },
  "list-objectives": {
    arguments: "",
    description:
      "List legacy source aliases (not declarations), locations and configuration origins.",
    example: "pguide config list-objectives --format json",
  },
  "add-objective": {
    arguments: "<name> <path|Git URI> [--scope <scope>]",
    description:
      "Retired: use pguide objectives set/migrate with explicit inputSchema and subject.",
    example: "pguide objectives set health --from .\\declaration.yaml --scope user",
  },
  "update-objective": {
    arguments: "<name> <path|Git URI> [--scope <scope>]",
    description:
      "Retired: use pguide objectives set/migrate; existing source aliases are read-only.",
    example: "pguide objectives migrate health --help",
  },
  "remove-objective": {
    arguments: "<name> [--scope <scope>]",
    description: "Remove an Objective name from the selected file, leaving other layers unchanged.",
    example: "pguide config remove-objective health --scope user",
  },
};

export const configSubcommands = Object.keys(commands);

function definition(subcommand?: string): CommandHelp {
  const selected =
    subcommand !== undefined && Object.hasOwn(commands, subcommand)
      ? commands[subcommand as keyof typeof commands]
      : undefined;
  return {
    description:
      selected?.description ??
      "Inspect and manage pguide configuration; Agent profiles are independent resources.",
    usage:
      selected === undefined
        ? "pguide config <subcommand> [arguments] [options]"
        : `pguide config ${subcommand} ${selected.arguments}`.trimEnd(),
    sections: [
      ...(selected === undefined
        ? [
            {
              title: "Subcommands",
              lines: Object.entries(commands).map(
                ([name, entry]) =>
                  `  ${`${name} ${entry.arguments}`.trimEnd()}\n      ${entry.description}`,
              ),
            },
          ]
        : []),
      {
        title: "Configuration",
        lines: [
          "  config.jsonc values merge user -> nearest project by complete ID, without deep merge.",
          "  --scope <scope> applies to writes: user | project (default: project, at effective cwd).",
          "  --config and --scope explicit are retired; migrate YAML manually before use.",
          "  Writes validate known settings; unknown namespaces are saved with a warning. Credentials stay in the",
          "  Agent's login store or named environment variables, never profile literals.",
        ],
      },
      {
        title: "Examples",
        lines:
          selected === undefined
            ? [
                "  pguide config path",
                "  pguide config set agents.defaultAgent '\"local\"' --scope user",
                "  pguide agents set local --from .\\agent.yaml --scope user",
                "  pguide config get pilot.probe",
                "  pguide objectives set health --from .\\declaration.yaml --scope user",
              ]
            : [`  ${selected.example}`],
      },
      {
        title: "Notes",
        lines: [
          "  regulate.quota and pilot.probe configure finite quotas and check deadlines;",
          "  portfolio scheduling belongs to supervise. Validation alone does not prove",
          "  Agent authentication or repair readiness. Use pguide diagnose agent <name>.",
          "  Select declarations with --objective; legacy --pilot aliases remain source references.",
          "  Run pguide config <subcommand> --help for operation-specific usage.",
        ],
      },
    ],
    constraints: [
      "--scope is user | project (default: project) for config writes.",
      "Project writes target effective cwd, not an ancestor's discovered configuration.",
      "Retired commands reject execution; use the supported replacement shown in Examples.",
    ],
  };
}

export function configHelpSpec(subcommand?: string) {
  const spec = definition(subcommand);
  return {
    ...helpMetadata(spec),
    optionDetails: [
      ...helpMetadata(spec).optionDetails.filter(({ name }) => name !== "--scope"),
      {
        name: "--scope",
        argument: "<scope>",
        description: "Config write scope; reads use the effective merge",
        values: ["user", "project"],
        default: "project",
      },
    ],
  };
}

export function configHelp(subcommand?: string): string {
  return formatCommandHelp(definition(subcommand));
}
