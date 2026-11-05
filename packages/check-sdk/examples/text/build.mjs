import { fileURLToPath } from "node:url";
import { prepareCheck, verifyCheckResources } from "@potential-guide/check-sdk/authoring";
import { buildTask } from "@potential-guide/pguide-task-bundle";
import { readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";

const prepared = await prepareCheck(
  fileURLToPath(new URL("text.check.build.yaml", import.meta.url)),
);
const artifact = await buildTask(prepared.buildFile);
verifyCheckResources(prepared, (await readTaskArtifact(artifact.car)).files);
console.log(JSON.stringify(artifact));
