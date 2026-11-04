#!/usr/bin/env node
import { resolve } from "node:path";
import {
  CliError,
  type CommandHelp,
  commandMain,
  formatCommandHelp,
  type GlobalOptions,
  helpMetadata,
  loadConfig,
  setting,
  writeResult,
} from "@potential-guide/cli-core";
import { checkTaskArtifact } from "@potential-guide/task-sdk/artifact";
import { createIpfsClient, importTaskBundle } from "@potential-guide/task-sdk/publish";

const help: CommandHelp = {
  description: "Initialize, check, build and publish complete TypeBox Task Bundles.",
  usage:
    "pguide task-bundle init [directory] | check author <task.build.yaml> | check artifact <directory> | build <task.build.yaml> | publish <directory> [--ipfs-rpc <url>]",
  sections: [
    {
      title: "Commands",
      lines: [
        "  init [directory]        Create a minimal Echo task and declare TypeBox in the nearest npm package; offline.",
        "  check author <file>     Compile trusted author input in memory; no output writes or network publishing.",
        "  check artifact <dir>    Validate exact manifest, Schema and UnixFS CID; never evaluate author code.",
        "  build <file>            Replace only managed output after complete validation; no network publishing.",
        "  publish <dir>           Import and pin an already built artifact; never build or execute Tasks.",
      ],
    },
    {
      title: "Configuration",
      lines: [
        "  --ipfs-rpc overrides task-bundle.ipfsRpc from pguide user -> nearest project config.jsonc.",
        "  No default node, daemon startup or global configuration writes. Only publish uses RPC.",
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
        subcommands: ["init", "check", "build", "publish"],
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
      throw new CliError("Use check author <task.build.yaml> or check artifact <directory>.");
    result =
      args[0] === "author"
        ? await (await import("./authoring.js")).checkTaskBuild(resolve(globals.cwd, args[1]!))
        : await checkTaskArtifact(resolve(globals.cwd, args[1]!));
  } else if (command === "build") {
    if (args.length !== 1 || args[0]!.startsWith("-"))
      throw new CliError("Use build <task.build.yaml>.");
    result = await (await import("./authoring.js")).buildTask(resolve(globals.cwd, args[0]!));
  } else if (command === "publish") {
    if (
      !(args.length === 1 || (args.length === 3 && args[1] === "--ipfs-rpc")) ||
      args[0]!.startsWith("-")
    )
      throw new CliError("Use publish <directory> [--ipfs-rpc <url>].");
    const directory = resolve(globals.cwd, args[0]!);
    await checkTaskArtifact(directory);
    const config = await loadConfig(globals.cwd, ["task-bundle"]);
    const rpc = args[2] ?? setting<string>(config.value, "task-bundle.ipfsRpc");
    if (typeof rpc !== "string" || !/^https?:\/\//.test(rpc))
      throw new CliError(
        "Publish requires --ipfs-rpc or task-bundle.ipfsRpc (an HTTP(S) Kubo RPC URL).",
      );
    const url = new URL(rpc);
    if (url.username || url.password || url.search || url.hash)
      throw new CliError("IPFS RPC URL must not embed credentials, query or fragment.");
    result = await importTaskBundle(directory, await createIpfsClient(url.href));
  } else throw new CliError("Unknown task-bundle command; use init, check, build or publish.");
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
