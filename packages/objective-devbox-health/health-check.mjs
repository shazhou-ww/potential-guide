#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { main } from "./src/cli.mjs";

export { main } from "./src/cli.mjs";
export {
  defaultPolicy,
  minimumVersions,
  problemIds,
  stages,
  validateSubject,
} from "./src/contract.mjs";
export { execute } from "./src/execution.mjs";
export { sudoUnrestricted } from "./src/identity.mjs";
export { evaluateTasks, layoutProblems, validateTask } from "./src/order.mjs";
export { check, sample } from "./src/runner.mjs";
export { evaluateHistory, packageIndexProblem } from "./src/sustainability.mjs";
export { capacityProblems, packageDependencyProblem } from "./src/system.mjs";
export { compareVersions, parseToolVersion } from "./src/toolchains.mjs";

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();
