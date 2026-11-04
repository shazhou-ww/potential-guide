import { fileURLToPath } from "node:url";
import { buildTaskBundle } from "@potential-guide/pguide-task-bundle/build";

const source = (name) => fileURLToPath(new URL(name, import.meta.url));
const built = await buildTaskBundle({
  declaration: source("./task.yaml"),
  entry: source("./callback.ts"),
  outDirectory: source("./bundle"),
});
console.log({ directory: built.directory, car: built.car, cid: built.cid });
