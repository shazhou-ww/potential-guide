import { compileInputSchema, freeze, type InputSchema } from "@potential-guide/task-protocol";
import type { CheckInput } from "./index.js";

const insensitive = (text: string) =>
  [...text].map((letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`).join("");
const credential = ["token", "secret", "password", "credential", "sig"].map(insensitive).join("|");
const key = `(?!(?:[A-Za-z0-9_-]*(?:${credential}|${insensitive("api")}[A-Za-z0-9_-]?${insensitive("key")})))[A-Za-z][A-Za-z0-9_-]*`;
// Query names are deliberately ASCII and unencoded: URLSearchParams decoding cannot hide a key.
export const artifactHttpsUrlSchema: InputSchema = {
  type: "string",
  maxLength: 4096,
  pattern: `^https://[^@%/?#\\s\\\\]+(?:/[^?#\\s\\\\]*)?(?:\\?${key}=[^&#;\\s\\\\]*(?:&${key}=[^&#;\\s\\\\]*)*)?$`,
};
export const artifactDigestSchema: InputSchema = {
  type: "string",
  pattern: "^sha256:[a-f0-9]{64}$",
};
export function artifactReferenceSchema(kind: "checker" | "objective"): InputSchema {
  return {
    type: "object",
    properties: {
      kind: { const: kind },
      url:
        kind === "objective"
          ? artifactHttpsUrlSchema
          : {
              anyOf: [
                artifactHttpsUrlSchema,
                {
                  type: "string",
                  maxLength: 4096,
                  pattern: "^file:///(?!/)[^?#\\s\\\\]*$",
                },
              ],
            },
      digest: artifactDigestSchema,
    },
    required: ["kind", "url"],
    additionalProperties: false,
  };
}
export const checkInputSchema: InputSchema = freeze({
  type: "object",
  properties: {
    checker: artifactReferenceSchema("checker"),
    subject: { type: "object" },
    context: { type: "object" },
    language: { type: "string" },
  },
  required: ["checker", "subject"],
  additionalProperties: false,
});
const contract = compileInputSchema<CheckInput>(checkInputSchema, {
  maxInputBytes: 96 * 1024 * 1024,
});
export const validateCheckInput = contract.validate;
