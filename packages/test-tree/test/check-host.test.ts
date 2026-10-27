import { loadTree } from "../src/model.js";
import { registerTests } from "../src/runner.js";
import { Context } from "./check-host/scenario.js";

await registerTests(
  await loadTree(fileURLToPath(new URL("./check-host/host.states.yaml", import.meta.url))),
  () => new Context(),
  (file) => import(pathToFileURL(file).href),
);

import { fileURLToPath, pathToFileURL } from "node:url";
