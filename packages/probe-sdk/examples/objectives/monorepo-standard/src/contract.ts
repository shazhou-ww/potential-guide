import { Type } from "@sinclair/typebox";
import { createProbeContract } from "@potential-guide/probe-sdk/contracts";
import { definitions } from "../dist/definitions/monorepo-standard.js";

const tools = Type.Object(
  {
    tools: Type.Array(
      Type.Object(
        {
          command: Type.String(),
          args: Type.Array(Type.String()),
          minimumVersion: Type.String(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);
const directories = Type.Object(
  {
    directories: Type.Array(
      Type.Object(
        {
          path: Type.String(),
          requirements: Type.Array(
            Type.Union([Type.Literal("exists"), Type.Literal("read"), Type.Literal("write")]),
            { minItems: 1, uniqueItems: true },
          ),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);

export default createProbeContract(
  Type.Object(
    {
      toolchain: tools,
      workspace: directories,
      standardization: Type.Object(
        { repositoryRoot: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  definitions,
);
