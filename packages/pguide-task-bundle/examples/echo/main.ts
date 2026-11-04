import type { BundleCallback } from "@potential-guide/pguide-task-bundle";
import { runTask } from "@potential-guide/task-sdk";
import type contract from "./contract.js";

const callback: BundleCallback<typeof contract> = async (input) => ({ text: input.text });
runTask(callback);
