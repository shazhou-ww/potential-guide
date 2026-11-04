import { fileURLToPath } from "node:url";
import { buildTaskBundle } from "@potential-guide/pguide-task-bundle/build";
import { createIpfsClient, importTaskBundle } from "@potential-guide/pguide-task-bundle/publish";

const source = (name) => fileURLToPath(new URL(name, import.meta.url));
const built = await buildTaskBundle({
  declaration: source("./task.yaml"),
  entry: source("./callback.ts"),
  outDirectory: source("./bundle"),
});
if (process.env.IPFS_API)
  console.log(
    (await importTaskBundle(built.directory, await createIpfsClient(process.env.IPFS_API))).cid,
  );
else console.log({ directory: built.directory, cid: built.cid });
