import { createProbeTask } from "@potential-guide/probe-sdk";
import { runTask } from "@potential-guide/task-sdk";
import { definitions } from "../dist/definitions/task-engine-device.js";

runTask(createProbeTask(definitions));
