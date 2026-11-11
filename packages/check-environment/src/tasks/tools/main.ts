import { createCheckTask } from "@potential-guide/check-sdk";
import { runTask, type TaskCallback } from "@silvermoon-work/task-sdk";
import type { Static } from "@sinclair/typebox";
import { languages, problemCodes } from "../../../dist/definitions/tools.js";
import { inspectTools } from "../../tools.js";
import type contract from "./contract.js";

const callback: TaskCallback<
  Static<typeof contract.input>,
  Static<typeof contract.result>
> = createCheckTask(problemCodes, languages, inspectTools);
runTask(callback);
