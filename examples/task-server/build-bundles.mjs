import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTaskBundle } from "@potential-guide/pguide-task-bundle/build";
import { readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { taskSchemaUri } from "@potential-guide/task-protocol";

/** Author-side only. The server never imports this module or business packages. */
export async function buildExampleBundle({ kind, directory, resources = {}, ipfsClient }) {
  if (kind !== "echo") throw Error("Unknown example callback.");
  await mkdir(directory, { recursive: true });
  const entry = fileURLToPath(new URL("./echo-type.mjs", import.meta.url));
  const declaration = join(directory, "echo.yaml");
  await writeFile(
    declaration,
    JSON.stringify({
      $schema: taskSchemaUri,
      name: kind,
      runtime: { type: "node", minVersion: "22.13.0" },
      entry: "worker.cjs",
      inputSchema: { type: "object" },
      resultSchema: true,
      messageSchema: false,
    }),
  );
  const built = await buildTaskBundle({
    declaration,
    entry,
    resources,
    outDirectory: join(directory, "echo-bundle"),
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
  if (!kind || !directory) throw Error("Usage: node build-bundles.mjs echo <new-author-directory>");
  console.log(await buildExampleBundle({ kind, directory: resolve(directory) }));
}
