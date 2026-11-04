#!/usr/bin/env node
import { resolve } from "node:path";
import {
  CliError,
  type CommandHelp,
  commandMain,
  formatCommandHelp,
  type GlobalOptions,
  helpMetadata,
  writeResult,
} from "@potential-guide/cli-core";
import { checkTaskArtifact } from "./artifact.js";

const help: CommandHelp = {
  description: "Initialize, check and build complete TypeBox Task Bundles offline.",
  usage:
    "pguide task-bundle init [directory] | check author <task.build.yaml> | check artifact <bundle.car|directory> | build <task.build.yaml>",
  sections: [
    {
      title: "Commands",
      lines: [
        "  init [directory]        Create a minimal Echo task and declare TypeBox in the nearest npm package; offline.",
        "  check author <file>     Compile trusted author input in memory; no output writes or network publishing.",
        "  check artifact <path>   Validate a CAR or directory: exact manifest, Schema, block hashes and complete DAG.",
        "  build <file>            Emit the final <outDirectory>.car and a local Worker directory; offline.",
      ],
    },
    {
      title: "Configuration",
      lines: [
        "  All commands are offline. Upload, import and pin with an external tool of your choice.",
      ],
    },
    {
      title: "Trust",
      lines: [
        "  Author check/build evaluate the contract module as trusted local code, not in a sandbox.",
        "  include is a build rule, not a subcommand. Old bundles without an exact manifest must be rebuilt.",
      ],
    },
  ],
};
async function run(argv: string[], globals: GlobalOptions): Promise<void> {
  if (globals.help || !argv.length) {
    writeResult(
      {
        schemaVersion: 1,
        command: "task-bundle",
        subcommands: ["init", "check", "build"],
        ...helpMetadata(help),
      },
      globals.format,
      formatCommandHelp(help),
    );
    return;
  }
  const [command, ...args] = argv;
  let result: unknown;
  if (command === "init") {
    if (args.length > 1 || args[0]?.startsWith("-")) throw new CliError("Use init [directory].");
    result = await (await import("./init.js")).initTaskBundle(resolve(globals.cwd, args[0] ?? "."));
  } else if (command === "check") {
    if (args.length !== 2 || !["author", "artifact"].includes(args[0]!))
      throw new CliError(
        "Use check author <task.build.yaml> or check artifact <bundle.car|directory>.",
      );
    result =
      args[0] === "author"
        ? await (await import("./authoring.js")).checkTaskBuild(resolve(globals.cwd, args[1]!))
        : await checkTaskArtifact(resolve(globals.cwd, args[1]!));
  } else if (command === "build") {
    if (args.length !== 1 || args[0]!.startsWith("-"))
      throw new CliError("Use build <task.build.yaml>.");
    result = await (await import("./authoring.js")).buildTask(resolve(globals.cwd, args[0]!));
  } else throw new CliError("Unknown task-bundle command; use init, check or build.");
  writeResult(
    { schemaVersion: 1, command: `task-bundle ${command}`, status: "ok", result },
    globals.format,
    `# Task Bundle ${command}\n\n${JSON.stringify(result, null, 2)}`,
  );
}
void commandMain(
  {
    protocol: "pguide-command-v1",
    command: "task-bundle",
    description: help.description,
    version: "0.1.0-rc.0",
  },
  run,
);
