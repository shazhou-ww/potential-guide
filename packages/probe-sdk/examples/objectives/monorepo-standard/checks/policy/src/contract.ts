import { Type } from "@sinclair/typebox";
import { createCheckContract } from "@potential-guide/check-sdk/contracts";
import { languages, problemCodes } from "../dist/definitions/monorepo-policy.js";

export default createCheckContract(
  Type.Object({ repositoryRoot: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  problemCodes,
  languages,
);
