import { createCheckTaskType } from "@potential-guide/check-task";
import { checkerSchemaUri, inspectContractFiles } from "@potential-guide/check-artifacts/contracts";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { TaskError } from "@potential-guide/task-protocol";

const [database, directory, restarting] = process.argv.slice(2);
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
const type = createCheckTaskType({
  workers: 1,
  directory,
  wallMs: 30000,
  source: {
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
  currentVersions: { check: "1" },
  authorize: (caller, _operation, scope) => caller.scope === scope,
  resolveCaller(request) {
    if (request.headers.get("authorization") !== "Bearer test")
      throw new TaskError("unauthenticated", "Authentication required.");
    return { scope: "restart", subject: "test" };
  },
  closeResources: () => type.close(),
});
process.send({ url: server.url });
process.on("message", async (message) => {
  if (message === "close") {
    await server.close();
    process.disconnect();
  }
});
