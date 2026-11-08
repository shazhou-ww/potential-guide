import { Type } from "@sinclair/typebox";
import { createProbeContract } from "@potential-guide/probe-sdk/contracts";
import { definitions } from "../dist/definitions/task-engine-device.js";

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
const gateway = Type.Object(
  {
    dns: Type.Array(Type.String()),
    http: Type.Array(
      Type.Object(
        {
          url: Type.String(),
          expectedStatus: Type.Array(Type.Integer(), { minItems: 1 }),
          followRedirects: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);

export default createProbeContract(
  Type.Object({ runtime: tools, storage: directories, gateway }, { additionalProperties: false }),
  definitions,
);
