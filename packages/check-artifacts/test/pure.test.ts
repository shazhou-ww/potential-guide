import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { build } from "esbuild";
import {
  checkerSchemaUri,
  objectiveSchemaUri,
  parseCheckerManifest,
  parseObjectiveArtifactManifest,
  inspectContractFiles,
  assertRuntime,
  validateArtifactSubject,
  parseCheckerResult,
  mapSubject,
  gitTreeDigest,
} from "../src/pure.js";

const page = Buffer.from("---\ntitle: Pure\ndescription: Pure\n---\nBody\n");
const checker = {
  $schema: checkerSchemaUri,
  runtime: { type: "node", minVersion: "999.0.0" },
  entry: "checker.cjs",
  subjectSchema: { type: "object" },
  problems: [],
  languages: ["en"],
};
test("one pure entry separates manifest, complete files/References/digest and actual runtime", () => {
  const manifest = parseCheckerManifest(Buffer.from(JSON.stringify(checker)));
  const incomplete = new Map([["checker.yaml", Buffer.from(JSON.stringify(checker))]]);
  assert.throws(() => inspectContractFiles(incomplete));
  const files = new Map([
    ...incomplete,
    ["checker.cjs", Buffer.from("exports.execute=()=>{}")],
    ["references/en/checker.md", page],
  ]);
  const complete = inspectContractFiles(files);
  assert.equal(complete.digest, gitTreeDigest(files));
  assert.throws(() => assertRuntime(manifest, { type: "node", version: process.versions.node }));
  const changed = new Map(files);
  changed.set("checker.cjs", Buffer.from("exports.execute=()=>null"));
  assert.notEqual(inspectContractFiles(changed).digest, complete.digest);
  changed.set(
    "references/en/checker.md",
    Buffer.from("---\ntitle: Bad\ndescription: Bad\nreferences: [missing]\n---\nBody\n"),
  );
  assert.throws(() => inspectContractFiles(changed), /reference|page|target/i);
  assert.throws(() =>
    parseCheckerManifest(Buffer.from(JSON.stringify({ ...checker, unknown: true }))),
  );
  assert.throws(() =>
    parseCheckerManifest(
      Buffer.from(
        JSON.stringify({ ...checker, runtime: { type: "browser", minVersion: "1.0.0" } }),
      ),
    ),
  );
  assert.ok(validateArtifactSubject(manifest, mapSubject('{"a": root}', { root: 1 })));
  assert.deepEqual(
    parseCheckerResult({ status: 200, message: "", payload: { ok: true, problems: [] } }, manifest),
    { ok: true, problems: [] },
  );
  const objective = {
    $schema: objectiveSchemaUri,
    subjectSchema: { type: "object" },
    languages: ["en"],
    levels: [{ id: "ready", checks: ["check"] }],
    checkers: {
      check: {
        url: "https://example.test/check.tgz",
        digest: complete.digest,
        subjectMapping: "$",
      },
    },
  };
  parseObjectiveArtifactManifest(Buffer.from(JSON.stringify(objective)));
  const objectiveFiles = new Map([
    ["objective.yaml", Buffer.from(JSON.stringify(objective))],
    ["references/en/objective.md", page],
    ["references/en/levels/ready.md", page],
  ]);
  assert.equal(inspectContractFiles(objectiveFiles).digest, gitTreeDigest(objectiveFiles));
  objectiveFiles.delete("references/en/levels/ready.md");
  assert.throws(() => inspectContractFiles(objectiveFiles));
});
test("contract import graph excludes preparation/build/filesystem/worker modules", async () => {
  const bundle = await build({
    entryPoints: ["src/pure.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const files = Object.keys(bundle.metafile!.inputs);
  assert.ok(!files.some((path) => /(?:archive|manifest|index|build)\.ts$/.test(path)));
  const imports = Object.values(bundle.metafile!.outputs).flatMap((output) =>
    output.imports.map((item) => item.path),
  );
  assert.ok(!imports.some((name) => /(?:fs|worker_threads|child_process|https?|net)$/.test(name)));
});
test("independent import and calls cannot network, write, or create workers", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {createRequire,syncBuiltinESMExports} from "node:module";
    const require=createRequire(import.meta.url);
    const deny=()=>{throw Error("forbidden side effect")};
    for (const [module,names] of [
      ["node:fs",["writeFile","writeFileSync","mkdir","mkdirSync","createWriteStream","rename","unlink"]],
      ["node:fs/promises",["writeFile","mkdir","rename","unlink"]],
      ["node:net",["connect","createConnection"]],
      ["node:http",["request","get","createServer"]],
      ["node:https",["request","get","createServer"]],
      ["node:worker_threads",["Worker"]],
      ["node:child_process",["spawn","fork","exec","execFile"]]]) {
      const target=require(module);for(const name of names)target[name]=deny;
    }
    globalThis.fetch=deny;syncBuiltinESMExports();
    const c=await import("@potential-guide/check-artifacts/contracts");
    const checker=${JSON.stringify({ ...checker, runtime: { type: "node", minVersion: "22.13.0" } })};
    const bytes=Buffer.from(JSON.stringify(checker));
    const manifest=c.parseCheckerManifest(bytes);
    c.inspectContractFiles(new Map([["checker.yaml",bytes],["checker.cjs",Buffer.from("exports.execute=()=>{}")],["references/en/checker.md",Buffer.from(${JSON.stringify(page.toString())})]]));
    c.validateArtifactSubject(manifest,c.mapSubject("$",{}));
    c.parseCheckerResult({status:200,message:"",payload:{ok:true,problems:[]}},manifest);
    c.assertRuntime(manifest,{type:"node",version:process.versions.node});
    console.log("pure");
  `,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(output.trim(), "pure");
});
