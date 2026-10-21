import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../../..");
const script = join(root, "packages", "pilot-protocol", "src", "migrate-cli.ts");
function run(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    execFile(
      process.execPath,
      ["--import", "tsx", script, ...args],
      { cwd: root },
      (error, stdout, stderr) => {
        done({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}
const manifest = {
  schemaVersion: 1,
  domainSchema: { type: "object" },
  levels: [{ id: "initial", advancement: { checks: [] } }],
  defaultLanguage: "en-US",
  languages: ["en-US"],
};
const documents = {
  manifest,
  declarations: {
    schemaVersion: 1,
    objectives: {
      health: {
        description: "Health",
        pilot: "./rules",
        inputSchema: { const: {} },
        subject: "input",
      },
    },
  },
  portfolio: {
    schemaVersion: 3,
    goals: [
      {
        id: "health",
        pilot: "./rules",
        subject: {},
        targetLevel: "terminal",
        priority: 1,
        observationIntervalMs: 100,
      },
    ],
    resources: [],
  },
};

test("all three migration kinds save artifacts and print separate human/JSON receipts", async (t) => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const directory = await mkdtemp(join(root, ".cache", "migration-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [kind, document] of Object.entries(documents)) {
    for (const display of ["markdown", "json", "default"]) {
      const input = join(directory, `${kind}-${display}-input.json`);
      const output = join(directory, `${kind}-${display}.${display === "json" ? "yaml" : "json"}`);
      const source = JSON.stringify(document);
      await writeFile(input, source);
      const args = [
        "--format",
        kind,
        "--input",
        input,
        "--output",
        output,
        ...(display === "default" ? [] : ["--output-format", display]),
      ];
      const result = await run(args);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(await readFile(input, "utf8"), source);
      const bytes = await readFile(output, "utf8");
      const artifact = display === "json" ? parse(bytes) : JSON.parse(bytes);
      assert.ok(artifact);
      if (display === "json") {
        const receipt = JSON.parse(result.stdout);
        assert.equal(receipt.status, "migrated");
        assert.equal(receipt.format, kind);
        assert.equal(receipt.output, output);
        assert.equal(receipt.artifactFormat, "yaml");
        assert.equal(receipt.inputUnchanged, true);
        assert.equal(receipt.overwritten, false);
      } else {
        assert.match(result.stdout, /Migration completed/);
        assert.ok(result.stdout.includes(output));
        assert.match(result.stdout, /Artifact format: json/);
        assert.match(result.stdout, /unchanged/);
      }
      const repeated = await run(args);
      assert.equal(repeated.code, 1);
      assert.equal(await readFile(output, "utf8"), bytes);
      if (display === "json") {
        assert.equal(JSON.parse(repeated.stdout).status, "error");
        assert.equal(repeated.stderr, "");
      } else {
        assert.equal(repeated.stdout, "");
        assert.match(repeated.stderr, /EEXIST/);
      }
    }
  }
});

test("migration help is additive, explicit display is separate from document kind", async () => {
  const explicit = await run(["--help", "--output-format", "json"]);
  const legacy = await run(["--help", "--format", "json"]);
  assert.equal(explicit.code, 0);
  assert.deepEqual(JSON.parse(explicit.stdout), JSON.parse(legacy.stdout));
  const help = JSON.parse(explicit.stdout);
  assert.equal(help.schemaVersion, 1);
  assert.equal(help.command, "objective-contract-migrate");
  assert.match(help.safety, /Pinned/);
  assert.ok(
    help.optionDetails.some((option: { name: string }) => option.name === "--output-format"),
  );
  const text = await run(["--help"]);
  for (const example of help.examples) assert.ok(text.stdout.includes(example));
  for (const constraint of help.constraints) assert.ok(text.stdout.includes(constraint));
  assert.match(text.stdout, /Legacy help-only compatibility/);
  const notAnOutputSelector = await run(["--help", "--input", "json"]);
  assert.match(notAnOutputSelector.stdout, /^Explicit, non-overwriting/);
});

test("invalid usage preserves default stderr and gives one explicit JSON failure", async () => {
  for (const args of [
    [],
    ["--format", "json"],
    ["--unknown", "value"],
    ["--format", "manifest", "--format", "portfolio"],
    ["--output-format", "yaml"],
  ]) {
    const result = await run(args);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
  }
  const json = await run(["--format", "json", "--output-format", "json"]);
  assert.equal(json.code, 1);
  assert.equal(json.stderr, "");
  assert.equal(JSON.parse(json.stdout).status, "error");
});

test("migration CLI refuses same-file output and pinned Portfolio evidence without touching input", async (t) => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const directory = await mkdtemp(join(root, ".cache", "migration-safety-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, "input.json");
  const document = {
    ...documents.portfolio,
    goals: [{ ...documents.portfolio.goals[0], revision: "a".repeat(40) }],
  };
  const source = JSON.stringify(document);
  await writeFile(input, source);
  for (const output of [input, join(directory, "output.json")]) {
    const result = await run([
      "--format",
      "portfolio",
      "--input",
      input,
      "--output",
      output,
      "--output-format",
      "json",
    ]);
    assert.equal(result.code, 1);
    assert.match(JSON.parse(result.stdout).error.message, /never overwrites|Pinned/);
    assert.equal(await readFile(input, "utf8"), source);
  }
  await assert.rejects(readFile(join(directory, "output.json")), /ENOENT/);
});
