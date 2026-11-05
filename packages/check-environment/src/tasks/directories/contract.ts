import { createCheckContract } from "@potential-guide/check-sdk/contracts";
import { Type } from "@sinclair/typebox";
import { problemCodes } from "../../../dist/definitions/directories.js";
import { objectOptions, text } from "../inputs.js";

export default createCheckContract(
  Type.Object(
    {
      directories: Type.Array(
        Type.Object(
          {
            path: text,
            requirements: Type.Array(
              Type.Union([Type.Literal("exists"), Type.Literal("read"), Type.Literal("write")]),
              { minItems: 1, uniqueItems: true },
            ),
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
