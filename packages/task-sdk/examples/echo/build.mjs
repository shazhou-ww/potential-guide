import { buildTaskBundle, packTaskBundle } from "@potential-guide/task-sdk/build";
import { fileURLToPath } from "node:url";

const source = (name) => fileURLToPath(new URL(name, import.meta.url));
const built = await buildTaskBundle({
  declaration: source("./task.yaml"),
  entry: source("./callback.ts"),
  outDirectory: source("./bundle"),
});
console.log(await packTaskBundle(built.directory, source("./bundle.tar.gz")));
