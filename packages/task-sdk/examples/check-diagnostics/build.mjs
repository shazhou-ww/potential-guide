import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTaskBundle,
  createIpfsClient,
  importTaskBundle,
} from "@potential-guide/task-sdk/build";

const directory = resolve(process.argv[2] ?? ".cache/check-diagnostics");
const built = await buildTaskBundle({
  declaration: fileURLToPath(new URL("./task.yaml", import.meta.url)),
  entry: fileURLToPath(new URL("./callback.ts", import.meta.url)),
  outDirectory: directory,
});
if (process.env.IPFS_API)
  console.log(
    (await importTaskBundle(built.directory, await createIpfsClient(process.env.IPFS_API))).cid,
  );
else console.log(JSON.stringify({ directory: built.directory, cid: built.cid }));
