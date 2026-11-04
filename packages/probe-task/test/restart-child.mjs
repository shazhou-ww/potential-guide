import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  checkerSchemaUri,
  inspectContractFiles,
  objectiveSchemaUri,
} from "@potential-guide/check-artifacts/contracts";
import { createCheckTaskType } from "@potential-guide/check-task";
import { MemoryIpfsClient } from "@potential-guide/task-engine/testing";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { taskSchemaUri } from "@potential-guide/task-protocol";
import { buildTaskBundle } from "@potential-guide/task-sdk/build";
import { importTaskBundle } from "@potential-guide/task-sdk/publish";
import { createProbeTaskType } from "../dist/index.js";

const [database, directory] = process.argv.slice(2);
const page = Buffer.from("---\ntitle: Test\ndescription: Test\n---\nBody\n");
const check = inspectContractFiles(
  new Map([
    [
      "checker.yaml",
      Buffer.from(
        JSON.stringify({
          $schema: checkerSchemaUri,
          runtime: { type: "node", minVersion: "22.13.0" },
          entry: "checker.cjs",
          subjectSchema: { type: "object" },
          languages: ["en"],
          problems: [],
        }),
      ),
    ],
    [
      "checker.cjs",
      Buffer.from(
        "exports.execute=s=>{require('node:fs').appendFileSync(s.marker,s.name+'\\n');if(s.spin)while(true){};return {status:200,message:'',payload:{ok:true,problems:[]}}}",
      ),
    ],
    ["references/en/checker.md", page],
  ]),
);
const root = inspectContractFiles(
  new Map([
    [
      "objective.yaml",
      Buffer.from(
        JSON.stringify({
          $schema: objectiveSchemaUri,
          subjectSchema: { type: "object" },
          languages: ["en"],
          levels: [{ id: "ready", checks: ["check"] }],
          checkers: {
            check: { url: "https://example.test/check", digest: check.digest, subjectMapping: "$" },
          },
        }),
      ),
    ],
    ["references/en/objective.md", page],
    ["references/en/levels/ready.md", page],
  ]),
);
const source = {
  authorize() {},
  async resolve(ref) {
    return ref.kind === "objective" ? root : check;
  },
};
const ipfsClient = new MemoryIpfsClient();
for (const kind of ["check-task", "probe-task"]) {
  try {
    await importTaskBundle(join(dirname(database), kind), ipfsClient);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const server = await startTaskServer({
  database,
  port: 0,
  ipfsClient,
  limits: {
    maxConcurrent: 4,
    maxPayloadBytes: 100663296,
    queryPageBytes: 100663296,
    sourceEnvelopeBytes: 100663296,
  },
  authorize: () => true,
  resolveCaller: () => ({ scope: "a", subject: "tester" }),
});
const referenceFile = join(dirname(database), "references.json");
let references;
try {
  references = JSON.parse(await readFile(referenceFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const sourceCode = `import {inspectContractFiles} from "@potential-guide/check-artifacts/contracts";
const check=inspectContractFiles(new Map(${JSON.stringify([...check.files].map(([path, bytes]) => [path, bytes.toString("base64")]))}.map(([path,text])=>[path,Buffer.from(text,"base64")])));
const root=inspectContractFiles(new Map(${JSON.stringify([...root.files].map(([path, bytes]) => [path, bytes.toString("base64")]))}.map(([path,text])=>[path,Buffer.from(text,"base64")])));
const source={authorize(){},async resolve(ref){return ref.kind==="objective"?root:check}};`;
  async function build(kind, type, code) {
    const yaml = join(dirname(database), kind + ".yaml"),
      entry = join(dirname(database), kind + ".ts");
    await writeFile(
      yaml,
      JSON.stringify({
        $schema: taskSchemaUri,
        name: kind,
        runtime: { type: "node", minVersion: "22.13.0" },
        entry: "worker.cjs",
        inputSchema: type.inputSchema,
        resultSchema: type.resultSchema,
        messageSchema: false,
      }),
    );
    await writeFile(entry, sourceCode + code);
    const built = await buildTaskBundle({
      declaration: yaml,
      entry,
      outDirectory: join(dirname(database), kind),
    });
    return (await importTaskBundle(built.directory, ipfsClient)).cid;
  }
  const checkType = createCheckTaskType({ source, directory });
  const checkBundle = await build(
    "check-task",
    checkType,
    `
import {createCheckTaskType} from "@potential-guide/check-task";
const type=createCheckTaskType({source,directory:${JSON.stringify(directory)}});export default(input,context)=>type.run(input,context);`,
  );
  const probeType = createProbeTaskType({
    source,
    checkBundle,
    checkEnvironment: checkBundle,
    children() {
      throw Error("Author only.");
    },
  });
  const probeBundle = await build(
    "probe-task",
    probeType,
    `
import {createProbeTaskType} from "@potential-guide/probe-task";
import {TaskClient} from "@potential-guide/task-engine-http";
const client=new TaskClient({url:${JSON.stringify(server.url)}});
const type=createProbeTaskType({source,checkBundle:${JSON.stringify(checkBundle)},checkEnvironment:${JSON.stringify(checkBundle)},
children(scope){return{service:client,caller:{scope,subject:"tester"},waitForTaskRelease:(id)=>client.waitForTaskRelease(id)}}});
export default(input,context)=>type.run(input,context);`,
  );
  references = { checkBundle, probeBundle };
  await writeFile(referenceFile, JSON.stringify(references));
}
process.send({ url: server.url, bundle: references.probeBundle });
process.on("message", async () => {
  await server.close();
  process.disconnect();
});
