import type { RegisteredType } from "@potential-guide/task-protocol";

export function fixtureTypes() {
  const base = {
    version: "1",
    environment: "web-ui-fixture-v3",
    resultSchema: true,
    messageSchema: false,
    module: new URL("./worker.mjs", import.meta.url).href,
    exportName: "createUiType",
    configuration: {},
  };
  const types: RegisteredType[] = [
    {
      ...base,
      type: "echo",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: { type: "string", minLength: 1, title: "消息" },
          durationMs: { type: "integer", minimum: 1, maximum: 60000 },
          metadata: { type: "object", title: "自由对象" },
        },
      },
    },
    {
      ...base,
      type: "survey",
      inputSchema: {
        type: "object",
        required: ["subject", "scores"],
        additionalProperties: false,
        $defs: {
          subject: {
            type: "object",
            required: ["name", "active"],
            additionalProperties: false,
            properties: { name: { type: "string" }, active: { type: "boolean" } },
          },
        },
        properties: {
          subject: { $ref: "#/$defs/subject" },
          scores: { type: "array", items: { type: "number" } },
          mode: { type: "string", enum: ["brief", "full"] },
          durationMs: { type: "integer", minimum: 1, maximum: 60000 },
        },
      },
    },
  ];
  return {
    types: types.map((type) => ({
      ...type,
      configuration: { type: type.type, inputSchema: type.inputSchema, capacity: 1 },
    })),
    async close() {},
  };
}
