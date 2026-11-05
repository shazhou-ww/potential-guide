import { Type } from "@sinclair/typebox";

export const text = Type.String({ minLength: 1, maxLength: 4096 });
export const timeout = Type.Optional(Type.Integer({ minimum: 100, maximum: 300000 }));
export const objectOptions = { additionalProperties: false } as const;
