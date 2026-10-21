import assert from "node:assert/strict";
import { test } from "node:test";
import { getCommandHelp, showCommandHelp } from "../src/command-help.js";
import { formatCommandHelp, globalHelpOptions, helpMetadata } from "../src/help.js";
import { extractGlobals } from "../src/index.js";

test("command help shares authoritative options, defaults, constraints and examples", () => {
  for (const command of [
    "agents",
    "objectives",
    "probe",
    "regulate",
    "continue",
    "supervise",
    "scaffold",
    "validate",
  ] as const) {
    const definition = getCommandHelp(command);
    const metadata = helpMetadata(definition);
    const text = formatCommandHelp(definition);
    assert.ok(text.includes(metadata.usage));
    for (const option of [...metadata.optionDetails, ...globalHelpOptions]) {
      assert.ok(text.includes(option.name), `${command}: ${option.name}`);
      if ("default" in option) assert.ok(text.includes(`default: ${option.default}`));
    }
    for (const constraint of metadata.constraints) assert.ok(text.includes(constraint));
    for (const example of metadata.examples) assert.ok(text.includes(example));
  }
});

test("probe and regulate require either declaration or Pilot, never both", () => {
  for (const command of ["probe", "regulate"] as const) {
    const metadata = helpMetadata(getCommandHelp(command));
    assert.match(metadata.constraints.join("\n"), /mutually exclusive; exactly one is required/);
    assert.ok(metadata.optionDetails.some(({ name }) => name === "--objective"));
    assert.ok(metadata.optionDetails.some(({ name }) => name === "--pilot"));
    assert.ok(metadata.optionDetails.some(({ name }) => name === "--scope"));
    const required = metadata.sections.find(({ title }) => title === "Required");
    assert.match(required?.lines.join("\n") ?? "", /Choose exactly one/);
  }
});

test("resource help is operation-specific and shares global defaults", () => {
  const show = getCommandHelp("agents", "show");
  assert.equal(show.usage, "pguide agents show <name>");
  assert.match(show.description, /unknown names fail/);
  assert.ok(!helpMetadata(show).optionDetails.some(({ name }) => name === "--from"));
  const set = helpMetadata(getCommandHelp("agents", "set"));
  assert.ok(set.optionDetails.some(({ name }) => name === "--from"));
  assert.match(set.constraints.join("\n"), /no default write scope/);
  assert.match(getCommandHelp("objectives", "show").usage, /show <name>/);
});

test("JSON help preserves existing fields and adds complete metadata", (t) => {
  let output = "";
  t.mock.method(process.stdout, "write", (chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });
  const globals = extractGlobals(["--format", "json"]).options;
  showCommandHelp("agents", globals, "show");
  const agents = JSON.parse(output);
  assert.equal(agents.schemaVersion, 1);
  assert.ok(agents.subcommands.includes("migrate"));
  assert.match(agents.resourceSchema, /schemas\/agents\/v1.json$/);
  assert.equal(agents.usage, "pguide agents show <name>");
  output = "";
  showCommandHelp("probe", globals);
  const probe = JSON.parse(output);
  for (const option of [
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
    assert.ok(probe.options.includes(option), option);
  output = "";
  showCommandHelp("scaffold", globals);
  assert.deepEqual(JSON.parse(output).types, ["pilot"]);
});
