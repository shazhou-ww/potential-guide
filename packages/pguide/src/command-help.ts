import {
  type CommandHelp,
  commandMain,
  formatCommandHelp,
  type GlobalOptions,
  writeResult,
} from "@potential-guide/cli-core";

type Command = "probe" | "regulate" | "continue" | "supervise" | "scaffold" | "validate";
type Handler = Parameters<typeof commandMain>[1];

export const commandDescriptions: Record<Command, string> = {
  probe: "Observe an Objective Pilot",
  regulate: "Run Pilot regulation with per-Agent execution limits",
  continue: "Continue a persisted Regulation",
  supervise: "Supervise an Objective portfolio",
  scaffold: "Create an Objective Pilot skeleton",
  validate: "Validate an Objective Pilot",
};

const help: Record<Command, CommandHelp> = {
  probe: {
    description:
      "Observe the current Objective level and all blocking problems. Does not run regulation.",
    usage: "pguide probe --pilot <path|Git URI|objective> [--subject-file <path|->] [options]",
    sections: [
      {
        title: "Required",
        lines: ["  --pilot <source>        Committed path, Git URI, or registered Objective name"],
      },
      {
        title: "Options",
        lines: [
          "  --subject-file <path|-> JSON subject (default: stdin); use - explicitly for stdin",
          "  --revision <ref|commit> Pin source version; local paths require a full commit hash",
          "  --language <tag>        Select localized references (default: Pilot language)",
          "  --report <path>         Also save the complete JSON observation",
        ],
      },
      {
        title: "Examples",
        lines: [
          "  pguide probe --pilot .\\objective --subject-file .\\subject.json",
          "  pguide probe --pilot .\\objective --subject-file - --format json",
          "  Get-Content -Raw .\\subject.json | pguide probe --pilot health --format json",
        ],
      },
      {
        title: "Notes",
        lines: [
          "  Local Pilot repositories must be clean and committed. Checks may execute tools;",
          "  a self-check Pilot includes one Agent sanity task. Read the Pilot before running.",
          "  Exit 0 means observation succeeded, not that the Objective reached terminal.",
          "  Register a source with pguide config add-objective <name> <source>.",
          "  Use @name to require a registered Objective; bare names resolve when registered.",
          "  Next: pguide regulate --help",
        ],
      },
    ],
  },
  regulate: {
    description:
      "Observe, run an Agent when needed, and re-observe until a target or finite quota is reached.",
    usage:
      "pguide regulate --pilot <path|Git URI|objective> --target <level> [--subject-file <path|->] [options]",
    sections: [
      {
        title: "Required",
        lines: [
          "  --pilot <source>        Committed path, Git URI, or registered Objective name",
          "  --target <level>        Target level ID, including terminal",
        ],
      },
      {
        title: "Options",
        lines: [
          "  --subject-file <path|-> JSON subject (default: stdin); use - explicitly for stdin",
          "  --agent <profile>       Existing Agent profile (default: configured defaultAgent)",
          "  --agent-timeout-ms <ms> Per-Agent deadline; includes connection and session startup",
          "  --revision <ref|commit> Pin Pilot version",
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
          "  May invoke a real Agent and consume tokens. Repair tool requests require configured grants.",
          "  regulationStrategy.quota bounds the run; regulationStrategy.probe controls checks.",
          "  The saved regulation ID can be resumed with pguide continue <regulation-id>.",
          "  Recovery retains the resolved source and commit, even if a registered name changes.",
        ],
      },
    ],
  },
  continue: {
    description:
      "Start another bounded attempt using a persisted regulation's pinned Pilot and subject.",
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
          "  Restores the saved target, subject, Agent recipe and quotas; does not accept a new --pilot.",
          "  Current permission grants apply. A required Agent session must be resumable.",
          "  Use the same --config / --cwd context to find the saved state directory.",
        ],
      },
    ],
  },
  supervise: {
    description: "Observe an Objective portfolio and ask a planner to allocate Agent resources.",
    usage: "pguide supervise --portfolio-file <json> --planner <profile> [options]",
    sections: [
      {
        title: "Required",
        lines: [
          "  --portfolio-file <json> Portfolio schemaVersion 3 with goals and resources",
          "  --planner <profile>     Existing Agent profile used for planning",
        ],
      },
      {
        title: "Options",
        lines: [
          "  --execute               Run the coordinator and dispatch approved regulations",
          "  --duration-ms <ms>      Stop after a positive duration; requires --execute",
        ],
      },
      {
        title: "Examples",
        lines: [
          "  pguide supervise --portfolio-file .\\portfolio.json --planner local --format json",
          "  pguide supervise --portfolio-file .\\portfolio.json --planner local --execute --duration-ms 60000",
        ],
      },
      {
        title: "Notes",
        lines: [
          "  Without --execute, produces a plan without dispatching repairs; planning still uses an Agent.",
          "  Live execution watches portfolio/config changes. Ctrl+C cancels the coordinator.",
        ],
      },
    ],
  },
  scaffold: {
    description:
      "Create a multilingual Pilot manifest, references and optional runnable check skeleton.",
    usage: "pguide scaffold pilot <directory> [options]",
    sections: [
      {
        title: "Arguments",
        lines: [
          "  pilot                   Supported scaffold type",
          "  <directory>             Destination must be absent or empty",
        ],
      },
      {
        title: "Options",
        lines: [
          "  --language <tag>        BCP 47 language; repeat for multiple languages (default: en-US)",
          "  --level <id>            Initial level ID (default: initial)",
          "  --check <id>            Generate one runnable check",
          "  --problem <id>          Problem ID; repeat for multiple problems; requires --check",
        ],
      },
      {
        title: "Examples",
        lines: [
          "  pguide scaffold pilot .\\objective --check ready --problem not-ready",
          "  pguide scaffold pilot .\\objective --language zh-CN --language en-US",
        ],
      },
      {
        title: "Next steps",
        lines: [
          "  Replace TODO guidance and implement the generated check. IDs use lowercase kebab-case.",
          "  Validate with pguide validate pilot .\\objective\\pilot.yaml, then commit before probing.",
        ],
      },
    ],
  },
  validate: {
    description:
      "Validate a Pilot manifest and its localized reference graph without executing checks.",
    usage: "pguide validate pilot <pilot.yaml>",
    sections: [
      {
        title: "Arguments",
        lines: [
          "  pilot                   Supported validation type",
          "  <pilot.yaml>            Local manifest path",
        ],
      },
      {
        title: "Examples",
        lines: [
          "  pguide validate pilot .\\objective\\pilot.yaml",
          "  pguide validate pilot .\\objective\\pilot.yaml --format json",
        ],
      },
      {
        title: "Notes",
        lines: [
          "  Reads working-tree files; no commit is needed for static validation.",
          "  Does not run checks or prove readiness. Next: pguide probe --help",
        ],
      },
    ],
  },
};

export function showCommandHelp(command: Command, globals: GlobalOptions): void {
  const value = {
    schemaVersion: 1,
    command,
    ...(command === "probe"
      ? { options: ["--pilot", "--subject-file", "--language", "--revision", "--report"] }
      : command === "scaffold" || command === "validate"
        ? { types: ["pilot"] }
        : {}),
  };
  writeResult(value, globals.format, formatCommandHelp(help[command]));
}

export function launchCommand(command: Command, load: () => Promise<Handler>): void {
  void commandMain(
    {
      protocol: "pguide-command-v1",
      command,
      description: commandDescriptions[command],
      version: "0.4.0-rc.0",
    },
    async (argv, globals) => {
      if (globals.help) {
        showCommandHelp(command, globals);
        return;
      }
      const run = await load();
      return (await run(argv, globals)) ?? undefined;
    },
  );
}
