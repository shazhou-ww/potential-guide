import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// 使用指定 checkout 的真实 init/build；所有中间文件都在该 checkout 内。
const root = resolve(process.argv[2] ?? ".");
const output = resolve(process.argv[3] ?? "schema-measure.json");
const load = (path) => import(pathToFileURL(join(root, path)).href);
const { initTaskBundle } = await load("packages/pguide-task-bundle/dist/init.js");
const { readTaskBuild, buildTask } = await load("packages/pguide-task-bundle/dist/authoring.js");
const { compileTaskBundle } = await load("packages/pguide-task-bundle/dist/build.js");
const fixture = join(root, ".schema-measure");
await mkdir(fixture);
try {
  const cases = [];
  for (const name of ["default", "repeat", ...(process.argv.includes("--expanded") ? ["representative", "author-validator"] : [])]) {
    const directory = join(fixture, name);
    await mkdir(directory);
    await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}\n');
    const initialized = await initTaskBundle(directory);
    for (const [scope, name] of [["@sinclair", "typebox"], ["@potential-guide", "task-sdk"], ["@potential-guide", "task-protocol"]]) {
      await mkdir(join(directory, "node_modules", scope), {recursive: true});
      await symlink(
        await realpath(join(root, "packages/pguide-task-bundle/node_modules", scope, name)),
        join(directory, "node_modules", scope, name),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    if (name === "representative")
      await writeFile(join(directory, "src/contract.ts"), `import { Type } from "@sinclair/typebox";
const text = Type.String({$id: "https://example.test/text", maxLength: 12});
export default {
  input: Type.Intersect([Type.Object({text: Type.String({minLength: 2})}), Type.Object({text: Type.Ref(text)})]),
  result: Type.Object({text: Type.Ref(text)}),
  message: Type.Never(), schemas: [text],
};
`);
    if (name === "author-validator") {
      await writeFile(join(directory, "src/main.ts"), `import {runTask} from "@potential-guide/task-sdk";
import {compileJsonSchema} from "@potential-guide/task-protocol";
import type {Static} from "@sinclair/typebox";
import type contract from "./contract.js";
const authorValidator = compileJsonSchema({type: "string", minLength: 5});
runTask(async (input: Static<typeof contract.input>) => {
  authorValidator.validate(input.text);
  return {text: input.text};
});
`);
      const manifest = JSON.parse(await readFile(initialized.packageFile, "utf8"));
      manifest.dependencies["@potential-guide/task-protocol"] = "0.1.0-rc.0";
      await writeFile(initialized.packageFile, JSON.stringify(manifest));
    }
    const built = await buildTask(initialized.buildFile);
    const analyzed = await compileTaskBundle(await readTaskBuild(initialized.buildFile));
    if (process.argv.includes("--expanded") && name !== "author-validator") {
      const inputs = Object.keys(analyzed.metafile.inputs).map((path) => path.replaceAll("\\", "/"));
      assert.ok(!inputs.some((path) => /(?:ajv\/|fast-uri|multiformats|schema-runtime|task-validator:)/.test(path)), inputs.join("\n"));
      assert.ok(!inputs.some((path) => path.endsWith("/contract.ts")));
    }
    const worker = await readFile(join(built.directory, "worker.cjs"));
    assert.deepEqual(worker, analyzed.contents.get("worker.cjs"));
    const contributions = {};
    for (const result of Object.values(analyzed.metafile?.outputs ?? {}))
      for (const [path, { bytesInOutput }] of Object.entries(result.inputs))
        contributions[path.replaceAll("\\", "/").replaceAll(root.replaceAll("\\", "/"), "<root>")] = bytesInOutput;
    cases.push({
      name, cid: built.cid, workerBytes: worker.length,
      workerSha256: createHash("sha256").update(worker).digest("hex"),
      totalBytes: [...analyzed.contents.values()].reduce((sum, bytes) => sum + bytes.length, 0),
      ...(built.car ? {carBytes: (await readFile(built.car)).length} : {}),
      files: Object.fromEntries([...analyzed.contents].map(([path, bytes]) => [path, bytes.length])),
      contributions,
      source: await readFile(join(directory, "src/main.ts"), "utf8"),
      contractSource: await readFile(join(directory, "src/contract.ts"), "utf8"),
      manifest: JSON.parse(await readFile(initialized.packageFile, "utf8")),
    });
  }
  assert.equal(cases[0].cid, cases[1].cid);
  assert.equal(cases[0].workerSha256, cases[1].workerSha256);
  const lock = await readFile(join(root, "pnpm-lock.yaml"));
  const result = {
    checkoutHead: execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim(),
    node: process.version,
    esbuild: (await load("node_modules/esbuild/lib/main.js")).version,
    lockSha256: createHash("sha256").update(lock).digest("hex"),
    cases,
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({output, ...cases[0], contributions: Object.keys(cases[0].contributions).length}));
} finally {
  await rm(fixture, {recursive: true, force: true});
}
