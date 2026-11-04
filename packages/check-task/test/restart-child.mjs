import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  packContractArtifact,
  writeContractArtifact,
} from "@potential-guide/check-artifacts/build";
import { checkerSchemaUri, inspectContractFiles } from "@potential-guide/check-artifacts/contracts";
import { createCheckTaskType } from "@potential-guide/check-task";
import { buildTaskBundle } from "@potential-guide/pguide-task-bundle/build";
import { readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { MemoryIpfsClient } from "@potential-guide/task-engine/testing";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { TaskError, taskSchemaUri } from "@potential-guide/task-protocol";

const [database, directory, restarting, archive] = process.argv.slice(2);
const page = Buffer.from("---\ntitle: Restart\ndescription: Restart\n---\nBody\n");
const artifact = inspectContractFiles(
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
        "exports.execute=(s)=>{require('node:fs').appendFileSync(s.marker,s.name+'\\n');if(s.spin)while(true){};return {status:200,message:'',payload:{ok:true,problems:[]}}}",
      ),
    ],
    ["references/en/checker.md", page],
  ]),
);
if (restarting !== "restart") {
  const built = await writeContractArtifact(artifact.files, join(dirname(archive), "fixture"));
  await packContractArtifact(built.directory, archive);
}
const root = dirname(database),
  referenceFile = join(root, "bundle-reference.json");
if (restarting !== "restart") {
  const type = createCheckTaskType({
    directory,
    source: {
      authorize() {},
      async resolve() {
        throw Error("Authoring only.");
      },
    },
  });
  const yaml = join(root, "task.yaml"),
    entry = join(root, "callback.ts");
  await writeFile(
    yaml,
    JSON.stringify({
      $schema: taskSchemaUri,
      name: "Restart Check",
      runtime: { type: "node", minVersion: "22.13.0" },
      entry: "worker.cjs",
      inputSchema: type.inputSchema,
      resultSchema: type.resultSchema,
      messageSchema: false,
    }),
  );
  await writeFile(
    entry,
    `import {readFile} from "node:fs/promises";
import {createCheckTaskType,createArtifactSource} from "@potential-guide/check-task";
const source=createArtifactSource({allowedOrigins:["https://example.test"],allowedFileRoots:[${JSON.stringify(dirname(archive))}],authorize(){},download(){return readFile(${JSON.stringify(archive)})}});
const type=createCheckTaskType({directory:${JSON.stringify(directory)},workers:1,wallMs:30000,source});
export default(input,context)=>type.run(input,context);`,
  );
  const built = await buildTaskBundle({
    declaration: yaml,
    entry,
    outDirectory: join(root, "task-bundle"),
  });
  await writeFile(referenceFile, JSON.stringify(built.cid));
}
const bundle = JSON.parse(await readFile(referenceFile, "utf8"));
const ipfsClient = new MemoryIpfsClient();
await ipfsClient.import((await readTaskArtifact(join(root, "task-bundle"))).files);
const server = await startTaskServer({
  database,
  port: 0,
  ipfsClient,
  limits: {
    maxConcurrent: 1,
    maxPayloadBytes: 100663296,
    queryPageBytes: 100663296,
    sourceEnvelopeBytes: 100663296,
  },
  authorize: (caller, _operation, scope) => caller.scope === scope,
  resolveCaller(request) {
    if (request.headers.get("authorization") !== "Bearer test")
      throw new TaskError("unauthenticated", "Authentication required.");
    return { scope: "restart", subject: "test" };
  },
});
process.send({ url: server.url, bundle });
process.on("message", async (message) => {
  if (message === "close") {
    await server.close();
    process.disconnect();
  }
});
