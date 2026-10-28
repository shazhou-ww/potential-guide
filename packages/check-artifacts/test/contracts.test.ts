import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import jsonata from "jsonata";
import {
  assertRuntime,
  checkerSchemaUri,
  composeObjectivePages,
  finiteJson,
  formatArtifactReference,
  gitTreeDigest,
  inspectContractFiles,
  mapSubject,
  objectiveSchemaUri,
  parseArtifactReference,
  parseArtifactYaml,
  parseCheckerManifest,
  parseCheckerResult,
  selectLanguage,
  validateArtifactSubject,
  type CheckerManifest,
  type ContractArtifact,
  type ObjectiveArtifactManifest,
} from "../src/index.js";
const page = (title: string, references: string[] = []) =>
  Buffer.from(
    `---\ntitle: ${title}\ndescription: Guidance\nreferences: ${JSON.stringify(references)}\n---\nBody\n`,
  );
const manifest = {
  $schema: checkerSchemaUri,
  runtime: { type: "node", minVersion: "22.13.0" },
  entry: "checker.cjs",
  subjectSchema: { type: "object" },
  problems: ["invalid"],
  languages: ["en"],
};
test("portable mapping vectors match JSONata without relying on its JavaScript AST", async () => {
  const subject = { root: [1, 2], nested: { value: "yes" }, empty: [] };
  for (const expression of [
    "$",
    '{"a": root}',
    '{"a":[root,3]}',
    '{"a":[[1,2]]}',
    '{"a":[empty,root]}',
    '{"a":nested.value,"b":true}',
  ])
    assert.deepEqual(
      mapSubject(expression, subject),
      await jsonata(expression).evaluate(subject),
      expression,
    );
});
test("subject contracts use Draft 2020-12 rather than silently ignoring tuple constraints", () => {
  const parsed = parseCheckerManifest(
    Buffer.from(
      JSON.stringify({
        ...manifest,
        subjectSchema: {
          type: "object",
          properties: {
            values: { type: "array", prefixItems: [{ type: "number" }], items: false, minItems: 1 },
          },
        },
      }),
    ),
  );
  assert.equal(validateArtifactSubject(parsed, { values: [1] }), true);
  assert.equal(validateArtifactSubject(parsed, { values: ["wrong"] }), false);
  assert.equal(validateArtifactSubject(parsed, { values: [1, 2] }), false);
});
function checkerFiles() {
  return new Map([
    ["checker.yaml", Buffer.from(JSON.stringify(manifest))],
    [
      "checker.cjs",
      Buffer.from(
        "exports.execute = async () => ({status:200,payload:{ok:true,problems:[]},message:''});",
      ),
    ],
    ["references/en/checker.md", page("Checker")],
    ["references/en/problems/invalid.md", page("Invalid")],
  ]);
}
test("Git SHA-256 oracle: directory sorting, Unicode, empty files, bytes and nesting", async () => {
  const directory = resolve(".cache", `git-oracle-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["--no-pager", "-C", directory, ...args], {
        encoding: "utf8",
        windowsHide: true,
      }).trim();
    git("init", "--quiet", "--object-format=sha256");
    const files = new Map([
      ["a.txt", Buffer.from("CRLF\r\n")],
      ["a/z", Buffer.from("LF\n")],
      ["a.cjs", Buffer.alloc(0)],
      ["目录/空", Buffer.from("é")],
      ["a/b/c", Buffer.from([0, 255, 13, 10])],
    ]);
    function oracle(entries: ReadonlyMap<string, Buffer>): string {
      const directories = new Map<string, Map<string, Buffer>>();
      const records: string[] = [];
      for (const [name, bytes] of entries) {
        const slash = name.indexOf("/");
        if (slash >= 0) {
          const first = name.slice(0, slash);
          const child = directories.get(first) ?? new Map();
          child.set(name.slice(slash + 1), bytes);
          directories.set(first, child);
        } else {
          const oid = execFileSync("git", ["-C", directory, "hash-object", "-w", "--stdin"], {
            input: bytes,
            windowsHide: true,
          })
            .toString()
            .trim();
          records.push(`100644 blob ${oid}\t${name}\0`);
        }
      }
      for (const [name, child] of directories)
        records.push(`040000 tree ${oracle(child)}\t${name}\0`);
      return execFileSync("git", ["-C", directory, "mktree", "-z"], {
        input: records.reverse().join(""),
        windowsHide: true,
      })
        .toString()
        .trim();
    }
    assert.equal(gitTreeDigest(files), `sha256:${oracle(files)}`);
    const before = gitTreeDigest(files);
    files.set("a.txt", Buffer.from("CRLF\n"));
    assert.notEqual(gitTreeDigest(files), before);
    assert.throws(
      () =>
        gitTreeDigest(
          new Map([
            ["A/file", Buffer.alloc(0)],
            ["a/other", Buffer.alloc(0)],
          ]),
        ),
      /Ambiguous/,
    );
    assert.throws(
      () =>
        gitTreeDigest(
          new Map([
            ["a", Buffer.alloc(0)],
            ["a/b", Buffer.alloc(0)],
          ]),
        ),
      /directory/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("safe YAML and exact Checker shape reject ambiguous or executable inputs", () => {
  for (const yaml of [
    "a: 1\na: 2",
    "a: &x [1]\nb: *x",
    "a: !!str hello",
    "a: .nan",
    "a: .inf",
    "? [a,b]\n: value",
    "%YAML 1.1\n---\na: yes",
  ])
    assert.throws(() => parseArtifactYaml(Buffer.from(yaml)), yaml);
  assert.deepEqual(parseArtifactYaml(Buffer.from("a: true\nb: [1, null, value]")), {
    a: true,
    b: [1, null, "value"],
  });
  for (const extra of [
    { id: "local" },
    { version: 1 },
    { resources: [] },
    { protocol: "x" },
    { runtime: { type: "python", minVersion: "3.13.0" } },
    { runtime: { type: "node", minVersion: ">=22" } },
    { entry: "../bad.cjs" },
  ])
    assert.throws(() =>
      parseCheckerManifest(Buffer.from(JSON.stringify({ ...manifest, ...extra }))),
    );
  const parsed = parseCheckerManifest(Buffer.from(JSON.stringify(manifest)));
  assertRuntime(parsed, { type: "node", version: "22.13.0" });
  assertRuntime(parsed, { type: "node", version: "23.0.0" });
  assert.throws(() => assertRuntime(parsed, { type: "node", version: "22.12.99" }));
  assert.throws(
    () =>
      assertRuntime(
        { ...parsed, runtime: { type: "node", minVersion: "1.0.0" } },
        { type: "node", version: "20.0.0" },
      ),
    /Host support policy/,
  );
  assert.throws(() => assertRuntime(parsed, { type: "python", version: "99.0.0" }));
  assert.equal(selectLanguage(["en"], ["zh-CN", "en"]), "en");
  assert.throws(() => selectLanguage(["en"], ["zh-CN"]));
});
test("references derive identity and retain whole-page overrides and base origins", () => {
  const checker = inspectContractFiles(checkerFiles()) as ContractArtifact<CheckerManifest>;
  const objectiveFiles = new Map([
    [
      "objective.yaml",
      Buffer.from(
        JSON.stringify({
          $schema: objectiveSchemaUri,
          subjectSchema: { type: "object" },
          languages: ["en"],
          levels: [{ id: "ready", checks: ["layout"] }],
          checkers: {
            layout: {
              url: "https://example.test/1/checker.tgz",
              digest: checker.digest,
              subjectMapping: "$",
            },
          },
        }),
      ),
    ],
    ["references/en/objective.md", page("Objective")],
    ["references/en/levels/ready.md", page("Ready")],
    [
      "references/en/checkers/layout/problems/invalid.md",
      page("Override", ["pages/base-layout-invalid"]),
    ],
  ]);
  const objective = inspectContractFiles(
    objectiveFiles,
  ) as ContractArtifact<ObjectiveArtifactManifest>;
  const pages = composeObjectivePages(objective, { layout: checker });
  assert.equal(pages.en?.["checkers/layout/problems/invalid"]?.title, "Override");
  assert.equal(
    pages.en?.["checkers/layout/problems/invalid"]?.origin.artifactDigest,
    objective.digest,
  );
  assert.equal(pages.en?.["pages/base-layout-invalid"]?.origin.artifactDigest, checker.digest);
  assert.equal(pages.en?.["system/404"], undefined);
  const unsupported = new Map(checkerFiles());
  unsupported.set("extra.txt", Buffer.from("extra"));
  assert.throws(() => inspectContractFiles(unsupported), /Undeclared/);
  const missing = new Map(checkerFiles());
  missing.delete("references/en/checker.md");
  assert.throws(() => inspectContractFiles(missing), /Missing/);
  const cycle = new Map(checkerFiles());
  cycle.set("references/en/checker.md", page("Cycle", ["checker"]));
  assert.throws(() => inspectContractFiles(cycle), /cycle/);
  objectiveFiles.set("references/en/checkers/unknown/checker.md", page("Wrong"));
  assert.throws(
    () =>
      composeObjectivePages(
        inspectContractFiles(objectiveFiles) as ContractArtifact<ObjectiveArtifactManifest>,
        { layout: checker },
      ),
    /override/,
  );
});
test("fixed result payload, typed references, finite JSON and bounded mapping vectors", () => {
  const parsed = parseCheckerManifest(Buffer.from(JSON.stringify(manifest)));
  assert.deepEqual(
    parseCheckerResult({ status: 200, message: "", payload: { ok: true, problems: [] } }, parsed),
    { ok: true, problems: [] },
  );
  for (const payload of [
    { ok: true, problems: [{ kind: "internal", id: "invalid", parameters: {} }] },
    { ok: false, problems: [] },
    { ok: false, problems: [{ kind: "internal", id: "unknown", parameters: {} }] },
  ])
    assert.throws(() => parseCheckerResult({ status: 200, message: "", payload }, parsed));
  const reference = {
    kind: "objective" as const,
    url: "https://example.test/a%23b?b=2&a=1",
    digest: `sha256:${"a".repeat(64)}`,
  };
  assert.deepEqual(parseArtifactReference(formatArtifactReference(reference)), reference);
  assert.throws(() => parseArtifactReference(`${formatArtifactReference(reference)}#x`));
  let invoked = false;
  assert.equal(
    finiteJson({
      get value() {
        invoked = true;
        return 1;
      },
    }),
    false,
  );
  assert.equal(invoked, false);
  assert.equal(
    finiteJson({
      toJSON() {
        return {};
      },
    }),
    false,
  );
  assert.deepEqual(
    mapSubject('{"root": root, "nested": {"value": $.nested.value}, "list": [1, true, null]}', {
      root: "path",
      nested: { value: "yes" },
    }),
    { root: "path", nested: { value: "yes" }, list: [1, true, null] },
  );
  assert.deepEqual(mapSubject("$", { root: "path" }), { root: "path" });
  for (const expression of [
    "$now()",
    "$eval('x')",
    "missing",
    '{"x": 1, "x": 2}',
    "$map([1], function($x){$x})",
  ])
    assert.throws(() => mapSubject(expression, {}));
});
