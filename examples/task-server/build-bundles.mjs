import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTaskBundle } from "@potential-guide/pguide-task-bundle/build";
import { readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { bundleCid, parseBundleReference, taskSchemaUri } from "@potential-guide/task-protocol";

/** Author-side only. The server never imports this module or business packages. */
export async function buildExampleBundle({
  kind,
  directory,
  sourceOptions = {},
  downloadResources,
  resources = {},
  serviceUrl,
  token,
  checkBundle,
  ipfsClient,
}) {
  await mkdir(directory, { recursive: true });
  let inputSchema = { type: "object" };
  let resultSchema = true;
  let entry = fileURLToPath(new URL("./echo-type.mjs", import.meta.url));
  if (kind !== "echo") {
    const source = {
      authorize() {},
      async resolve() {
        throw Error("Author only.");
      },
    };
    const sourceCode = `
import {createArtifactSource} from "@potential-guide/check-task";
import {resolve} from "node:path";
const createSource=context=>createArtifactSource({...${JSON.stringify(sourceOptions)},
authorize(_reference,scope){if(scope!=="example")throw Error("Source scope denied.");},
${downloadResources ? `async download(url){const path=${JSON.stringify(downloadResources)}[url];if(!path)throw Error("Unknown controlled resource.");const chunks=[];for await(const chunk of context.bundle.read(path))chunks.push(chunk);return Buffer.concat(chunks);}` : ""}
});
`;
    let callback;
    let type;
    if (kind === "check") {
      const { createCheckTaskType } = await import("@potential-guide/check-task");
      type = createCheckTaskType({ source, directory: "author-only" });
      callback = `${sourceCode}
import {createCheckTaskType} from "@potential-guide/check-task";
export default(input,context)=>createCheckTaskType({source:createSource(context),directory:resolve(".business-workers"),workers:1}).run(input,context);
`;
    } else if (kind === "probe") {
      if (!checkBundle || !serviceUrl || !token)
        throw Error("Probe authoring requires an exact Check Bundle and authorized child service.");
      const { createProbeTaskType } = await import("@potential-guide/probe-task");
      type = createProbeTaskType({
        source,
        checkBundle,
        checkEnvironment: bundleCid(checkBundle),
        children() {
          throw Error("Author only.");
        },
      });
      callback = `${sourceCode}
import {createProbeTaskType} from "@potential-guide/probe-task";
import {TaskClient} from "@potential-guide/task-engine-http";
const client=new TaskClient({url:${JSON.stringify(serviceUrl)},headers:{authorization:${JSON.stringify(`Bearer ${token}`)}}});
export default(input,context)=>createProbeTaskType({source:createSource(context),checkBundle:${JSON.stringify(checkBundle)},checkEnvironment:${JSON.stringify(bundleCid(checkBundle))},
children(scope){return{service:client,caller:{scope,subject:"example"},waitForTaskRelease:id=>client.waitForTaskRelease(id)}}}).run(input,context);
`;
    } else throw Error("Unknown example callback.");
    inputSchema = type.inputSchema;
    resultSchema = type.resultSchema;
    entry = join(directory, `${kind}.mjs`);
    await writeFile(entry, callback);
  }
  const declaration = join(directory, `${kind}.yaml`);
  await writeFile(
    declaration,
    JSON.stringify({
      $schema: taskSchemaUri,
      name: kind,
      runtime: { type: "node", minVersion: "22.13.0" },
      entry: "worker.cjs",
      binary: [],
      inputSchema,
      resultSchema,
      messageSchema: false,
    }),
  );
  const built = await buildTaskBundle({
    declaration,
    entry,
    resources,
    outDirectory: join(directory, `${kind}-bundle`),
  });
  if (ipfsClient) {
    // Explicit offline integration fixture only; the CLI never uploads.
    if (typeof ipfsClient.import !== "function") throw Error("Expected an offline fixture.");
    return await ipfsClient.import((await readTaskArtifact(built.car)).files);
  }
  return built;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, directory] = process.argv.slice(2);
  if (!kind || !directory)
    throw Error("Usage: node build-bundles.mjs <echo|check|probe> <new-author-directory>");
  console.log(
    await buildExampleBundle({
      kind,
      directory: resolve(directory),
      sourceOptions: {
        allowedOrigins: process.env.CHECK_ORIGIN ? [process.env.CHECK_ORIGIN] : [],
        allowedFileRoots: process.env.CHECK_FILE_ROOT ? [resolve(process.env.CHECK_FILE_ROOT)] : [],
      },
      serviceUrl: process.env.CHILD_SERVICE_URL,
      token: process.env.CHILD_SERVICE_TOKEN,
      checkBundle: process.env.CHECK_BUNDLE
        ? parseBundleReference(process.env.CHECK_BUNDLE)
        : undefined,
    }),
  );
}
