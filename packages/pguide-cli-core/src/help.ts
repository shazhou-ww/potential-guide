export interface CommandHelp {
  readonly description: string;
  readonly usage: string;
  readonly sections?: readonly {
    readonly title: string;
    readonly lines: readonly string[];
  }[];
  readonly constraints?: readonly string[];
}

export const globalHelpOptions = [
  {
    name: "--cwd",
    argument: "<directory>",
    description: "Configuration and relative-path context",
    default: "current directory",
  },
  {
    name: "--format",
    argument: "<format>",
    description: "markdown | json",
    default: "markdown",
    values: ["markdown", "json"],
  },
  {
    name: "--color",
    argument: "<mode>",
    description: "auto | always | never",
    default: "auto",
    values: ["auto", "always", "never"],
  },
  {
    name: "--log-level",
    argument: "<level>",
    description: "error | warn | info | debug",
    default: "warn",
    values: ["error", "warn", "info", "debug"],
  },
  { name: "--help", description: "Show help without executing the command" },
  { name: "--version", description: "Show command version" },
] as const;

export function helpMetadata(help: CommandHelp) {
  const sections = help.sections ?? [];
  const optionDetails = sections.flatMap(({ lines }) =>
    lines.flatMap((line) => {
      const match = /^\s+(--[\w-]+)(?:\s+(<[^>]+>|\S+\|\S+))?\s+(.+)$/.exec(line);
      if (!match) return [];
      const description = match[3] as string;
      const defaultValue = /\(default: ([^)]+)\)/.exec(description)?.[1];
      return [
        {
          name: match[1] as string,
          ...(match[2] ? { argument: match[2] } : {}),
          description,
          ...(defaultValue ? { default: defaultValue } : {}),
        },
      ];
    }),
  );
  return {
    description: help.description,
    usage: help.usage,
    sections,
    optionDetails,
    globalOptions: globalHelpOptions,
    constraints: help.constraints ?? [],
    examples: sections
      .filter(({ title }) => title === "Examples")
      .flatMap(({ lines }) => lines.map((line) => line.trim())),
  };
}

export function formatCommandHelp(help: CommandHelp): string {
  return [
    help.description,
    `Usage: ${help.usage}`,
    ...(help.sections ?? []).map(({ title, lines }) => `${title}:\n${lines.join("\n")}`),
    ...(help.constraints?.length
      ? [`Constraints:\n${help.constraints.map((line) => `  ${line}`).join("\n")}`]
      : []),
    [
      "Global options:",
      ...globalHelpOptions.map(
        (option) =>
          `  ${`${option.name}${"argument" in option ? ` ${option.argument}` : ""}`.padEnd(25)}${option.description}${"default" in option ? ` (default: ${option.default})` : ""}`,
      ),
    ].join("\n"),
  ].join("\n\n");
}
