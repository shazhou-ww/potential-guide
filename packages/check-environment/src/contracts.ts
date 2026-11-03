const text = { type: "string", minLength: 1, maxLength: 4096 };
const strings = { type: "array", items: text, maxItems: 100 };
const timeout = { type: "integer", minimum: 100, maximum: 300000 };

export const resultSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["pass"],
      properties: { pass: { const: true } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["pass", "problems"],
      properties: {
        pass: { const: false },
        problems: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["target", "code", "actual"],
            properties: {
              target: text,
              code: text,
              actual: { type: ["string", "null"] },
            },
          },
        },
      },
    },
  ],
};

export const inputSchemas = {
  tools: {
    type: "object",
    additionalProperties: false,
    required: ["tools"],
    properties: {
      checkTimeoutMs: timeout,
      tools: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["command", "args", "minimumVersion"],
          properties: {
            command: text,
            args: strings,
            minimumVersion: { type: "string", maxLength: 128, pattern: "^\\d+(?:\\.\\d+)*$" },
          },
        },
      },
    },
  },
  directories: {
    type: "object",
    additionalProperties: false,
    required: ["directories"],
    properties: {
      directories: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "requirements"],
          properties: {
            path: text,
            requirements: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { enum: ["exists", "read", "write"] },
            },
          },
        },
      },
    },
  },
  network: {
    type: "object",
    additionalProperties: false,
    required: ["dns", "http"],
    properties: {
      checkTimeoutMs: timeout,
      dns: {
        type: "array",
        maxItems: 100,
        items: { type: "string", maxLength: 253, pattern: "^[A-Za-z0-9][A-Za-z0-9.-]*$" },
      },
      http: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["url", "expectedStatus", "followRedirects"],
          properties: {
            url: text,
            expectedStatus: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "integer", minimum: 100, maximum: 599 },
            },
            followRedirects: { type: "boolean" },
          },
        },
      },
    },
    anyOf: [
      { properties: { dns: { type: "array", minItems: 1 } } },
      { properties: { http: { type: "array", minItems: 1 } } },
    ],
  },
};
