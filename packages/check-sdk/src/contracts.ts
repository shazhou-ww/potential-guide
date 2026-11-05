import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { assertProblemCodes } from "./definition.js";

const text = () => Type.String({ minLength: 1, maxLength: 4096 });

export function createCheckProblemSchema<const Codes extends readonly string[]>(codes: Codes) {
  assertProblemCodes(codes);
  return Type.Object(
    {
      target: text(),
      code: Type.Union(codes.map((code) => Type.Literal(code as Codes[number]))),
      actual: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  );
}

export function createCheckResultSchema<const Codes extends readonly string[]>(codes: Codes) {
  return Type.Union([
    Type.Object({ pass: Type.Literal(true) }, { additionalProperties: false }),
    Type.Object(
      {
        pass: Type.Literal(false),
        problems: Type.Array(createCheckProblemSchema(codes), { minItems: 1 }),
      },
      { additionalProperties: false },
    ),
  ]);
}

export type CheckProblem<Code extends string = string> = Static<
  ReturnType<typeof createCheckProblemSchema<readonly Code[]>>
>;
export type CheckResult<Code extends string = string> = Static<
  ReturnType<typeof createCheckResultSchema<readonly Code[]>>
>;

export function createCheckContract<Input extends TSchema, const Codes extends readonly string[]>(
  input: Input,
  codes: Codes,
) {
  return { input, result: createCheckResultSchema(codes), message: Type.Never() };
}
