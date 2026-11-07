import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { assertLanguages, assertProblemCodes } from "./definition.js";

const text = () => Type.String({ minLength: 1, maxLength: 4096 });

function documentationSchema(languages: readonly string[], page: string) {
  assertLanguages(languages);
  return Type.Object(
    Object.fromEntries(
      languages.map((language) => [
        language,
        Type.String({
          pattern: `^ipfs://b[a-z2-7]+/resources/references/${language}/${page}\\.md$`,
        }),
      ]),
    ),
    { additionalProperties: false },
  );
}

export function createCheckProblemSchema<const Codes extends readonly string[]>(
  codes: Codes,
  languages: readonly string[],
) {
  assertProblemCodes(codes);
  return Type.Object(
    {
      target: text(),
      code: Type.Union(codes.map((code) => Type.Literal(code as Codes[number]))),
      actual: Type.Union([Type.String(), Type.Null()]),
      documentation: documentationSchema(languages, "problems/[a-z][a-z0-9-]*"),
    },
    { additionalProperties: false },
  );
}

export function createCheckResultSchema<const Codes extends readonly string[]>(
  codes: Codes,
  languages: readonly string[],
) {
  return Type.Union([
    Type.Object(
      { pass: Type.Literal(true), documentation: documentationSchema(languages, "check") },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        pass: Type.Literal(false),
        documentation: documentationSchema(languages, "check"),
        problems: Type.Array(createCheckProblemSchema(codes, languages), { minItems: 1 }),
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
export type CheckObservation<Code extends string = string> = Omit<
  CheckProblem<Code>,
  "documentation"
>;

export function createCheckContract<Input extends TSchema, const Codes extends readonly string[]>(
  input: Input,
  codes: Codes,
  languages: readonly string[],
) {
  return { input, result: createCheckResultSchema(codes, languages), message: Type.Never() };
}
