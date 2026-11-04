import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTaskBundle } from "@potential-guide/pguide-task-bundle/build";

const directory = resolve(process.argv[2] ?? ".cache/check-diagnostics");
const built = await buildTaskBundle({
  declaration: fileURLToPath(new URL("./task.yaml", import.meta.url)),
  entry: fileURLToPath(new URL("./callback.ts", import.meta.url)),
  outDirectory: directory,
});
console.log(JSON.stringify({ directory: built.directory, car: built.car, cid: built.cid }));
