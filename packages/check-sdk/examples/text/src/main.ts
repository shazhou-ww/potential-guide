import { createCheckTask } from "@potential-guide/check-sdk";
import { runTask } from "@silvermoon-work/task-sdk";
import type { Static } from "@sinclair/typebox";
import { languages, problemCodes } from "../dist/definitions/text.js";
import type contract from "./contract.js";

runTask(
  createCheckTask(
    problemCodes,
    languages,
    async (input: Static<typeof contract.input>, context) => {
      context.signal.throwIfAborted();
      return input.text.trim() ? [] : [{ target: "text", code: "text-empty", actual: input.text }];
    },
  ),
);
