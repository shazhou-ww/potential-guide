import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildTaskBundle, packTaskBundle } from "@potential-guide/task-sdk/build";
import {
  packContractArtifact,
  writeContractArtifact,
} from "@potential-guide/check-artifacts/build";
import { checkerSchemaUri, inspectContractFiles } from "@potential-guide/check-artifacts/contracts";
import { createCheckTaskType } from "@potential-guide/check-task";
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
  const packed = await packTaskBundle(built.directory, join(root, "task-bundle.tgz"));
  await writeFile(
    referenceFile,
    JSON.stringify({ url: pathToFileURL(packed.archive).href, digest: built.digest }),
  );
}
const bundle = JSON.parse(await readFile(referenceFile, "utf8"));
const server = await startTaskServer({
  database,
  port: 0,
  bundleDirectory: join(root, "cache"),
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
