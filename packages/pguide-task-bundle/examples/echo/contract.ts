import { Type } from "@sinclair/typebox";

export default {
  input: Type.Object({ text: Type.String() }),
  result: Type.Object({ text: Type.String() }),
  message: Type.Never(),
};
