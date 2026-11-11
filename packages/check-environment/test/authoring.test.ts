import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { prepareCheck, verifyCheckResources } from "@potential-guide/check-sdk/authoring";
import { buildTask, inspectTaskArtifact, readTaskArtifact } from "@potential-guide/task-authoring";
import { normalizeTaskText } from "@silvermoon-work/task-protocol";
import { parse, stringify } from "yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const execute = promisify(execFile);

test("accepted environment CARs contain only their validated exact resources and schemas", async () => {
  const refs = JSON.parse(await readFile(join(root, "dist/bundles/references.json"), "utf8"));
  for (const kind of ["tools", "directories", "network"]) {
    const config = parse(await readFile(join(root, `${kind}.check.build.yaml`), "utf8"));
    const artifact = await readTaskArtifact(join(root, "dist/bundles", refs[kind].car));
    const directory = await readTaskArtifact(join(root, "dist/bundles", refs[kind].directory));
    assert.deepEqual(artifact.files, directory.files);
    assert.equal((await inspectTaskArtifact(artifact.files)).cid, refs[kind].cid);
    const index = JSON.parse(artifact.files.get("resources/check.json")?.toString() ?? "");
    assert.deepEqual(index.problemCodes, config.problemCodes);
    assert.equal(index.kind, kind);
    const expected = ["resources/check.json"];
    for (const language of config.languages) {
      expected.push(`resources/references/${language}/check.md`);
      for (const code of config.problemCodes)
        expected.push(`resources/references/${language}/problems/${code}.md`);
      for (const [source, target] of [
        [`${config.referenceRoot}/${language}/check.md`, index.references[language].check],
        ...config.problemCodes.map((code: string) => [
          `${config.referenceRoot}/${language}/problems/${code}.md`,
          index.references[language].problems[code],
        ]),
      ])
        assert.deepEqual(
          artifact.files.get(target),
          Buffer.from(normalizeTaskText(await readFile(join(root, source)), target)),
        );
    }
    assert.deepEqual(
      [...artifact.files.keys()].filter((path) => path.startsWith("resources/")).sort(),
      expected.sort(),
    );
    const worker = artifact.files.get("worker.cjs")?.toString() ?? "";
    assert.doesNotMatch(
      worker,
      /prepareCheck|parseDocument|createCheckContract|@sinclair\/typebox/,
    );
  }
});

async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const [path, bytes] of Object.entries(await snapshot(join(directory, entry.name))))
        result[`${entry.name}/${path}`] = bytes;
    } else result[entry.name] = (await readFile(join(directory, entry.name))).toString("base64");
  }
  return result;
}

test("first/second-stage failures preserve every accepted CAR and the final index", {
  timeout: 120000,
}, async () => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const directory = await mkdtemp(join(root, ".cache", "failed-build-"));
  try {
    for (const path of [
      "src",
      "references",
      "tools.check.build.yaml",
      "directories.check.build.yaml",
      "network.check.build.yaml",
    ])
      await cp(join(root, path), join(directory, path), { recursive: true });
    const tsconfig = JSON.parse(await readFile(join(root, "tsconfig.json"), "utf8"));
    tsconfig.extends = join(root, "../../tsconfig.base.json");
    tsconfig.compilerOptions.tsBuildInfoFile = "dist/build.tsbuildinfo";
    await writeFile(join(directory, "tsconfig.json"), JSON.stringify(tsconfig));
    const run = () =>
      execute(process.execPath, [join(root, "build.mjs"), directory], { cwd: root });
    await run();
    const output = join(directory, "dist/bundles");
    const accepted = await snapshot(output);
    const page = join(directory, "references/network/en/check.md");
    const original = await readFile(page);
    await writeFile(page, "invalid reference");
    await assert.rejects(run(), /Check network/);
    assert.deepEqual(await snapshot(output), accepted);
    await writeFile(page, original);
    const contract = join(directory, "src/tasks/network/contract.ts");
    const source = await readFile(contract);
    // TypeScript accepts Date, but the ordinary Task compiler rejects non-JSON contracts.
    await writeFile(
      contract,
      `${source.toString().replace("export default createCheckContract(", "const contract = createCheckContract(")}\nexport default {...contract,message:Type.Date()};\n`,
    );
    await assert.rejects(run(), /Contract evaluation failed/);
    assert.deepEqual(await snapshot(output), accepted);
    await writeFile(contract, source);
    const prepared = await prepareCheck(join(directory, "tools.check.build.yaml"));
    const task = parse(await readFile(prepared.buildFile, "utf8"));
    task.include = task.include.filter(
      (item: { from: string }) => !item.from.endsWith("tool-missing.md"),
    );
    await writeFile(prepared.buildFile, stringify(task));
    const built = await buildTask(prepared.buildFile);
    const omitted = await readTaskArtifact(built.car);
    assert.throws(() => verifyCheckResources(prepared, omitted.files), /selection/);
    assert.deepEqual(await snapshot(output), accepted);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
