import { createCheckTask } from "@potential-guide/check-sdk";
import { runTask, type TaskCallback } from "@potential-guide/task-sdk";
import type { Static } from "@sinclair/typebox";
import { problemCodes } from "../../../dist/definitions/network.js";
import { inspectNetwork } from "../../network.js";
import type contract from "./contract.js";

const callback: TaskCallback<
  Static<typeof contract.input>,
  Static<typeof contract.result>
> = createCheckTask(problemCodes, inspectNetwork);
runTask(callback);
