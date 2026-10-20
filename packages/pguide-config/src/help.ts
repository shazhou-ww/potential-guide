import { formatCommandHelp } from "@potential-guide/cli-core";

const commands = {
  show: {
    arguments: "",
    description: "Show the merged configuration with sensitive values redacted.",
    example: "pguide config show --format json",
  },
  path: {
    arguments: "",
    description: "Show user, discovered project and explicit configuration paths.",
    example: "pguide config path",
  },
  validate: {
    arguments: "",
    description:
      "Validate schemaVersion 2 and the effective configuration; does not connect to Agents.",
    example: "pguide config validate --config .\\config.yaml",
  },
  edit: {
    arguments: "[--scope <scope>]",
    description: "Edit via VISUAL or EDITOR, then validate and atomically save the selected file.",
    example: "pguide config edit --scope user",
  },
  get: {
    arguments: "<key>",
    description: "Read an effective value; dot-separated keys are supported.",
    example: "pguide config get regulationStrategy.probe.timeoutMs",
  },
  set: {
    arguments: "<key> <value> [--scope <scope>]",
    description: "Set a top-level key; the quoted value is parsed as YAML, not a secret store.",
    example: "pguide config set defaultAgent local --scope user",
  },
  unset: {
    arguments: "<key> [--scope <scope>]",
    description: "Remove a top-level key from the selected file; schemaVersion cannot be removed.",
    example: "pguide config unset defaultAgent --scope project",
  },
  "list-agents": {
    arguments: "",
    description: "List effective Agent names, origins, protocols and transports.",
    example: "pguide config list-agents --format json",
  },
  "show-agent": {
    arguments: "<name>",
    description: "Show one effective Agent profile with sensitive values redacted.",
    example: "pguide config show-agent local",
  },
  "add-agent": {
    arguments: "<name> <source|-> [--scope <scope>]",
    description:
      "Add a new profile from a JSON/YAML file or stdin (-); the name must not exist in that file.",
    example: "pguide config add-agent local .\\agent.yaml --scope user",
  },
  "update-agent": {
    arguments: "<name> <source|-> [--scope <scope>]",
    description: "Replace a profile already present in the selected file; source may be stdin (-).",
    example: "pguide config update-agent local .\\agent.yaml --scope user",
  },
  "remove-agent": {
    arguments: "<name> [--scope <scope>]",
    description: "Remove a profile from the selected file, not from other configuration layers.",
    example: "pguide config remove-agent local --scope user",
  },
  "list-objectives": {
    arguments: "",
    description: "List effective registered Objective names, locations and configuration origins.",
    example: "pguide config list-objectives --format json",
  },
  "add-objective": {
    arguments: "<name> <path|Git URI> [--scope <scope>]",
    description:
      "Register a new Objective name in the selected file; local paths are saved as absolute paths.",
    example: "pguide config add-objective health .\\objective --scope user",
  },
  "update-objective": {
    arguments: "<name> <path|Git URI> [--scope <scope>]",
    description: "Replace an Objective location already registered in the selected file.",
    example: "pguide config update-objective health .\\updated-objective --scope user",
  },
  "remove-objective": {
    arguments: "<name> [--scope <scope>]",
    description: "Remove an Objective name from the selected file, leaving other layers unchanged.",
    example: "pguide config remove-objective health --scope user",
  },
};

export const configSubcommands = Object.keys(commands);

export function configHelp(subcommand?: string): string {
  const selected =
    subcommand !== undefined && Object.hasOwn(commands, subcommand)
      ? commands[subcommand as keyof typeof commands]
      : undefined;
  return formatCommandHelp({
    description:
      selected?.description ?? "Inspect and manage pguide configuration and Agent profiles.",
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
          "  Effective values merge user -> nearest project -> explicit --config.",
          "  --scope <scope> applies to writes: user | project | explicit (default: project).",
          "  --scope explicit requires --config <path>; reads always use the effective merge.",
          "  Writes validate schemaVersion 2 before saving. Agent credentials stay in the",
          "  Agent's login store or named environment variables, never profile literals.",
        ],
      },
      {
        title: "Examples",
        lines:
          selected === undefined
            ? [
                "  pguide config path",
                "  pguide config set defaultAgent local --scope user",
                "  pguide config add-agent local .\\agent.yaml --scope user",
                "  pguide config get regulationStrategy.probe.timeoutMs",
                "  pguide config add-objective health .\\objective --scope user",
              ]
            : [`  ${selected.example}`],
      },
      {
        title: "Notes",
        lines: [
          "  regulationStrategy configures finite regulation quotas and check deadlines;",
          "  portfolio scheduling belongs to supervise. Validation alone does not prove",
          "  Agent authentication or repair readiness. Use pguide diagnose agent <name>.",
          "  Registered Objective names work in probe, regulate and portfolio goals;",
          "  @name requires a registry match. Registry entries point to paths or Git URIs, not aliases.",
          "  Run pguide config <subcommand> --help for operation-specific usage.",
        ],
      },
    ],
  });
}
