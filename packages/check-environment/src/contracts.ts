import { createCheckResultSchema } from "@potential-guide/check-sdk/contracts";
import { problemCodes as directories } from "../dist/definitions/directories.js";
import { problemCodes as network } from "../dist/definitions/network.js";
import { problemCodes as tools } from "../dist/definitions/tools.js";
import directoriesContract from "./tasks/directories/contract.js";
import networkContract from "./tasks/network/contract.js";
import toolsContract from "./tasks/tools/contract.js";

export const inputSchemas = {
  tools: toolsContract.input,
  directories: directoriesContract.input,
  network: networkContract.input,
};
export const resultSchema = createCheckResultSchema([...tools, ...directories, ...network]);
