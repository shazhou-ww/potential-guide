import { createCheckContract } from "@potential-guide/check-sdk/contracts";
import { Type } from "@sinclair/typebox";
import { languages, problemCodes } from "../dist/definitions/text.js";

export default createCheckContract(
  Type.Object({ text: Type.String() }, { additionalProperties: false }),
  problemCodes,
  languages,
);
