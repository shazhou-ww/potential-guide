import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { bin, root, run } from "./fixtures.js";

const config = join(root, "packages", "pguide-config", "dist", "bin.js");
const agents = join(root, "packages", "pguide-agents", "dist", "bin.js");
const top = join(root, "packages", "pguide", "dist", "bin.js");

test("standalone command help JSON preserves existing fields and matches human content", async () => {
  for (const command of [
    "probe",
    "regulate",
    "continue",
    "supervise",
    "scaffold",
    "validate",
    "objectives",
  ]) {
    const text = await run(bin(command), ["--help"]);
    const json = await run(bin(command), ["--help", "--format", "json"]);
    assert.equal(text.code, 0, text.stdout);
    assert.equal(json.code, 0, json.stdout);
    assert.equal(text.stderr, "");
    assert.equal(json.stderr, "");
    const help = JSON.parse(json.stdout);
    assert.equal(help.schemaVersion, 1);
    assert.equal(help.command, command);
    assert.ok(text.stdout.includes(help.usage));
    for (const example of help.examples) assert.ok(text.stdout.includes(example));
    for (const constraint of help.constraints) assert.ok(text.stdout.includes(constraint));
    for (const option of [...help.optionDetails, ...help.globalOptions]) {
      assert.ok(text.stdout.includes(option.name));
      if ("default" in option) assert.ok(text.stdout.includes(`default: ${option.default}`));
    }
    if (command === "scaffold" || command === "validate") assert.deepEqual(help.types, ["pilot"]);
    if (command === "probe") {
      for (const name of [
        "--pilot",
        "--subject-file",
        "--language",
        "--revision",
        "--report",
        "--objective",
        "--scope",
        "--input-file",
        "--report-dir",
        "--no-reports",
      ])
        assert.ok(help.options.includes(name));
    }
  }
});

test("agents operation help retains resource metadata and works through dispatch", async () => {
  for (const [script, prefix] of [
    [agents, []],
    [top, ["agents"]],
  ] as const) {
    const result = await run(script, [...prefix, "show", "--help", "--format", "json"]);
    assert.equal(result.code, 0, result.stdout);
    const help = JSON.parse(result.stdout);
    assert.equal(help.usage, "pguide agents show <name>");
    assert.match(help.description, /unknown names fail/);
    assert.deepEqual(help.subcommands, [
      "list",
      "show",
      "set",
      "remove",
      "edit",
      "validate",
      "path",
      "migrate",
    ]);
    assert.match(help.resourceSchema, /schemas\/agents\/v1.json$/);
    assert.equal(
      help.globalOptions.find((option: { name: string }) => option.name === "--format").default,
      "markdown",
    );
  }
  const noCommand = await run(agents, ["--format", "json"]);
  assert.equal(JSON.parse(noCommand.stdout).command, "agents");
});

test("config help retains existing metadata and recommends only supported replacement examples", async () => {
  for (const subcommand of [
    undefined,
    "add-agent",
    "update-agent",
    "remove-agent",
    "show-agent",
    "list-agents",
    "add-objective",
    "update-objective",
  ]) {
    const args = [...(subcommand ? [subcommand] : []), "--help"];
    const text = await run(config, args);
    const json = await run(config, [...args, "--format", "json"]);
    assert.equal(json.code, 0, json.stdout);
    const help = JSON.parse(json.stdout);
    assert.equal(help.command, "config");
    assert.equal(help.configurationSchemaVersion, 2);
    assert.equal(help.regulationStrategyDefaults.quota.maxAgentRuns, 10);
    assert.ok(help.subcommands.includes("add-agent"));
    for (const example of help.examples) {
      assert.ok(text.stdout.includes(example));
      assert.doesNotMatch(
        example,
        /pguide config (?:add|update|remove|show|list)-agent|pguide config (?:add|update)-objective/,
      );
    }
    assert.ok(text.stdout.includes(help.usage));
    assert.equal(
      help.optionDetails.find((option: { name: string }) => option.name === "--scope").default,
      "project",
    );
  }
});
