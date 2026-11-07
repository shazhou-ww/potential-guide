import { Type } from "@sinclair/typebox";
import directoriesContract from "./tasks/directories/contract.js";
import networkContract from "./tasks/network/contract.js";
import toolsContract from "./tasks/tools/contract.js";

export const inputSchemas = {
  tools: toolsContract.input,
  directories: directoriesContract.input,
  network: networkContract.input,
};
export const resultSchema = Type.Union([
  toolsContract.result,
  directoriesContract.result,
  networkContract.result,
]);
