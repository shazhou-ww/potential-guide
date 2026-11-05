import { createCheckContract } from "@potential-guide/check-sdk/contracts";
import { Type } from "@sinclair/typebox";
import { problemCodes } from "../../../dist/definitions/tools.js";
import { objectOptions, text, timeout } from "../inputs.js";

export default createCheckContract(
  Type.Object(
    {
      checkTimeoutMs: timeout,
      tools: Type.Array(
        Type.Object(
          {
            command: text,
            args: Type.Array(text, { maxItems: 100 }),
            minimumVersion: Type.String({ maxLength: 128, pattern: "^\\d+(?:\\.\\d+)*$" }),
          },
          objectOptions,
        ),
        { minItems: 1, maxItems: 100 },
      ),
    },
    objectOptions,
  ),
  problemCodes,
);
