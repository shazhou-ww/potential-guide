import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { bin, fixture, run } from "./fixtures.js";

test("subject errors are readable while JSON retains the original error and exit contract", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const original = await readFile(f.manifest, "utf8");
  const manifest = original.replace(
    "subjectSchema:\n  type: object",
    "subjectSchema:\n  type: object\n  required: [name]\n  properties:\n    name:\n      type: string",
  );
  assert.notEqual(manifest, original);
  await writeFile(f.manifest, manifest);
  await f.commit();
  const args = ["--pilot", f.uri, "--subject-file", f.subject, "--no-reports"];
  const normal = await run(bin("probe"), args);
  const markdown = await run(bin("probe"), [...args, "--format", "markdown"]);
  assert.equal(normal.code, 2, normal.stdout + normal.stderr);
  assert.equal(markdown.stdout, normal.stdout);
  assert.match(normal.stdout, /Invalid subject for/);
  assert.match(normal.stdout, /Input issues:/);
  assert.match(normal.stdout, /must have required property 'name'/);
  assert.match(normal.stdout, /Next: correct the subject fields/);
  assert.doesNotMatch(normal.stdout, /"instancePath":/);
  assert.equal(normal.stderr, "");
  const machine = await run(bin("probe"), [...args, "--format", "json"]);
  assert.equal(machine.code, 2);
  assert.equal(machine.stderr, "");
  const value = JSON.parse(machine.stdout);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.status, "pilot-error");
  assert.match(value.error, /"instancePath":/);
  assert.match(value.error, /"keyword":"required"/);
  assert.equal("humanMessage" in value, false);
});

test("unsupported language errors name available locales without changing machine fields", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  await f.commit();
  const args = [
    "--pilot",
    f.uri,
    "--subject-file",
    f.subject,
    "--language",
    "fr-FR",
    "--no-reports",
  ];
  const normal = await run(bin("probe"), args);
  assert.equal(normal.code, 2, normal.stdout + normal.stderr);
  assert.match(normal.stdout, /Unsupported language `fr-FR`/);
  assert.match(normal.stdout, /Supported languages: `en-US`, `zh-CN`/);
  assert.match(normal.stdout, /Next: choose a supported --language/);
  const machine = await run(bin("probe"), [...args, "--format", "json"]);
  assert.equal(machine.code, 2);
  assert.deepEqual(JSON.parse(machine.stdout), {
    schemaVersion: 1,
    status: "pilot-error",
    error: `Unsupported language fr-FR for ${f.uri}.`,
  });
});
