import { createProbeTask } from "@potential-guide/probe-sdk";
import { runTask } from "@silvermoon-work/task-sdk";
import { definitions } from "../dist/definitions/monorepo-standard.js";

runTask(createProbeTask(definitions));
