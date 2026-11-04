import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTaskBundle } from "@potential-guide/task-sdk/build";
import { inputSchemas, resultSchema } from "./dist/contracts.js";

const root = fileURLToPath(new URL(".", import.meta.url));
await copyFile(join(root, "..", "..", "LICENSE"), join(root, "LICENSE"));
const output = join(root, "dist", "bundles");
await mkdir(output, { recursive: true });
const references = {};
for (const kind of ["tools", "directories", "network"]) {
  const declaration = join(output, `${kind}.yaml`);
  await writeFile(
    declaration,
    JSON.stringify({
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json",
      name: `Environment ${kind} check`,
      runtime: { type: "node", minVersion: "22.13.0" },
      entry: "worker.cjs",
      inputSchema: inputSchemas[kind],
      resultSchema,
      messageSchema: false,
    }),
  );
  const directory = join(output, kind);
  await rm(directory, { recursive: true, force: true });
  const built = await buildTaskBundle({
    declaration,
    entry: join(root, "dist", `${kind}.js`),
    outDirectory: directory,
  });
  await rm(declaration);
  references[kind] = { directory: kind, cid: built.cid };
}
await writeFile(join(output, "references.json"), `${JSON.stringify(references, null, 2)}\n`);
