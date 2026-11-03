import { type Static, Type } from "@sinclair/typebox";
import type { BundleCallback } from "../src/authoring.js";

const contract = {
  input: Type.Object({ text: Type.String(), optional: Type.Optional(Type.Number()) }),
  result: Type.Object({ count: Type.Number() }),
  message: Type.Object({ stop: Type.Boolean() }),
};
const input: Static<typeof contract.input> = { text: "typed" };
// @ts-expect-error input type comes from the same Schema
const wrongInput: Static<typeof contract.input> = { text: 42 };
const callback: BundleCallback<typeof contract> = async (input, context) => {
  for await (const message of context.messages) {
    if (message.payload.stop) break;
  }
  return { count: input.text.length };
};
// @ts-expect-error result must match the generated result Schema
const wrongResult: BundleCallback<typeof contract> = async () => ({ count: "bad" });
void [input, wrongInput, callback, wrongResult];
