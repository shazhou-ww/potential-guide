import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildTaskBundle, packTaskBundle } from "@potential-guide/task-sdk/build";

const directory = resolve(process.argv[2] ?? ".cache/check-diagnostics");
const built = await buildTaskBundle({
  declaration: fileURLToPath(new URL("./task.yaml", import.meta.url)),
  entry: fileURLToPath(new URL("./callback.ts", import.meta.url)),
  outDirectory: directory,
});
const packed = await packTaskBundle(built.directory, `${directory}.tar.gz`);
console.log(JSON.stringify({ url: pathToFileURL(packed.archive).href, digest: built.digest }));
