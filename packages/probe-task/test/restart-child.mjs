import {
  checkerSchemaUri,
  objectiveSchemaUri,
  inspectContractFiles,
} from "@potential-guide/check-artifacts/contracts";
import { createCheckTaskType } from "@potential-guide/check-task";
import { startTaskServer } from "@potential-guide/task-engine-server";
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
const checkType = createCheckTaskType({ source, directory, workers: 1 });
let engine;
const probeType = createProbeTaskType({
  source,
  checkEnvironment: checkType.environment,
  children(scope) {
    return {
      service: engine,
      caller: { scope, subject: "probe" },
      waitForTaskRelease: (id, caller) => engine.waitForTaskRelease(id, caller),
    };
  },
});
const server = await startTaskServer({
  database,
  port: 0,
  types: [checkType, probeType],
  currentVersions: { check: "2", probe: "2" },
  limits: { maxConcurrent: 1, maxPayloadBytes: 8 * 1024 * 1024 },
  authorize: () => true,
  resolveCaller: () => ({ scope: "a", subject: "tester" }),
  bindService(value) {
    engine = value;
  },
  async closeResources() {
    await probeType.close();
    await checkType.close();
  },
});
process.send({ url: server.url });
process.on("message", async () => {
  await server.close();
  process.disconnect();
});
