import { createCheckContract } from "@potential-guide/check-sdk/contracts";
import { Type } from "@sinclair/typebox";
import { languages, problemCodes } from "../../../dist/definitions/network.js";
import { objectOptions, text, timeout } from "../inputs.js";

export default createCheckContract(
  Type.Object(
    {
      checkTimeoutMs: timeout,
      dns: Type.Array(Type.String({ maxLength: 253, pattern: "^[A-Za-z0-9][A-Za-z0-9.-]*$" }), {
        maxItems: 100,
      }),
      http: Type.Array(
        Type.Object(
          {
            url: text,
            expectedStatus: Type.Array(Type.Integer({ minimum: 100, maximum: 599 }), {
              minItems: 1,
              uniqueItems: true,
            }),
            followRedirects: Type.Boolean(),
          },
          objectOptions,
        ),
        { maxItems: 100 },
      ),
    },
    {
      ...objectOptions,
      anyOf: [
        { properties: { dns: { type: "array", minItems: 1 } } },
        { properties: { http: { type: "array", minItems: 1 } } },
      ],
    },
  ),
  problemCodes,
  languages,
);
