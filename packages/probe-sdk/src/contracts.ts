import { Type, type TSchema } from "@sinclair/typebox";
import { assertLanguages, type ProbeDefinitions } from "./model.js";
export type { ProbeDefinitions } from "./model.js";

export function createProbeResultSchema(definitions: ProbeDefinitions) {
  assertLanguages(definitions.languages);
  const documentation = Type.Object(
    Object.fromEntries(
      definitions.languages.map((language) => [
        language,
        Type.String({
          pattern: `^ipfs://b[a-z2-7]+/resources/references/${language}/[a-zA-Z0-9/-]+\\.md$`,
        }),
      ]),
    ),
    { additionalProperties: false },
  );
  const check = (ref: string) =>
    Type.Object(
      {
        id: Type.Literal(ref),
        documentation,
        problems: Type.Array(
          Type.Object(
            {
              target: Type.String({ minLength: 1, maxLength: 4096 }),
              code: Type.Union(
                (definitions.problemCodes[ref] ?? []).map((code) => Type.Literal(code)),
              ),
              actual: Type.Union([Type.String(), Type.Null()]),
              documentation,
            },
            { additionalProperties: false },
          ),
          { minItems: 1 },
        ),
      },
      { additionalProperties: false },
    );
  return Type.Union(
    [...definitions.levels, { id: "terminal", checks: [] }].map((level) =>
      Type.Object(
        {
          objective: Type.String({ pattern: "^b[a-z2-7]+$" }),
          documentation,
          currentLevel: Type.Object(
            { id: Type.Literal(level.id), documentation },
            { additionalProperties: false },
          ),
          checks: Type.Array(Type.Union(level.checks.map(check)), {
            minItems: level.id === "terminal" ? 0 : 1,
            maxItems: level.checks.length,
          }),
        },
        { additionalProperties: false },
      ),
    ),
  );
}
export function createProbeContract<Input extends TSchema>(
  input: Input,
  definitions: ProbeDefinitions,
) {
  return { input, result: createProbeResultSchema(definitions), message: Type.Never() };
}
