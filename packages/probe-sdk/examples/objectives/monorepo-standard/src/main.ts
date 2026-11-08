import { createProbeTask } from "@potential-guide/probe-sdk";
import { runTask } from "@potential-guide/task-sdk";
import { definitions } from "../dist/definitions/monorepo-standard.js";

runTask(createProbeTask(definitions));
