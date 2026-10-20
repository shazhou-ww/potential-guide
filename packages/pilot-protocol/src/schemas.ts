import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ValidateFunction } from "ajv";
import { objectiveSchema, objectivesSchema } from "./schema-definitions.js";

export { objectiveSchema, objectivesSchema } from "./schema-definitions.js";

export const OBJECTIVE_SCHEMA_URI =
  "https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json" as const;
export const OBJECTIVES_SCHEMA_URI =
  "https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json" as const;
type DocumentValidator = ((value: unknown) => boolean) & {
  errors: ValidateFunction["errors"];
};

let ajv: Ajv2020 | undefined;
function offlineValidator(schema: AnySchema): DocumentValidator {
  let compiled: ValidateFunction | undefined;
  const validate: DocumentValidator = Object.assign(
    (value: unknown) => {
      ajv ??= new Ajv2020({ strict: true, allErrors: true });
      compiled ??= ajv.compile(schema);
      const valid = compiled(value);
      validate.errors = compiled.errors;
      return valid;
    },
    { errors: null as ValidateFunction["errors"] },
  );
  return validate;
}

export const validateObjectiveDocument = offlineValidator(objectiveSchema);
export const validateObjectivesDocument = offlineValidator(objectivesSchema);
