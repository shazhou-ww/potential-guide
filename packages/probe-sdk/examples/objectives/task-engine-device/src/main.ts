import { createProbeTask } from "@potential-guide/probe-sdk";
import { runTask } from "@silvermoon-work/task-sdk";
import { definitions } from "../dist/definitions/task-engine-device.js";

runTask(createProbeTask(definitions));
