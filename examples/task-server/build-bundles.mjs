import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildTaskBundle, packTaskBundle } from "@potential-guide/task-sdk/build";
import { taskSchemaUri } from "@potential-guide/task-protocol";

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
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
const source=createArtifactSource({...${JSON.stringify(sourceOptions)},
authorize(_reference,scope){if(scope!=="example")throw Error("Source scope denied.");},
${downloadResources ? `download(url){const path=${JSON.stringify(downloadResources)}[url];if(!path)throw Error("Unknown controlled resource.");return readFile(new URL("./"+path,import.meta.url));}` : ""}
});
`;
    let callback;
    let type;
    if (kind === "check") {
      const { createCheckTaskType } = await import("@potential-guide/check-task");
      type = createCheckTaskType({ source, directory: "author-only" });
      callback = `${sourceCode}
import {createCheckTaskType} from "@potential-guide/check-task";
const type=createCheckTaskType({source,directory:resolve(".business-workers"),workers:1});
export default(input,context)=>type.run(input,context);
`;
    } else if (kind === "probe") {
      if (!checkBundle || !serviceUrl || !token)
        throw Error("Probe authoring requires an exact Check Bundle and authorized child service.");
      const { createProbeTaskType } = await import("@potential-guide/probe-task");
      type = createProbeTaskType({
        source,
        checkBundle,
        checkEnvironment: checkBundle.digest,
        children() {
          throw Error("Author only.");
        },
      });
      callback = `${sourceCode}
import {createProbeTaskType} from "@potential-guide/probe-task";
import {TaskClient} from "@potential-guide/task-engine-http";
const client=new TaskClient({url:${JSON.stringify(serviceUrl)},headers:{authorization:${JSON.stringify(`Bearer ${token}`)}}});
const type=createProbeTaskType({source,checkBundle:${JSON.stringify(checkBundle)},checkEnvironment:${JSON.stringify(checkBundle.digest)},
children(scope){return{service:client,caller:{scope,subject:"example"},waitForTaskRelease:id=>client.waitForTaskRelease(id)}}});
export default(input,context)=>type.run(input,context);
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
  const packed = await packTaskBundle(built.directory, join(directory, `${kind}.tar.gz`));
  return { url: pathToFileURL(packed.archive).href, digest: built.digest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, directory] = process.argv.slice(2);
  if (!kind || !directory)
    throw Error("Usage: node build-bundles.mjs <echo|check|probe> <new-author-directory>");
  console.log(
    JSON.stringify(
      await buildExampleBundle({
        kind,
        directory: resolve(directory),
        sourceOptions: {
          allowedOrigins: process.env.CHECK_ORIGIN ? [process.env.CHECK_ORIGIN] : [],
          allowedFileRoots: process.env.CHECK_FILE_ROOT
            ? [resolve(process.env.CHECK_FILE_ROOT)]
            : [],
        },
        serviceUrl: process.env.CHILD_SERVICE_URL,
        token: process.env.CHILD_SERVICE_TOKEN,
        checkBundle: process.env.CHECK_BUNDLE ? JSON.parse(process.env.CHECK_BUNDLE) : undefined,
      }),
    ),
  );
}
