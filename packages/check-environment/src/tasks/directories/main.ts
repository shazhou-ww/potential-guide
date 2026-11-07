import { createCheckTask } from "@potential-guide/check-sdk";
import { runTask, type TaskCallback } from "@potential-guide/task-sdk";
import type { Static } from "@sinclair/typebox";
import { languages, problemCodes } from "../../../dist/definitions/directories.js";
import { inspectDirectories } from "../../directories.js";
import type contract from "./contract.js";

const callback: TaskCallback<
  Static<typeof contract.input>,
  Static<typeof contract.result>
> = createCheckTask(problemCodes, languages, inspectDirectories);
runTask(callback);
