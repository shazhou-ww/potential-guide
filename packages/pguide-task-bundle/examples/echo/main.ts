import type { BundleCallback } from "@potential-guide/pguide-task-bundle";
import type contract from "./contract.js";

const callback: BundleCallback<typeof contract> = async (input) => ({ text: input.text });
export default callback;
