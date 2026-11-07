import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCheck, verifyCheckResources } from "@potential-guide/check-sdk/authoring";
import { buildTask } from "@potential-guide/pguide-task-bundle";
import { inspectTaskArtifact, readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";

const artifacts = resolve("artifacts");
await mkdir(artifacts, { recursive: true });
const manifest = {
  schema: 1,
  provenance: JSON.parse(await readFile("source-provenance.json", "utf8")),
  bundles: {},
};
const environment = join(dirname(fileURLToPath(import.meta.resolve(
  "@potential-guide/check-environment",
))), "bundles");
const accepted = JSON.parse(await readFile(join(environment, "references.json"), "utf8"));
for (const kind of ["tools", "directories", "network"]) {
  const reference = accepted[kind];
  const car = join(environment, reference.car);
  const copied = join(artifacts, `${kind}.car`);
  await copyFile(car, copied);
  const artifact = await readTaskArtifact(copied);
  assert.equal((await inspectTaskArtifact(artifact.files)).cid, reference.cid);
  const index = JSON.parse(artifact.files.get("resources/check.json").toString("utf8"));
  assert.equal(index.kind, kind);
  manifest.bundles[kind] = {
    cid: reference.cid, car: `${kind}.car`, languages: index.languages,
    problemCodes: index.problemCodes,
  };
}
const fixture = resolve("text-fixture");
await mkdir(join(fixture, "src"), { recursive: true });
await writeFile(join(fixture, "src", "contract.ts"), `
import {Type} from "@sinclair/typebox";
import {createCheckContract} from "@potential-guide/check-sdk/contracts";
import {languages,problemCodes} from "../dist/definitions/text.js";
export default createCheckContract(Type.Object({text:Type.String()},{additionalProperties:false}),problemCodes,languages);
`);
await writeFile(join(fixture, "src", "main.ts"), `
import {createCheckTask,type CheckObservation} from "@potential-guide/check-sdk";
import {runTask} from "@potential-guide/task-sdk";
import {languages,problemCodes} from "../dist/definitions/text.js";
runTask(createCheckTask(problemCodes,languages,async(input:{text:string})=>{
  const problems:CheckObservation<(typeof problemCodes)[number]>[]=[];
  if(!input.text.trim())problems.push({target:"text",code:"text-empty",actual:input.text});
  if(input.text.length<3)problems.push({target:"text",code:"text-short",actual:String(input.text.length)});
  return problems;
}));
`);
await writeFile(join(fixture, "text.check.build.yaml"), `name: Independent bilingual text
kind: text
source:
  root: src
  entry: src/main.ts
  contract: src/contract.ts
languages: [en, zh-CN]
problemCodes: [text-empty, text-short]
referenceRoot: references
references:
  en:
    check: references/en/check.md
    problems:
      text-empty: references/en/problems/text-empty.md
      text-short: references/en/problems/text-short.md
  zh-CN:
    check: references/zh-CN/check.md
    problems:
      text-empty: references/zh-CN/problems/text-empty.md
      text-short: references/zh-CN/problems/text-short.md
`);
let worker;
for (const version of ["A", "B"]) {
  for (const language of ["en", "zh-CN"]) {
    await mkdir(join(fixture, "references", language, "problems"), { recursive: true });
    for (const page of ["check", "text-empty", "text-short"]) {
      const path = page === "check" ? "check.md" : join("problems", `${page}.md`);
      const title = language === "en" ? `Text ${page} ${version}` : `文本说明 ${page} ${version}`;
      const description = language === "en" ? "Independent consumer verification." : "独立调用方的文档消费验证。";
      await writeFile(join(fixture, "references", language, path),
        `---\ntitle: ${title}\ndescription: ${description}\n---\n\n# ${title}\n\n<!-- deployment:${version}:${language}:${page} -->\n`);
    }
  }
  const prepared = await prepareCheck(join(fixture, "text.check.build.yaml"));
  const built = await buildTask(prepared.buildFile);
  const snapshot = await readTaskArtifact(built.car);
  verifyCheckResources(prepared, snapshot.files);
  if (worker) assert.deepEqual(snapshot.files.get("worker.cjs"), worker);
  worker = Buffer.from(snapshot.files.get("worker.cjs"));
  const car = `text-${version}.car`;
  await copyFile(built.car, join(artifacts, car));
  manifest.bundles[`text${version}`] = {
    cid: built.cid, car, languages: ["en", "zh-CN"],
    problemCodes: ["text-empty", "text-short"], marker: version,
  };
}
assert.notEqual(manifest.bundles.textA.cid, manifest.bundles.textB.cid);
await writeFile(join(artifacts, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("Prepared three packed accepted environment CARs and bilingual A/B CARs.");
