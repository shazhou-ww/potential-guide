export interface CommandHelp {
  readonly description: string;
  readonly usage: string;
  readonly sections?: readonly {
    readonly title: string;
    readonly lines: readonly string[];
  }[];
}

export function formatCommandHelp(help: CommandHelp): string {
  return [
    help.description,
    `Usage: ${help.usage}`,
    ...(help.sections ?? []).map(({ title, lines }) => `${title}:\n${lines.join("\n")}`),
    [
      "Global options:",
      "  --cwd <directory>       Configuration and relative-path context (default: current directory)",
      "  --config <path>         Explicit config overlay (user -> project -> explicit)",
      "  --format <format>       markdown | json (default: markdown)",
      "  --color <mode>          auto | always | never (default: auto)",
      "  --log-level <level>     error | warn | info | debug (default: warn)",
      "  --help                  Show help without executing the command",
      "  --version               Show command version",
    ].join("\n"),
  ].join("\n\n");
}
