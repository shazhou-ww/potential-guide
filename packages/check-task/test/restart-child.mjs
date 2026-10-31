import { dirname, join } from "node:path";
import {
  packContractArtifact,
  writeContractArtifact,
} from "@potential-guide/check-artifacts/build";
import { checkerSchemaUri, inspectContractFiles } from "@potential-guide/check-artifacts/contracts";
import { createArtifactSource, createCheckTaskType } from "@potential-guide/check-task";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { TaskError } from "@potential-guide/task-protocol";

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
if (archive && restarting !== "restart") {
  const built = await writeContractArtifact(artifact.files, join(dirname(archive), "fixture"));
  await packContractArtifact(built.directory, archive);
}
const files = archive
  ? createArtifactSource({
      allowedOrigins: [],
      allowedFileRoots: [dirname(archive)],
      authorize() {},
      async download() {
        throw Error("File source must never reach HTTPS download.");
      },
    })
  : undefined;
const type = createCheckTaskType({
  workers: 1,
  directory,
  wallMs: 30000,
  source: files ?? {
    authorize() {},
    async resolve() {
      if (restarting === "restart") throw Error("Restore may not fetch newer content.");
      return artifact;
    },
  },
});
const server = await startTaskServer({
  database,
  port: 0,
  types: [type],
  currentVersions: { check: "2" },
  authorize: (caller, _operation, scope) => caller.scope === scope,
  resolveCaller(request) {
    if (request.headers.get("authorization") !== "Bearer test")
      throw new TaskError("unauthenticated", "Authentication required.");
    return { scope: "restart", subject: "test" };
  },
  async closeResources() {
    await type.close();
    await files?.close();
  },
});
process.send({ url: server.url });
process.on("message", async (message) => {
  if (message === "close") {
    await server.close();
    process.disconnect();
  }
});
